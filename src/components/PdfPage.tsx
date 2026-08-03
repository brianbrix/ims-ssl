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

      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.innerHTML = "";

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
        if (!cancelled) linkifyVerses(textLayerDiv);
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

