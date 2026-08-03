import type { PDFDocumentProxy } from "pdfjs-dist";

export interface TocEntry {
  title: string;
  pageNumber: number;
  level: number;
}

/** Resolve a pdf.js outline (bookmark) destination to a 1-based page number. */
async function resolvePageNumber(
  pdf: PDFDocumentProxy,
  dest: unknown
): Promise<number | null> {
  try {
    const resolved =
      typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    const pageIndex = await pdf.getPageIndex(resolved[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

/** Build a flat table of contents from the PDF's embedded bookmarks, if any. */
export async function extractOutlineToc(
  pdf: PDFDocumentProxy
): Promise<TocEntry[]> {
  const outline = await pdf.getOutline();
  if (!outline || outline.length === 0) return [];

  const entries: TocEntry[] = [];

  async function walk(items: typeof outline, level: number) {
    for (const item of items) {
      const pageNumber = await resolvePageNumber(pdf, item.dest);
      if (pageNumber !== null) {
        entries.push({ title: item.title.trim(), pageNumber, level });
      }
      if (item.items?.length) {
        await walk(item.items, level + 1);
      }
    }
  }

  await walk(outline, 0);
  return entries;
}

const HEADING_PATTERNS = [
  /\bSABBATH\b/,
  /\bSUNDAY\b/,
  /\bMONDAY\b/,
  /\bTUESDAY\b/,
  /\bWEDNESDAY\b/,
  /\bTHURSDAY\b/,
  /\bFRIDAY\b/,
  /\bSATURDAY\b/,
  /\bLESSON\s+\d+/i,
];

/** Fallback: scan each page's text for weekday/lesson markers when there is no outline. */
export async function extractHeuristicToc(
  pdf: PDFDocumentProxy
): Promise<TocEntry[]> {
  const entries: TocEntry[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    for (const pattern of HEADING_PATTERNS) {
      const match = pageText.match(pattern);
      if (match) {
        entries.push({
          title: `${match[0]} (p. ${pageNumber})`,
          pageNumber,
          level: 0,
        });
        break;
      }
    }
  }

  return entries;
}

export async function buildToc(pdf: PDFDocumentProxy): Promise<TocEntry[]> {
  const outlineToc = await extractOutlineToc(pdf);
  if (outlineToc.length > 0) return outlineToc;
  return extractHeuristicToc(pdf);
}
