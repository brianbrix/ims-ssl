declare module "pdfjs-dist" {
  export interface PDFDestinationArray extends Array<unknown> {}

  export interface PDFOutlineItem {
    title: string;
    dest: unknown;
    items?: PDFOutlineItem[];
  }

  export interface PDFTextItem {
    str?: string;
  }

  export interface PDFTextContent {
    items: PDFTextItem[];
  }

  export interface PDFRenderTask {
    promise: Promise<void>;
    cancel(): void;
  }

  export interface PDFPageViewport {
    width: number;
    height: number;
  }

  export interface PDFPageProxy {
    getViewport(params: { scale: number }): PDFPageViewport;
    render(params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: PDFPageViewport;
      canvas?: HTMLCanvasElement;
    }): PDFRenderTask;
    streamTextContent(): unknown;
    getTextContent(): Promise<PDFTextContent>;
  }

  export interface PDFDocumentProxy {
    numPages: number;
    fingerprints?: string[];
    getPage(pageNumber: number): Promise<PDFPageProxy>;
    getOutline(): Promise<PDFOutlineItem[] | null>;
    getDestination(dest: string): Promise<PDFDestinationArray | null>;
    getPageIndex(ref: unknown): Promise<number>;
    cleanup(): void;
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
    destroy(): void;
  }

  export class TextLayer {
    constructor(options: {
      textContentSource: unknown;
      container: HTMLDivElement;
      viewport: PDFPageViewport;
    });
    render(): Promise<void>;
    cancel(): void;
  }

  export const GlobalWorkerOptions: {
    workerSrc: string;
  };

  export interface PDFDocumentInitParameters {
    url: string;
    disableAutoFetch?: boolean;
    disableStream?: boolean;
    rangeChunkSize?: number;
  }

  export function getDocument(src: PDFDocumentInitParameters): PDFDocumentLoadingTask;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
