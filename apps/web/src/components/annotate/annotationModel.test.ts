import { describe, expect, it } from "vite-plus/test";

import {
  type Annotation,
  annotationWorkingSize,
  commitAnnotations,
  currentAnnotations,
  EMPTY_ANNOTATION_HISTORY,
  isMeaningfulAnnotation,
  redoAnnotation,
  undoAnnotation,
} from "./annotationModel";
import { annotatedFileName } from "./annotationSources";

const box = (x: number): Annotation => ({
  kind: "rect",
  color: "#000000",
  width: 2,
  from: { x, y: 0 },
  to: { x: x + 10, y: 10 },
});

describe("annotation history", () => {
  it("undoes, redoes, and drops the redo branch on a new commit", () => {
    const one = commitAnnotations(EMPTY_ANNOTATION_HISTORY, [box(0)]);
    const two = commitAnnotations(one, [box(0), box(20)]);
    expect(currentAnnotations(undoAnnotation(two))).toEqual([box(0)]);
    expect(currentAnnotations(redoAnnotation(undoAnnotation(two)))).toHaveLength(2);
    const branched = commitAnnotations(undoAnnotation(two), [box(0), box(40)]);
    expect(redoAnnotation(branched)).toBe(branched);
    expect(currentAnnotations(undoAnnotation(undoAnnotation(undoAnnotation(two))))).toEqual([]);
  });

  it("keeps clear-all undoable", () => {
    const cleared = commitAnnotations(commitAnnotations(EMPTY_ANNOTATION_HISTORY, [box(0)]), []);
    expect(currentAnnotations(cleared)).toEqual([]);
    expect(currentAnnotations(undoAnnotation(cleared))).toEqual([box(0)]);
  });
});

describe("annotation inputs", () => {
  it("ignores clicks that would leave an invisible shape", () => {
    const click = {
      kind: "arrow",
      color: "#000",
      width: 2,
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
    };
    expect(isMeaningfulAnnotation(click as Annotation, 4)).toBe(false);
    expect(isMeaningfulAnnotation(box(0), 4)).toBe(true);
    expect(
      isMeaningfulAnnotation(
        { kind: "text", color: "#000", size: 12, at: { x: 0, y: 0 }, text: " " },
        4,
      ),
    ).toBe(false);
  });

  it("caps the working canvas and keeps the aspect ratio", () => {
    expect(annotationWorkingSize(8192, 2048)).toEqual({ width: 4096, height: 1024 });
    expect(annotationWorkingSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("names exports after the source file", () => {
    expect(annotatedFileName("/repo/docs/diagram.final.jpg")).toBe("diagram.final-annotated.png");
    expect(annotatedFileName("Spec page 3")).toBe("Spec page 3-annotated.png");
    expect(annotatedFileName("")).toBe("image-annotated.png");
  });
});
