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
const LESSON_PAGE_PROGRESS_KEY_PREFIX = "lesson-last-page:";

function getStoredPage(lessonId: string, totalPages: number): number {
  try {
    const stored = localStorage.getItem(`${LESSON_PAGE_PROGRESS_KEY_PREFIX}${lessonId}`);
    const parsed = Number(stored);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(Math.max(Math.trunc(parsed), 1), totalPages);
  } catch {
    return 1;
  }
}

export function LessonViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [isFitWidth, setIsFitWidth] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileControlsOpen, setIsMobileControlsOpen] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [flipOverlay, setFlipOverlay] = useState<{
    image: string;
    direction: "forward" | "backward";
    token: number;
  } | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  const flipTimeoutRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

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
        setCurrentPage(getStoredPage(id, doc.numPages));
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
      if (flipTimeoutRef.current !== null) {
        window.clearTimeout(flipTimeoutRef.current);
        flipTimeoutRef.current = null;
      }
    };
  }, [id]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 981px)");
    const applySidebarMode = (isDesktop: boolean) => {
      setIsMobileViewport(!isDesktop);
      if (isDesktop) {
        setIsSidebarOpen(true);
        setIsMobileControlsOpen(true);
      } else {
        setIsSidebarOpen(false);
        setIsMobileControlsOpen(false);
        setIsFitWidth(true);
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
    const nextPage = Math.min(Math.max(pageNumber, 1), pdf.numPages);
    if (nextPage === currentPage) return;

    const canvas = pageContainerRef.current?.querySelector(".pdf-page-canvas") as
      | HTMLCanvasElement
      | null;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      try {
        const token = Date.now();
        setFlipOverlay({
          image: canvas.toDataURL("image/jpeg", 0.9),
          direction: nextPage > currentPage ? "forward" : "backward",
          token,
        });
        if (flipTimeoutRef.current !== null) {
          window.clearTimeout(flipTimeoutRef.current);
        }
        flipTimeoutRef.current = window.setTimeout(() => {
          setFlipOverlay((current) => (current?.token === token ? null : current));
          flipTimeoutRef.current = null;
        }, 380);
      } catch {
        setFlipOverlay(null);
      }
    }

    setCurrentPage(nextPage);
  }

  function handleTocSelect(pageNumber: number) {
    goToPage(pageNumber);
    if (typeof window !== "undefined" && window.innerWidth <= 980) {
      setIsSidebarOpen(false);
    }
  }

  useEffect(() => {
    if (isMobileViewport && !isFitWidth) {
      setIsFitWidth(true);
    }
  }, [isMobileViewport, isFitWidth]);

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

  useEffect(() => {
    if (!id || !pdf) return;
    try {
      localStorage.setItem(`${LESSON_PAGE_PROGRESS_KEY_PREFIX}${id}`, String(currentPage));
    } catch {
      // Ignore storage failures and continue without persistence.
    }
  }, [id, pdf, currentPage]);

  if (isLoading) return <p className="page-message">Loading lesson…</p>;
  if (error) return <p className="page-message error">{error}</p>;
  if (!pdf || !lesson) return null;

  function onPageTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (typeof window === "undefined" || window.innerWidth > 980) return;
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  }

  function onPageTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (typeof window === "undefined" || window.innerWidth > 980) return;
    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    const endX = event.changedTouches[0]?.clientX;
    const endY = event.changedTouches[0]?.clientY;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    if (
      startX === null ||
      startY === null ||
      typeof endX !== "number" ||
      typeof endY !== "number"
    ) {
      return;
    }

    const deltaX = endX - startX;
    const deltaY = endY - startY;

    const horizontalSwipeThreshold = 55;
    const verticalTolerance = 40;

    if (Math.abs(deltaX) < horizontalSwipeThreshold) return;
    if (Math.abs(deltaY) > verticalTolerance) return;

    if (deltaX < 0) {
      goToPage(currentPage + 1);
    } else {
      goToPage(currentPage - 1);
    }
  }

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
        <button
          className="mobile-controls-handle"
          type="button"
          onClick={() => setIsMobileControlsOpen((value) => !value)}
          aria-expanded={isMobileControlsOpen}
          aria-controls="lesson-toolbar"
        >
          <span className="mobile-controls-icon" aria-hidden="true">
            {isMobileControlsOpen ? "▴" : "▾"}
          </span>
          <span>{isMobileControlsOpen ? "Hide controls" : "Show controls"}</span>
        </button>

        <div
          id="lesson-toolbar"
          className={`toolbar ${isMobileControlsOpen ? "mobile-controls-open" : "mobile-controls-collapsed"}`}
        >
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
            onClick={() => {
              if (!isMobileViewport) setIsFitWidth((value) => !value);
            }}
            disabled={isMobileViewport}
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

        <div
          ref={pageContainerRef}
          className={`page-container ${highContrast ? "pdf-high-contrast" : ""}`}
          onTouchStart={onPageTouchStart}
          onTouchEnd={onPageTouchEnd}
        >
          <div className="page-stack">
            <Suspense fallback={<p className="page-message">Rendering page…</p>}>
              <PdfPage pdf={pdf} pageNumber={currentPage} scale={scale} />
            </Suspense>
            {flipOverlay && (
              <div
                key={flipOverlay.token}
                className={`page-flip-overlay page-flip-${flipOverlay.direction}`}
                onAnimationEnd={() => {
                  setFlipOverlay((current) =>
                    current?.token === flipOverlay.token ? null : current
                  );
                }}
              >
                <img src={flipOverlay.image} alt="" aria-hidden="true" />
              </div>
            )}
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
