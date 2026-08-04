import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsLib } from "../lib/pdfSetup";
import { buildToc, type TocEntry } from "../lib/toc";
import { getLesson, lessonFileUrl, type Lesson } from "../api/lessons";

const PdfPage = lazy(() => import("../components/PdfPage").then((module) => ({
  default: module.PdfPage,
})));
const TocSidebar = lazy(() => import("../components/TocSidebar").then((module) => ({
  default: module.TocSidebar,
})));

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function LessonViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [isFitWidth, setIsFitWidth] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPdf(null);
    setToc([]);

    (async () => {
      try {
        const lessonData = await getLesson(id);
        if (cancelled) return;
        setLesson(lessonData);

        loadingTaskRef.current?.destroy();
        const loadingTask = pdfjsLib.getDocument({ url: lessonFileUrl(id) });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;

        setPdf(doc);
        setCurrentPage(1);
        setIsLoading(false);

        // Build TOC in the background so first-page rendering is not blocked.
        void buildToc(doc)
          .then((tocEntries) => {
            if (!cancelled) setToc(tocEntries);
          })
          .catch(() => {
            if (!cancelled) setToc([]);
          });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load lesson.");
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      loadingTaskRef.current?.destroy();
    };
  }, [id]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 981px)");
    const applySidebarMode = (isDesktop: boolean) => {
      if (isDesktop) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };

    applySidebarMode(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => applySidebarMode(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!pdf) return;
    const totalPages = pdf.numPages;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        goToPage(currentPage + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goToPage(currentPage - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goToPage(1);
      } else if (event.key === "End") {
        event.preventDefault();
        goToPage(totalPages);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPage, pdf]);

  function goToPage(pageNumber: number) {
    if (!pdf) return;
    setCurrentPage(Math.min(Math.max(pageNumber, 1), pdf.numPages));
  }

  function handleTocSelect(pageNumber: number) {
    goToPage(pageNumber);
    if (typeof window !== "undefined" && window.innerWidth <= 980) {
      setIsSidebarOpen(false);
    }
  }

  useEffect(() => {
    if (!pdf || !isFitWidth) return;
    const pdfDoc = pdf;
    let cancelled = false;

    async function applyFitWidth() {
      const host = pageContainerRef.current;
      if (!host) return;

      const page = await pdfDoc.getPage(currentPage);
      if (cancelled) return;

      const viewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(host.clientWidth - 56, 240);
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, availableWidth / viewport.width));
      setScale((prev) => (Math.abs(prev - nextScale) < 0.01 ? prev : nextScale));
    }

    void applyFitWidth();
    const onResize = () => {
      void applyFitWidth();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [pdf, currentPage, isFitWidth]);

  useEffect(() => {
    if (!pdf) return;

    const nextPage = currentPage + 1;
    const previousPage = currentPage - 1;

    if (nextPage <= pdf.numPages) {
      void pdf.getPage(nextPage).catch(() => {});
    }

    if (previousPage >= 1) {
      void pdf.getPage(previousPage).catch(() => {});
    }
  }, [pdf, currentPage]);

  if (isLoading) return <p className="page-message">Loading lesson…</p>;
  if (error) return <p className="page-message error">{error}</p>;
  if (!pdf || !lesson) return null;

  return (
    <div className={`viewer-layout ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <aside className="sidebar" id="lesson-outline">
        <div className="lesson-meta">
          <h2>{lesson.title}</h2>
          {lesson.period && <p className="library-period">{lesson.period}</p>}
          <Link to="/">← Back to library</Link>
        </div>
        <Suspense fallback={<p className="toc-empty">Loading table of contents…</p>}>
          <TocSidebar entries={toc} currentPage={currentPage} onSelect={handleTocSelect} />
        </Suspense>
      </aside>

      <main className="viewer-main">
        <div className="toolbar">
          <button
            className={`sidebar-toggle ${isSidebarOpen ? "toolbar-toggle-on" : ""}`}
            onClick={() => setIsSidebarOpen((value) => !value)}
            aria-expanded={isSidebarOpen}
            aria-controls="lesson-outline"
          >
            Outline
          </button>

          <button onClick={() => goToPage(1)} disabled={currentPage <= 1}>
            First
          </button>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
            Prev
          </button>
          <input
            type="number"
            min={1}
            max={pdf.numPages}
            value={currentPage}
            onChange={(e) => goToPage(Number(e.target.value))}
          />
          <span>/ {pdf.numPages}</span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pdf.numPages}
          >
            Next
          </button>
          <button onClick={() => goToPage(pdf.numPages)} disabled={currentPage >= pdf.numPages}>
            Last
          </button>

          <button
            className={isFitWidth ? "toolbar-toggle-on" : undefined}
            onClick={() => setIsFitWidth((value) => !value)}
          >
            Fit width
          </button>

          <button
            className={highContrast ? "toolbar-toggle-on" : undefined}
            onClick={() => setHighContrast((value) => !value)}
          >
            High contrast
          </button>

          <input
            type="range"
            min={1}
            max={pdf.numPages}
            value={currentPage}
            onChange={(e) => goToPage(Number(e.target.value))}
            className="page-slider"
            aria-label="Page slider"
          />

          <div className="zoom-controls">
            <button
              onClick={() => {
                setIsFitWidth(false);
                setScale((s) => Math.max(MIN_SCALE, s - 0.2));
              }}
              disabled={scale <= MIN_SCALE}
            >
              −
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              onClick={() => {
                setIsFitWidth(false);
                setScale((s) => Math.min(MAX_SCALE, s + 0.2));
              }}
              disabled={scale >= MAX_SCALE}
            >
              +
            </button>
          </div>

        </div>

        <div ref={pageContainerRef} className={`page-container ${highContrast ? "pdf-high-contrast" : ""}`}>
          <div className="page-stack">
            <Suspense fallback={<p className="page-message">Rendering page…</p>}>
              <PdfPage pdf={pdf} pageNumber={currentPage} scale={scale} />
            </Suspense>
          </div>
        </div>

        <div className="viewer-bottom-nav">
          <div className="floating-page-nav" aria-label="Quick page navigation">
            <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
              ◀
            </button>
            <label htmlFor="floating-page-input">Page</label>
            <input
              id="floating-page-input"
              type="number"
              min={1}
              max={pdf.numPages}
              value={currentPage}
              onChange={(e) => goToPage(Number(e.target.value))}
            />
            <span>/ {pdf.numPages}</span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pdf.numPages}
            >
              ▶
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
