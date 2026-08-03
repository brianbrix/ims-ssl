import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lessonFileUrl, listLessons, type Lesson } from "../api/lessons";
import { pdfjsLib } from "../lib/pdfSetup";

type SortOrder = "year-desc" | "year-asc";
const THUMBNAIL_CACHE_DB_NAME = "lesson-thumb-cache";
const THUMBNAIL_CACHE_STORE = "thumbnails";
const THUMBNAIL_CACHE_DB_VERSION = 1;
const THUMBNAIL_CACHE_MAX_ITEMS = 60;
const thumbnailMemoryCache = new Map<string, string>();
let thumbnailDbPromise: Promise<IDBDatabase | null> | null = null;

interface ThumbnailCacheRecord {
  cacheKey: string;
  dataUrl: string;
  updatedAt: number;
  lastAccessedAt: number;
}

interface LessonThumbnailProps {
  lessonId: string;
  uploadedAt: string;
  title: string;
}

function getThumbnailCacheKey(lessonId: string, uploadedAt: string): string {
  return `${lessonId}:${uploadedAt}`;
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

function openThumbnailDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (thumbnailDbPromise) return thumbnailDbPromise;

  thumbnailDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(THUMBNAIL_CACHE_DB_NAME, THUMBNAIL_CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(THUMBNAIL_CACHE_STORE)) {
        const store = db.createObjectStore(THUMBNAIL_CACHE_STORE, { keyPath: "cacheKey" });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return thumbnailDbPromise;
}

async function getCachedThumbnail(cacheKey: string): Promise<string | null> {
  const memoryHit = thumbnailMemoryCache.get(cacheKey);
  if (memoryHit) return memoryHit;

  try {
    const db = await openThumbnailDb();
    if (!db) return null;

    const transaction = db.transaction(THUMBNAIL_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(THUMBNAIL_CACHE_STORE);
    const record = (await requestToPromise(
      store.get(cacheKey)
    )) as ThumbnailCacheRecord | undefined;

    if (!record) {
      await transactionToPromise(transaction);
      return null;
    }

    record.lastAccessedAt = Date.now();
    store.put(record);
    await transactionToPromise(transaction);

    thumbnailMemoryCache.set(cacheKey, record.dataUrl);
    return record.dataUrl;
  } catch {
    return null;
  }
}

async function pruneThumbnailCache(db: IDBDatabase): Promise<void> {
  const countTx = db.transaction(THUMBNAIL_CACHE_STORE, "readonly");
  const countStore = countTx.objectStore(THUMBNAIL_CACHE_STORE);
  const totalCount = await requestToPromise(countStore.count());
  await transactionToPromise(countTx);

  if (totalCount <= THUMBNAIL_CACHE_MAX_ITEMS) return;

  const toDelete = totalCount - THUMBNAIL_CACHE_MAX_ITEMS;
  if (toDelete <= 0) return;

  const deleteTx = db.transaction(THUMBNAIL_CACHE_STORE, "readwrite");
  const store = deleteTx.objectStore(THUMBNAIL_CACHE_STORE);
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

      const record = cursor.value as ThumbnailCacheRecord;
      thumbnailMemoryCache.delete(record.cacheKey);
      cursor.delete();
      removed += 1;
      cursor.continue();
    };

    cursorRequest.onerror = () => reject(cursorRequest.error);
  });

  await transactionToPromise(deleteTx);
}

async function saveCachedThumbnail(cacheKey: string, value: string): Promise<void> {
  thumbnailMemoryCache.set(cacheKey, value);

  try {
    const db = await openThumbnailDb();
    if (!db) return;

    const now = Date.now();
    const transaction = db.transaction(THUMBNAIL_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(THUMBNAIL_CACHE_STORE);
    const record: ThumbnailCacheRecord = {
      cacheKey,
      dataUrl: value,
      updatedAt: now,
      lastAccessedAt: now,
    };
    store.put(record);
    await transactionToPromise(transaction);

    await pruneThumbnailCache(db);
  } catch {
    // Ignore storage errors; in-memory cache still helps in current session.
  }
}

function LessonThumbnail({ lessonId, uploadedAt, title }: LessonThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const cacheKey = getThumbnailCacheKey(lessonId, uploadedAt);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await getCachedThumbnail(cacheKey);
      if (cancelled) return;

      if (cached) {
        setThumbnailUrl(cached);
        setIsLoading(false);
      } else {
        setThumbnailUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  useEffect(() => {
    if (!containerEl || isVisible || thumbnailUrl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "220px" }
    );

    observer.observe(containerEl);

    return () => observer.disconnect();
  }, [containerEl, isVisible, thumbnailUrl]);

  useEffect(() => {
    if (thumbnailUrl || !isVisible) return;

    let cancelled = false;
    setIsLoading(true);
    const loadingTask = pdfjsLib.getDocument({ url: lessonFileUrl(lessonId) });

    (async () => {
      try {
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled) return;

        const initialViewport = page.getViewport({ scale: 1 });
        const targetWidth = 170;
        const scale = targetWidth / initialViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create canvas context.");

        await page.render({ canvasContext: context, viewport, canvas }).promise;
        if (!cancelled) {
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          setThumbnailUrl(dataUrl);
          void saveCachedThumbnail(cacheKey, dataUrl);
        }

        pdf.cleanup();
      } catch {
        if (!cancelled) setThumbnailUrl(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [cacheKey, isVisible, lessonId, thumbnailUrl]);

  if (thumbnailUrl) {
    return (
      <div className="library-thumbnail" ref={setContainerEl}>
        <img src={thumbnailUrl} alt={`Preview of ${title}`} loading="lazy" />
      </div>
    );
  }

  return (
    <div
      className="library-thumbnail library-thumbnail-fallback"
      ref={setContainerEl}
      aria-hidden="true"
    >
      {!isVisible ? "Preview on scroll" : isLoading ? "Rendering preview..." : "No preview"}
    </div>
  );
}

function extractYear(lesson: Lesson): number | null {
  const periodMatch = lesson.period?.match(/\b(19|20)\d{2}\b/);
  if (periodMatch) return Number(periodMatch[0]);

  const titleMatch = lesson.title?.match(/\b(19|20)\d{2}\b/);
  if (titleMatch) return Number(titleMatch[0]);

  const originalNameMatch = lesson.originalName?.match(/\b(19|20)\d{2}\b/);
  if (originalNameMatch) return Number(originalNameMatch[0]);

  return null;
}

function sortLessonsByYear(lessons: Lesson[], order: SortOrder): Lesson[] {
  return [...lessons].sort((a, b) => {
    const yearA = extractYear(a) ?? 0;
    const yearB = extractYear(b) ?? 0;

    if (yearA !== yearB) {
      return order === "year-desc" ? yearB - yearA : yearA - yearB;
    }

    return b.uploadedAt.localeCompare(a.uploadedAt);
  });
}

export function LibraryPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>("year-desc");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLessons()
      .then(setLessons)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <p className="page-message">Loading library…</p>;
  if (error) return <p className="page-message error">{error}</p>;
  if (lessons.length === 0) {
    return (
      <p className="page-message">
        No lessons have been uploaded yet. Check back later.
      </p>
    );
  }

  const sortedLessons = sortLessonsByYear(lessons, sortOrder);

  return (
    <div className="library-page">
      <div className="library-toolbar">
        <label htmlFor="library-sort">Sort by year</label>
        <select
          id="library-sort"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as SortOrder)}
        >
          <option value="year-desc">Latest first</option>
          <option value="year-asc">Oldest first</option>
        </select>
      </div>

      <div className="library-grid">
        {sortedLessons.map((lesson) => (
          <Link key={lesson.id} to={`/lesson/${lesson.id}`} className="library-card">
            <LessonThumbnail
              lessonId={lesson.id}
              uploadedAt={lesson.uploadedAt}
              title={lesson.title}
            />
            <h2>{lesson.title}</h2>
            {lesson.period && <p className="library-period">{lesson.period}</p>}
            <p className="library-date">
              Uploaded {new Date(lesson.uploadedAt).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
