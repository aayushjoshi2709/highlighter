import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (dir: string) => chrome.runtime.getURL(`pdfjs/${dir}/`);

export function openPdf(source: { url: string } | { data: ArrayBuffer }) {
  return pdfjs.getDocument({
    ...source,
    withCredentials: "url" in source,
    cMapUrl: asset("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: asset("standard_fonts"),
    isEvalSupported: false,
  }).promise;
}

export { pdfjs };
export type { PDFDocumentProxy } from "pdfjs-dist";
