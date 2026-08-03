const BOOK_NAMES = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth", "Samuel", "Kings", "Chronicles",
  "Ezra", "Nehemiah", "Esther", "Job", "Psalm", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Song of Songs", "Canticles", "Isaiah", "Jeremiah", "Lamentations",
  "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
  "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians", "Thessalonians",
  "Timothy", "Titus", "Philemon", "Hebrews", "James", "Peter", "Jude",
  "Revelation",
  // Common abbreviations
  "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Neh", "Esth",
  "Ps", "Prov", "Eccl", "Isa", "Jer", "Lam", "Ezek", "Dan", "Hos", "Obad",
  "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal", "Matt", "Rom", "Cor",
  "Gal", "Eph", "Phil", "Col", "Thess", "Tim", "Titus", "Philem", "Heb",
  "Jas", "Pet", "Rev", "Jn", "Jhn", "Jude",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const bookPattern = [...BOOK_NAMES]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");

const NUMBER_PREFIX_PATTERN = "(?:[1-3]|I{1,3})(?:st|nd|rd)?";
const VERSE_SEGMENT_PATTERN = "\\d{1,3}:\\d{1,3}(?:\\s*[-\\u2013\\u2014]\\s*\\d{1,3})?(?:\\s*,\\s*\\d{1,3}(?:\\s*[-\\u2013\\u2014]\\s*\\d{1,3})?)*";
const BOOK_ONLY_REGEX = new RegExp(
  `^(?:${NUMBER_PREFIX_PATTERN}[\\s\\u00A0]*)?(?:${bookPattern})\\.?$`,
  "i"
);
const PREFIX_ONLY_REGEX = new RegExp(`^${NUMBER_PREFIX_PATTERN}\\.?$`, "i");
const VERSE_TOKEN_REGEX = /^[0-9:,;\-\u2013\u2014]+$/;
const FULL_REFERENCE_REGEX = new RegExp(
  `^((?:${NUMBER_PREFIX_PATTERN}[\\s\\u00A0]*)?(?:${bookPattern})\\.?)[\\s\\u00A0]+(${VERSE_SEGMENT_PATTERN}(?:\\s*;\\s*${VERSE_SEGMENT_PATTERN})*)$`,
  "i"
);

export const VERSE_REGEX = new RegExp(
  `\\b((?:${NUMBER_PREFIX_PATTERN}[\\s\\u00A0]*)?(?:${bookPattern})\\.?)[\\s\\u00A0]+(${VERSE_SEGMENT_PATTERN}(?:\\s*;\\s*${VERSE_SEGMENT_PATTERN})*)`,
  "g"
);

/** Walk the rendered text layer spans and wrap Bible verse references in clickable marks. */
export function linkifyVerses(container: HTMLElement): void {
  const spans = container.querySelectorAll("span");

  spans.forEach((span) => {
    const text = span.textContent ?? "";
    VERSE_REGEX.lastIndex = 0;
    if (!VERSE_REGEX.test(text)) return;
    VERSE_REGEX.lastIndex = 0;

    const fragments: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = VERSE_REGEX.exec(text))) {
      const reference = normalizeReference(`${match[1]} ${match[2]}`);
      fragments.push(escapeHtml(text.slice(lastIndex, match.index)));
      fragments.push(
        `<span class="verse-ref" data-ref="${escapeHtml(reference)}">${escapeHtml(
          match[0]
        )}</span>`
      );
      lastIndex = match.index + match[0].length;
    }
    fragments.push(escapeHtml(text.slice(lastIndex)));

    span.innerHTML = fragments.join("");
  });

  // Handle references split across adjacent PDF text spans, e.g. "Proverbs" + "4:20," + "21".
  linkifyCrossSpanReferences(container);
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function normalizeReference(reference: string): string {
  return reference
    .replace(/^III\b/i, "3")
    .replace(/^II\b/i, "2")
    .replace(/^I\b/i, "1")
    .replace(/^(\d)(st|nd|rd)\b/i, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*([,;])\s*/g, "$1 ")
    .replace(/\s*[-\u2013\u2014]\s*/g, "-")
    .trim();
}

function linkifyCrossSpanReferences(container: HTMLElement): void {
  const spans = Array.from(container.querySelectorAll(":scope > span")) as HTMLSpanElement[];

  for (let i = 0; i < spans.length; i++) {
    const bookSpan = spans[i];
    if (bookSpan.dataset.ref) continue;
    if (bookSpan.querySelector(".verse-ref")) continue;

    const bookText = cleanBookToken(bookSpan.textContent ?? "");
    if (!BOOK_ONLY_REGEX.test(bookText)) continue;

    const prefixInfo = findDetachedBookPrefix(spans, i, bookText);
    const composedBookText = prefixInfo ? `${prefixInfo.prefix} ${bookText}` : bookText;

    const verseSpanIndexes: number[] = [];
    const verseTokens: string[] = [];

    for (let j = i + 1; j < spans.length && j <= i + 12; j++) {
      if (spans[j].dataset.ref || spans[j].querySelector(".verse-ref")) break;

      const raw = cleanText(spans[j].textContent ?? "");
      if (!raw) continue;

      const token = normalizeVerseToken(raw);
      if (!token || !VERSE_TOKEN_REGEX.test(token)) break;

      verseTokens.push(token);
      verseSpanIndexes.push(j);
    }

    if (verseTokens.length === 0) continue;
    const verseText = verseTokens.join(" ");
    if (!verseText.includes(":")) continue;

    const reference = normalizeReference(`${composedBookText} ${verseText}`);
    if (!FULL_REFERENCE_REGEX.test(reference)) continue;

    if (prefixInfo) markSpanAsReference(spans[prefixInfo.index], reference);
    markSpanAsReference(bookSpan, reference);
    verseSpanIndexes.forEach((index) => markSpanAsReference(spans[index], reference));
  }
}

function findDetachedBookPrefix(
  spans: HTMLSpanElement[],
  bookIndex: number,
  bookText: string
): { index: number; prefix: string } | null {
  if (new RegExp(`^${NUMBER_PREFIX_PATTERN}\\s`, "i").test(bookText)) return null;

  for (let i = bookIndex - 1; i >= Math.max(0, bookIndex - 3); i--) {
    const span = spans[i];
    if (span.dataset.ref || span.querySelector(".verse-ref")) return null;

    const text = cleanText(span.textContent ?? "");
    if (!text) continue;
    if (!PREFIX_ONLY_REGEX.test(text)) return null;

    const normalizedPrefix = normalizeReference(text).replace(/\.$/, "");
    return { index: i, prefix: normalizedPrefix };
  }

  return null;
}

function markSpanAsReference(span: HTMLSpanElement, reference: string): void {
  const text = span.textContent ?? "";
  if (!cleanText(text)) return;
  span.classList.add("verse-ref");
  span.dataset.ref = reference;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeVerseToken(token: string): string {
  return token
    .replace(/^[([{]+/, "")
    .replace(/[)\].]+$/, "")
    .trim();
}

function cleanBookToken(value: string): string {
  return cleanText(value)
    .replace(/^[([{]+/, "")
    .replace(/[.,;:)\]]+$/, "")
    .trim();
}
