import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsLib } from "../lib/pdfSetup";
import { linkifyVerses } from "../lib/verses";
import { VersePopover } from "./VersePopover";

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}

const PAGE_RENDER_CACHE_DB_NAME = "lesson-page-render-cache";
const PAGE_RENDER_CACHE_STORE = "pages";
const PAGE_RENDER_CACHE_DB_VERSION = 1;
const PAGE_RENDER_CACHE_MAX_ITEMS = 40;
const pageRenderCache = new Map<
  string,
  { imageDataUrl: string; textLayerHtml: string; lastAccessedAt: number }
>();
let pageRenderDbPromise: Promise<IDBDatabase | null> | null = null;

interface PageRenderCacheRecord {
  cacheKey: string;
  imageDataUrl: string;
  textLayerHtml: string;
  updatedAt: number;
  lastAccessedAt: number;
}

function getPageCacheKey(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  pixelRatio: number
): string {
  const fingerprint = pdf.fingerprints?.[0] ?? "unknown-document";
  return `${fingerprint}:${pageNumber}:${scale.toFixed(3)}:${pixelRatio.toFixed(2)}`;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openPageRenderDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (pageRenderDbPromise) return pageRenderDbPromise;

  pageRenderDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(PAGE_RENDER_CACHE_DB_NAME, PAGE_RENDER_CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PAGE_RENDER_CACHE_STORE)) {
        const store = db.createObjectStore(PAGE_RENDER_CACHE_STORE, { keyPath: "cacheKey" });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return pageRenderDbPromise;
}

async function getCachedRenderedPage(cacheKey: string) {
  const cached = pageRenderCache.get(cacheKey);
  if (cached) {
    cached.lastAccessedAt = Date.now();
    return cached;
  }

  try {
    const db = await openPageRenderDb();
    if (!db) return null;

    const transaction = db.transaction(PAGE_RENDER_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(PAGE_RENDER_CACHE_STORE);
    const record = (await requestToPromise(
      store.get(cacheKey)
    )) as PageRenderCacheRecord | undefined;

    if (!record) {
      await transactionToPromise(transaction);
      return null;
    }

    record.lastAccessedAt = Date.now();
    store.put(record);
    await transactionToPromise(transaction);

    const hydrated = {
      imageDataUrl: record.imageDataUrl,
      textLayerHtml: record.textLayerHtml,
      lastAccessedAt: record.lastAccessedAt,
    };
    pageRenderCache.set(cacheKey, hydrated);
    return hydrated;
  } catch {
    return null;
  }
}

function prunePageRenderCache(): void {
  if (pageRenderCache.size <= PAGE_RENDER_CACHE_MAX_ITEMS) return;

  const entries = [...pageRenderCache.entries()];
  entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

  const toDelete = pageRenderCache.size - PAGE_RENDER_CACHE_MAX_ITEMS;
  for (let index = 0; index < toDelete; index += 1) {
    const key = entries[index]?.[0];
    if (key) pageRenderCache.delete(key);
  }
}

async function prunePageRenderDbCache(db: IDBDatabase): Promise<void> {
  const countTx = db.transaction(PAGE_RENDER_CACHE_STORE, "readonly");
  const countStore = countTx.objectStore(PAGE_RENDER_CACHE_STORE);
  const totalCount = await requestToPromise(countStore.count());
  await transactionToPromise(countTx);

  if (totalCount <= PAGE_RENDER_CACHE_MAX_ITEMS) return;

  const toDelete = totalCount - PAGE_RENDER_CACHE_MAX_ITEMS;
  if (toDelete <= 0) return;

  const deleteTx = db.transaction(PAGE_RENDER_CACHE_STORE, "readwrite");
  const store = deleteTx.objectStore(PAGE_RENDER_CACHE_STORE);
  const index = store.index("lastAccessedAt");

  await new Promise<void>((resolve, reject) => {
    let removed = 0;
    const cursorRequest = index.openCursor();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || removed >= toDelete) {
        resolve();
        return;
      }

      const record = cursor.value as PageRenderCacheRecord;
      pageRenderCache.delete(record.cacheKey);
      cursor.delete();
      removed += 1;
      cursor.continue();
    };

    cursorRequest.onerror = () => reject(cursorRequest.error);
  });

  await transactionToPromise(deleteTx);
}

async function saveRenderedPage(
  cacheKey: string,
  imageDataUrl: string,
  textLayerHtml: string
): void {
  pageRenderCache.set(cacheKey, {
    imageDataUrl,
    textLayerHtml,
    lastAccessedAt: Date.now(),
  });
  prunePageRenderCache();

  try {
    const db = await openPageRenderDb();
    if (!db) return;

    const now = Date.now();
    const transaction = db.transaction(PAGE_RENDER_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(PAGE_RENDER_CACHE_STORE);
    const record: PageRenderCacheRecord = {
      cacheKey,
      imageDataUrl,
      textLayerHtml,
      updatedAt: now,
      lastAccessedAt: now,
    };
    store.put(record);
    await transactionToPromise(transaction);

    await prunePageRenderDbCache(db);
  } catch {
    // Ignore IndexedDB write errors and keep in-memory cache for current tab.
  }
}

async function drawCachedImage(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  imageDataUrl: string
): Promise<void> {
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to decode cached page image."));
    image.src = imageDataUrl;
  });

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

export function PdfPage({ pdf, pageNumber, scale }: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<ReturnType<
    import("pdfjs-dist").PDFPageProxy["render"]
  > | null>(null);
  const textLayerInstanceRef = useRef<InstanceType<
    typeof pdfjsLib.TextLayer
  > | null>(null);

  const [popover, setPopover] = useState<{
    reference: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
      const renderViewport = page.getViewport({ scale: scale * pixelRatio });
      const canvas = canvasRef.current;
      const textLayerDiv = textLayerRef.current;
      if (!canvas || !textLayerDiv) return;

      const context = canvas.getContext("2d");
      if (!context) return;

      const cacheKey = getPageCacheKey(pdf, pageNumber, scale, pixelRatio);

      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.innerHTML = "";

      const cached = await getCachedRenderedPage(cacheKey);
      if (cached) {
        try {
          await drawCachedImage(context, canvas, cached.imageDataUrl);
          if (cancelled) return;

          textLayerDiv.innerHTML = cached.textLayerHtml;
          return;
        } catch {
          pageRenderCache.delete(cacheKey);
        }
      }

      // Cancel any in-flight render before starting a new one (e.g. rapid page/zoom changes).
      renderTaskRef.current?.cancel();
      const renderTask = page.render({
        canvasContext: context,
        viewport: renderViewport,
        canvas,
      });
      renderTaskRef.current = renderTask;
      try {
        await renderTask.promise;
      } catch {
        // Ignore cancellation errors from superseded render tasks.
      }
      if (cancelled) return;

      textLayerInstanceRef.current?.cancel();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerDiv,
        viewport,
      });
      textLayerInstanceRef.current = textLayer;
      try {
        await textLayer.render();
        if (!cancelled) {
          linkifyVerses(textLayerDiv);
          void saveRenderedPage(
            cacheKey,
            canvas.toDataURL("image/jpeg", 0.86),
            textLayerDiv.innerHTML
          );
        }
      } catch {
        // Ignore cancellation errors from superseded text layer renders.
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      textLayerInstanceRef.current?.cancel();
      setPopover(null);
    };
  }, [pdf, pageNumber, scale]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) return;

    const target = event.target as HTMLElement;
    const verseTarget = target.closest(".verse-ref") as HTMLElement | null;
    if (!verseTarget) return;

    const reference = verseTarget.dataset.ref;
    if (!reference) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    const targetRect = verseTarget.getBoundingClientRect();
    setPopover({
      reference,
      x: targetRect.left - (containerRect?.left ?? 0),
      y: targetRect.bottom - (containerRect?.top ?? 0) + 4,
    });
  }

  return (
    <div ref={containerRef} className="pdf-page" onClick={handleClick}>
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      {popover && (
        <VersePopover
          reference={popover.reference}
          x={popover.x}
          y={popover.y}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

