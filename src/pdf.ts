// pdf.js wrapper. Uses the "legacy" build so it also works on older iOS versions.
// @ts-ignore - no bundled types for the .mjs entry
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "/assets/pdf.worker.js";
const OPTS = { disableFontFace: true, cMapUrl: "/assets/cmaps/", cMapPacked: true, standardFontDataUrl: "/assets/standard_fonts/" };

export async function openPdf(data: ArrayBuffer): Promise<any> {
  return pdfjs.getDocument({ data: new Uint8Array(data), ...OPTS }).promise;
}

export type Extracted = {
  numPages: number;
  title: string;
  pages: { n: number; text: string }[];
  cover: Blob | null;
};

/** Reads the file in the browser: page count, text per page (for search) and a cover from page 1. */
export async function extractPdf(file: File, onProgress: (done: number, total: number) => void): Promise<Extracted> {
  const doc = await openPdf(await file.arrayBuffer());
  const total: number = doc.numPages;
  const pages: { n: number; text: string }[] = [];
  let title = "";
  try {
    const meta = await doc.getMetadata();
    title = String(meta?.info?.Title ?? "").trim();
  } catch { /* no metadata */ }

  let cover: Blob | null = null;
  try {
    const p1 = await doc.getPage(1);
    const base = p1.getViewport({ scale: 1 });
    const vp = p1.getViewport({ scale: 360 / base.width });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    await p1.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
    cover = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.78));
  } catch { /* cover is optional */ }

  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let s = "";
    for (const it of tc.items as any[]) if ("str" in it) s += it.str + (it.hasEOL ? " " : " ");
    pages.push({ n, text: s.replace(/\s+/g, " ").trim() });
    page.cleanup();
    if (n % 5 === 0 || n === total) onProgress(n, total);
  }
  await doc.loadingTask?.destroy?.();
  return { numPages: total, title, pages, cover };
}
