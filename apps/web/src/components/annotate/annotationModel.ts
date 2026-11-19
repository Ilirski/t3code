export type AnnotationTool = "pen" | "highlighter" | "arrow" | "rect" | "text";

export interface AnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export type Annotation =
  | {
      readonly kind: "stroke";
      readonly color: string;
      readonly width: number;
      readonly opacity: number;
      readonly points: readonly AnnotationPoint[];
    }
  | {
      readonly kind: "arrow" | "rect";
      readonly color: string;
      readonly width: number;
      readonly from: AnnotationPoint;
      readonly to: AnnotationPoint;
    }
  | {
      readonly kind: "text";
      readonly color: string;
      readonly size: number;
      readonly at: AnnotationPoint;
      readonly text: string;
    };

export const ANNOTATION_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#facc15" },
  { name: "Green", value: "#22c55e" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Black", value: "#111111" },
  { name: "White", value: "#ffffff" },
] as const;

/** Longest side of the working canvas; larger images are downscaled before editing. */
const ANNOTATION_MAX_DIMENSION = 4096;

export function annotationWorkingSize(width: number, height: number) {
  const scale = Math.min(1, ANNOTATION_MAX_DIMENSION / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Stroke sizes scale with the image so marks read the same on a thumbnail and a 4K screenshot. */
export function annotationSizes(width: number, height: number) {
  const base = Math.max(2, Math.round(Math.max(width, height) / 400));
  return {
    pen: base,
    highlighter: base * 6,
    arrow: Math.round(base * 1.5),
    rect: base,
    text: Math.max(14, base * 9),
  };
}

export interface AnnotationHistory {
  readonly stack: readonly (readonly Annotation[])[];
  readonly index: number;
}

export const EMPTY_ANNOTATION_HISTORY: AnnotationHistory = { stack: [[]], index: 0 };

export function currentAnnotations(history: AnnotationHistory): readonly Annotation[] {
  return history.stack[history.index] ?? [];
}

export function commitAnnotations(
  history: AnnotationHistory,
  next: readonly Annotation[],
): AnnotationHistory {
  return { stack: [...history.stack.slice(0, history.index + 1), next], index: history.index + 1 };
}

export const canUndoAnnotation = (history: AnnotationHistory) => history.index > 0;
export const canRedoAnnotation = (history: AnnotationHistory) =>
  history.index < history.stack.length - 1;

export function undoAnnotation(history: AnnotationHistory): AnnotationHistory {
  return canUndoAnnotation(history) ? { ...history, index: history.index - 1 } : history;
}

export function redoAnnotation(history: AnnotationHistory): AnnotationHistory {
  return canRedoAnnotation(history) ? { ...history, index: history.index + 1 } : history;
}

/** Drops a shape too small to have been intended, such as a click with the arrow tool. */
export function isMeaningfulAnnotation(annotation: Annotation, minLength: number): boolean {
  switch (annotation.kind) {
    case "stroke":
      return annotation.points.length > 0;
    case "arrow":
      return (
        Math.hypot(annotation.to.x - annotation.from.x, annotation.to.y - annotation.from.y) >=
        minLength
      );
    case "rect":
      return (
        Math.abs(annotation.to.x - annotation.from.x) >= minLength &&
        Math.abs(annotation.to.y - annotation.from.y) >= minLength
      );
    case "text":
      return annotation.text.trim().length > 0;
  }
}

function arrowHeadPoints(
  from: AnnotationPoint,
  to: AnnotationPoint,
  width: number,
): readonly [AnnotationPoint, AnnotationPoint] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.min(width * 5, Math.hypot(to.x - from.x, to.y - from.y) * 0.6);
  const spread = Math.PI / 7;
  return [
    {
      x: to.x - length * Math.cos(angle - spread),
      y: to.y - length * Math.sin(angle - spread),
    },
    {
      x: to.x - length * Math.cos(angle + spread),
      y: to.y - length * Math.sin(angle + spread),
    },
  ];
}

function contrastColor(color: string): string {
  const hex = color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = (0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

export function annotationFont(size: number): string {
  return `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
}

export function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation): void {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  switch (annotation.kind) {
    case "stroke": {
      const [first, ...rest] = annotation.points;
      if (!first) break;
      context.globalAlpha = annotation.opacity;
      context.strokeStyle = annotation.color;
      context.lineWidth = annotation.width;
      context.beginPath();
      context.moveTo(first.x, first.y);
      if (rest.length === 0) {
        context.lineTo(first.x + 0.01, first.y);
      }
      // Quadratic segments through midpoints smooth the jitter of raw pointer samples.
      let previous = first;
      for (const point of rest) {
        const mid = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
        context.quadraticCurveTo(previous.x, previous.y, mid.x, mid.y);
        previous = point;
      }
      if (rest.length > 0) context.lineTo(previous.x, previous.y);
      context.stroke();
      break;
    }
    case "arrow": {
      const [left, right] = arrowHeadPoints(annotation.from, annotation.to, annotation.width);
      context.strokeStyle = annotation.color;
      context.lineWidth = annotation.width;
      context.beginPath();
      context.moveTo(annotation.from.x, annotation.from.y);
      context.lineTo(annotation.to.x, annotation.to.y);
      context.moveTo(left.x, left.y);
      context.lineTo(annotation.to.x, annotation.to.y);
      context.lineTo(right.x, right.y);
      context.stroke();
      break;
    }
    case "rect": {
      context.strokeStyle = annotation.color;
      context.lineWidth = annotation.width;
      context.strokeRect(
        Math.min(annotation.from.x, annotation.to.x),
        Math.min(annotation.from.y, annotation.to.y),
        Math.abs(annotation.to.x - annotation.from.x),
        Math.abs(annotation.to.y - annotation.from.y),
      );
      break;
    }
    case "text": {
      context.font = annotationFont(annotation.size);
      // `at` is the top of a CSS `line-height: normal` line box, where the typing input put the text.
      const ascent = context.measureText(annotation.text).fontBoundingBoxAscent;
      // A halo in the contrasting colour keeps text legible on any background.
      context.strokeStyle = contrastColor(annotation.color);
      context.lineWidth = Math.max(2, annotation.size / 6);
      annotation.text.split("\n").forEach((line, index) => {
        const y = annotation.at.y + ascent + index * annotation.size * 1.2;
        context.strokeText(line, annotation.at.x, y);
        context.fillStyle = annotation.color;
        context.fillText(line, annotation.at.x, y);
      });
      break;
    }
  }
  context.restore();
}
