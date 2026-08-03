import { useEffect, useState } from "react";

const TRANSLATION_KEY = "verseTranslation";
const TRANSLATIONS = [
  { value: "web", label: "WEB" },
  { value: "kjv", label: "KJV" },
  { value: "bbe", label: "BBE" },
  { value: "oeb-us", label: "OEB-US" },
] as const;

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
  const response = await fetch(
    `https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`
  );
  if (!response.ok) {
    throw new Error(`Verse not found for "${reference}".`);
  }
  return response.json();
}

export function VersePopover({ reference, x, y, onClose }: VersePopoverProps) {
  const [data, setData] = useState<BibleApiResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [translation, setTranslation] = useState(getInitialTranslation);

  useEffect(() => {
    localStorage.setItem(TRANSLATION_KEY, translation);
  }, [translation]);

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

  return (
    <div className="verse-popover" style={{ left: x, top: y }}>
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
}
