import { msg } from "gt-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { m } from "~/i18n/messages";

import { readMediaBlob } from "../media/mediaContent";
import { annotationWorkingSize } from "./annotationModel";

export type AnnotationImage = HTMLCanvasElement;

function blankCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(m(msg("Canvas drawing is unavailable.")));
  return { canvas, context };
}

/** Reads through fetch, not the <img>, so a cross-origin asset cannot taint the export canvas. */
export async function loadImageForAnnotation(src: string): Promise<AnnotationImage> {
  const bitmap = await createImageBitmap(await readMediaBlob(src)).catch((cause: unknown) => {
    throw new Error(m(msg("This image could not be decoded for annotation.")), { cause });
  });
  try {
    const size = annotationWorkingSize(bitmap.width, bitmap.height);
    const { canvas, context } = blankCanvas(size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

const PDF_PAGE_TARGET_DIMENSION = 2400;

export async function renderPdfPageForAnnotation(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<AnnotationImage> {
  const page = await pdf.getPage(pageIndex + 1);
  try {
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(4, PDF_PAGE_TARGET_DIMENSION / Math.max(natural.width, natural.height));
    const viewport = page.getViewport({ scale });
    const { canvas } = blankCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas, viewport, background: "white" }).promise;
    return canvas;
  } finally {
    page.cleanup();
  }
}

export function annotatedFileName(name: string): string {
  const base =
    name
      .replace(/[?#].*$/, "")
      .split(/[\\/]/)
      .pop() || "image";
  const stem = base.replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  return `${stem || "image"}-annotated.png`;
}
