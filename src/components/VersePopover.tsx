import { useEffect, useState } from "react";

const TRANSLATION_KEY = "verseTranslation";
const VERSE_CACHE_DB_NAME = "verse-cache";
const VERSE_CACHE_STORE = "verses";
const VERSE_CACHE_DB_VERSION = 1;
const VERSE_CACHE_MAX_ITEMS = 600;
const TRANSLATIONS = [
  { value: "web", label: "WEB" },
  { value: "kjv", label: "KJV" },
  { value: "bbe", label: "BBE" },
  { value: "oeb-us", label: "OEB-US" },
] as const;
const verseMemoryCache = new Map<
  string,
  { data: BibleApiResponse; lastAccessedAt: number }
>();
let verseDbPromise: Promise<IDBDatabase | null> | null = null;

function getInitialTranslation(): string {
  const saved = localStorage.getItem(TRANSLATION_KEY);
  if (saved && TRANSLATIONS.some((translation) => translation.value === saved)) {
    return saved;
  }
  return "web";
}

interface VersePopoverProps {
  reference: string;
  x: number;
  y: number;
  onClose: () => void;
}

interface BibleApiResponse {
  reference: string;
  text: string;
  translation_name: string;
}

interface VerseCacheRecord {
  cacheKey: string;
  data: BibleApiResponse;
  updatedAt: number;
  lastAccessedAt: number;
}

function getVerseCacheKey(reference: string, translation: string): string {
  const normalizedRef = reference.replace(/\s+/g, " ").trim().toLowerCase();
  return `${translation}:${normalizedRef}`;
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

function openVerseDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (verseDbPromise) return verseDbPromise;

  verseDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(VERSE_CACHE_DB_NAME, VERSE_CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VERSE_CACHE_STORE)) {
        const store = db.createObjectStore(VERSE_CACHE_STORE, { keyPath: "cacheKey" });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return verseDbPromise;
}

function pruneVerseMemoryCache(): void {
  if (verseMemoryCache.size <= VERSE_CACHE_MAX_ITEMS) return;

  const entries = [...verseMemoryCache.entries()];
  entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
  const toDelete = verseMemoryCache.size - VERSE_CACHE_MAX_ITEMS;

  for (let index = 0; index < toDelete; index += 1) {
    const key = entries[index]?.[0];
    if (key) verseMemoryCache.delete(key);
  }
}

async function pruneVerseDbCache(db: IDBDatabase): Promise<void> {
  const countTx = db.transaction(VERSE_CACHE_STORE, "readonly");
  const countStore = countTx.objectStore(VERSE_CACHE_STORE);
  const totalCount = await requestToPromise(countStore.count());
  await transactionToPromise(countTx);

  if (totalCount <= VERSE_CACHE_MAX_ITEMS) return;

  const toDelete = totalCount - VERSE_CACHE_MAX_ITEMS;
  const deleteTx = db.transaction(VERSE_CACHE_STORE, "readwrite");
  const store = deleteTx.objectStore(VERSE_CACHE_STORE);
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

      const record = cursor.value as VerseCacheRecord;
      verseMemoryCache.delete(record.cacheKey);
      cursor.delete();
      removed += 1;
      cursor.continue();
    };

    cursorRequest.onerror = () => reject(cursorRequest.error);
  });

  await transactionToPromise(deleteTx);
}

async function getCachedVerse(reference: string, translation: string): Promise<BibleApiResponse | null> {
  const cacheKey = getVerseCacheKey(reference, translation);
  const memoryHit = verseMemoryCache.get(cacheKey);
  if (memoryHit) {
    memoryHit.lastAccessedAt = Date.now();
    return memoryHit.data;
  }

  try {
    const db = await openVerseDb();
    if (!db) return null;

    const transaction = db.transaction(VERSE_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(VERSE_CACHE_STORE);
    const record = (await requestToPromise(
      store.get(cacheKey)
    )) as VerseCacheRecord | undefined;

    if (!record) {
      await transactionToPromise(transaction);
      return null;
    }

    record.lastAccessedAt = Date.now();
    store.put(record);
    await transactionToPromise(transaction);

    verseMemoryCache.set(cacheKey, {
      data: record.data,
      lastAccessedAt: record.lastAccessedAt,
    });
    return record.data;
  } catch {
    return null;
  }
}

async function saveCachedVerse(
  reference: string,
  translation: string,
  data: BibleApiResponse
): Promise<void> {
  const cacheKey = getVerseCacheKey(reference, translation);

  verseMemoryCache.set(cacheKey, { data, lastAccessedAt: Date.now() });
  pruneVerseMemoryCache();

  try {
    const db = await openVerseDb();
    if (!db) return;

    const now = Date.now();
    const transaction = db.transaction(VERSE_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(VERSE_CACHE_STORE);
    const record: VerseCacheRecord = {
      cacheKey,
      data,
      updatedAt: now,
      lastAccessedAt: now,
    };
    store.put(record);
    await transactionToPromise(transaction);

    await pruneVerseDbCache(db);
  } catch {
    // Ignore cache write failures and proceed with in-memory cache.
  }
}

function splitReferenceQueries(reference: string): string[] {
  const normalized = reference.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.+?)\s+(\d{1,3}:.+)$/);
  if (!match) return [normalized];

  const book = match[1].trim();
  const tail = match[2].trim();
  const chapterClauses = tail.split(/\s*;\s*/).filter(Boolean);
  const queries: string[] = [];

  for (const clause of chapterClauses) {
    const chapterMatch = clause.match(/^(\d{1,3})\s*:\s*(.+)$/);
    if (!chapterMatch) {
      queries.push(`${book} ${clause.trim()}`);
      continue;
    }

    const chapter = chapterMatch[1];
    const verseList = chapterMatch[2]
      .split(/\s*,\s*/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (verseList.length === 0) {
      queries.push(`${book} ${chapter}`);
      continue;
    }

    for (const verseSegment of verseList) {
      queries.push(`${book} ${chapter}:${verseSegment}`);
    }
  }

  return queries.length ? queries : [normalized];
}

async function fetchVerse(reference: string, translation: string): Promise<BibleApiResponse> {
  const cached = await getCachedVerse(reference, translation);
  if (cached) return cached;

  const response = await fetch(
    `https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`
  );
  if (!response.ok) {
    throw new Error(`Verse not found for "${reference}".`);
  }
  const verse = (await response.json()) as BibleApiResponse;
  void saveCachedVerse(reference, translation, verse);
  return verse;
}

export function VersePopover({ reference, x, y, onClose }: VersePopoverProps) {
  const [data, setData] = useState<BibleApiResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [translation, setTranslation] = useState(getInitialTranslation);
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    localStorage.setItem(TRANSLATION_KEY, translation);
  }, [translation]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 980px)");
    setIsMobileView(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => setIsMobileView(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setData([]);

    const queries = splitReferenceQueries(reference);
    Promise.all(queries.map((query) => fetchVerse(query, translation)))
      .then((results) => {
        if (!cancelled) setData(results);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reference, translation]);

  const popoverContent = (
    <div
      className={`verse-popover ${isMobileView ? "verse-popover-mobile" : ""}`}
      style={isMobileView ? undefined : { left: x, top: y }}
    >
      <div className="verse-popover-header">
        <strong>{reference}</strong>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <label className="verse-popover-translation" htmlFor="verse-translation-select">
        Translation
      </label>
      <select
        id="verse-translation-select"
        value={translation}
        onChange={(event) => setTranslation(event.target.value)}
      >
        {TRANSLATIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isLoading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}
      {data.length > 0 && (
        <>
          {data.map((verse) => (
            <p key={verse.reference} className="verse-popover-text">
              <strong>{verse.reference}</strong> {verse.text.trim()}
            </p>
          ))}
          <p className="verse-popover-meta">{data[0].translation_name}</p>
        </>
      )}
      <a
        href={`https://bible-api.com/${encodeURIComponent(
          splitReferenceQueries(reference)[0] || reference
        )}?translation=${translation}`}
        target="_blank"
        rel="noreferrer"
      >
        View source
      </a>
    </div>
  );

  if (isMobileView) {
    return (
      <div className="verse-popover-overlay" onClick={onClose} role="presentation">
        <div onClick={(event) => event.stopPropagation()} role="presentation">
          {popoverContent}
        </div>
      </div>
    );
  }

  return popoverContent;
}
