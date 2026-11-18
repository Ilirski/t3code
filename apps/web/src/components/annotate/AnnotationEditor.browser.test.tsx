import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import "~/index.css";

vi.mock(import("pdfjs-dist/build/pdf.worker.min.mjs?url"), async () => {
  const { default: source } = await import("pdfjs-dist/build/pdf.worker.min.mjs?raw");
  return {
    default: URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
  };
});

import type { ChatComposerHandle } from "../chat/ChatComposer";
import { ComposerHandleContext } from "~/composerHandleContext";
import PdfViewer from "../files/PdfViewer";
import { PreviewImage } from "../files/PreviewImage";
import AnnotationEditor from "./AnnotationEditor";

function whiteCanvas(width = 400, height = 200) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return canvas;
}

function pixel(canvas: HTMLCanvasElement, x: number, y: number) {
  return [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data];
}

/** Drags across the canvas between two points given as fractions of its displayed size. */
async function drag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]) {
  const rect = canvas.getBoundingClientRect();
  const locator = page.elementLocator(canvas);
  await userEvent.dragAndDrop(locator, locator, {
    sourcePosition: { x: rect.width * from[0], y: rect.height * from[1] },
    targetPosition: { x: rect.width * to[0], y: rect.height * to[1] },
  });
}

it("draws a box, undoes and redoes it, and hands a PNG to the composer", async () => {
  const addDroppedFiles = vi.fn();
  const composer = { current: { addDroppedFiles } as unknown as ChatComposerHandle };
  const onClose = vi.fn();
  await using _screen = await render(
    <ComposerHandleContext value={composer}>
      <AnnotationEditor name="shot.png" load={async () => whiteCanvas()} onClose={onClose} />
    </ComposerHandleContext>,
    { router: false },
  );
  const canvasLocator = page.getByRole("img", { name: "Annotation canvas for shot.png" });
  await expect.element(canvasLocator).toBeVisible();
  const canvas = canvasLocator.element() as HTMLCanvasElement;
  expect(pixel(canvas, 40, 70)).toEqual([255, 255, 255, 255]);

  await page.getByRole("button", { name: "Box" }).click();
  await drag(canvas, [0.1, 0.1], [0.6, 0.6]);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect.element(undo).toBeEnabled();
  // The box's left edge runs through x=40 (10% of 400); red dominates there.
  await vi.waitFor(() => {
    const [r, g, b] = pixel(canvas, 40, 70);
    expect(r).toBeGreaterThan(200);
    expect(g! + b!).toBeLessThan(250);
  });

  await undo.click();
  await vi.waitFor(() => expect(pixel(canvas, 40, 70)).toEqual([255, 255, 255, 255]));
  await page.getByRole("button", { name: "Redo" }).click();
  await vi.waitFor(() => expect(pixel(canvas, 40, 70)[1]).toBeLessThan(200));

  await page.getByRole("button", { name: "Add to chat" }).click();
  await vi.waitFor(() => expect(addDroppedFiles).toHaveBeenCalledOnce());
  const [file] = addDroppedFiles.mock.calls[0]![0] as File[];
  expect(file).toBeInstanceOf(File);
  expect(file!.name).toBe("shot-annotated.png");
  expect(file!.type).toBe("image/png");
  expect(onClose).toHaveBeenCalledOnce();
});

it("places text where the user clicks and commits it once", async () => {
  const onClose = vi.fn();
  await using _screen = await render(
    <AnnotationEditor name="notes" load={async () => whiteCanvas()} onClose={onClose} />,
    { router: false },
  );
  const canvasLocator = page.getByRole("img", { name: "Annotation canvas for notes" });
  await expect.element(canvasLocator).toBeVisible();
  const canvas = canvasLocator.element() as HTMLCanvasElement;
  const before = canvas.toDataURL();

  await userEvent.keyboard("t");
  await expect
    .element(page.getByRole("button", { name: "Text" }))
    .toHaveAttribute("aria-pressed", "true");
  const rect = canvas.getBoundingClientRect();
  const field = page.getByRole("textbox", { name: "Annotation text" });
  // Escape in the field discards the draft without closing the editor.
  await canvasLocator.click({ position: { x: rect.width * 0.25, y: rect.height * 0.4 } });
  await field.fill("Discarded");
  await userEvent.keyboard("{Escape}");
  await expect.element(field).not.toBeInTheDocument();
  await expect.element(canvasLocator).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
  expect(canvas.toDataURL()).toBe(before);

  await canvasLocator.click({ position: { x: rect.width * 0.25, y: rect.height * 0.4 } });
  await field.fill("Fix this");
  await userEvent.keyboard("{Enter}");
  await expect.element(field).not.toBeInTheDocument();
  await vi.waitFor(() => expect(canvas.toDataURL()).not.toBe(before));

  // One undo removes the text entirely; a double commit would leave a copy behind.
  await page.getByRole("button", { name: "Undo" }).click();
  await vi.waitFor(() => expect(canvas.toDataURL()).toBe(before));
  await expect.element(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  // Clicking elsewhere commits the open text once and starts a fresh field there.
  await canvasLocator.click({ position: { x: rect.width * 0.25, y: rect.height * 0.4 } });
  await field.fill("Again");
  await canvasLocator.click({ position: { x: rect.width * 0.6, y: rect.height * 0.7 } });
  await expect.element(field).toHaveValue("");
  await userEvent.keyboard("{Escape}");
  await expect.element(field).not.toBeInTheDocument();
  await vi.waitFor(() => expect(canvas.toDataURL()).not.toBe(before));
  await page.getByRole("button", { name: "Undo" }).click();
  await vi.waitFor(() => expect(canvas.toDataURL()).toBe(before));
  await expect.element(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

it("opens the annotator from the image preview toolbar", async () => {
  const source = whiteCanvas(64, 32).toDataURL("image/png");
  await using _screen = await render(<PreviewImage src={source} name="tiny.png" />, {
    router: false,
  });
  const annotate = page.getByRole("button", { name: "Annotate image" });
  await expect.element(annotate).toBeEnabled();
  await annotate.click();
  await expect
    .element(page.getByRole("img", { name: "Annotation canvas for tiny.png" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect
    .element(page.getByRole("img", { name: "Annotation canvas for tiny.png" }))
    .not.toBeInTheDocument();
});

function onePagePdf() {
  const stream = "BT /F1 24 Tf 72 700 Td (Review me) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return URL.createObjectURL(new Blob([body], { type: "application/pdf" }));
}

it("annotates the current PDF page as an image", async () => {
  const url = onePagePdf();
  try {
    await using _screen = await render(<PdfViewer src={url} title="Spec.pdf" />, {
      router: false,
    });
    await expect.element(page.getByText("1 / 1 page"), { timeout: 10_000 }).toBeVisible();
    await page.getByRole("button", { name: "Annotate page" }).click();
    const canvasLocator = page.getByRole("img", { name: "Annotation canvas for Spec page 1" });
    await expect.element(canvasLocator, { timeout: 10_000 }).toBeVisible();
    const canvas = canvasLocator.element() as HTMLCanvasElement;
    // Letter pages render at 2400px on the long side, so the text stays sharp when zoomed.
    expect(Math.max(canvas.width, canvas.height)).toBe(2400);
  } finally {
    URL.revokeObjectURL(url);
  }
});
