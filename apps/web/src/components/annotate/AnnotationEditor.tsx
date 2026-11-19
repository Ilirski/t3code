import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  HighlighterIcon,
  MoveUpRightIcon,
  PaperclipIcon,
  PencilIcon,
  Redo2Icon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { requestConfirmDialog } from "~/confirmDialog";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ANNOTATION_COLORS,
  annotationFont,
  annotationSizes,
  canRedoAnnotation,
  canUndoAnnotation,
  commitAnnotations,
  currentAnnotations,
  drawAnnotation,
  EMPTY_ANNOTATION_HISTORY,
  isMeaningfulAnnotation,
  redoAnnotation,
  undoAnnotation,
  type Annotation,
  type AnnotationPoint,
  type AnnotationTool,
} from "./annotationModel";
import { annotatedFileName, type AnnotationImage } from "./annotationSources";

const TOOLS: ReadonlyArray<{
  readonly tool: AnnotationTool;
  readonly label: string;
  readonly key: string;
  readonly Icon: typeof PencilIcon;
}> = [
  { tool: "pen", label: "Pen", key: "p", Icon: PencilIcon },
  { tool: "highlighter", label: "Highlighter", key: "h", Icon: HighlighterIcon },
  { tool: "arrow", label: "Arrow", key: "a", Icon: MoveUpRightIcon },
  { tool: "rect", label: "Box", key: "b", Icon: SquareIcon },
  { tool: "text", label: "Text", key: "t", Icon: TypeIcon },
];

interface TextDraft {
  readonly at: AnnotationPoint;
  readonly left: number;
  readonly top: number;
  readonly value: string;
}

function IconAction(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            // Native `disabled` drops focus out of the dialog when a press disables its own button.
            aria-disabled={props.disabled || undefined}
            onClick={props.disabled ? undefined : props.onPress}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be exported."))),
      "image/png",
    );
  });
}

export default function AnnotationEditor(props: {
  readonly name: string;
  readonly load: () => Promise<AnnotationImage>;
  readonly onClose: () => void;
}) {
  const [loading] = useState(props.load);
  const [image, setImage] = useState<AnnotationImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
  const [history, setHistory] = useState(EMPTY_ANNOTATION_HISTORY);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef<Annotation | null>(null);
  // Only the pointer that started a shape may extend or finish it; a second finger is ignored.
  const pointerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  // Blur and the next click can both try to commit the same text; the ref lets only one win.
  const textRef = useRef<TextDraft | null>(null);
  const composer = useComposerHandleContext();
  const annotations = currentAnnotations(history);
  const sizes = image ? annotationSizes(image.width, image.height) : null;
  const displayScale =
    image && viewport.width > 0
      ? Math.min(2, viewport.width / image.width, viewport.height / image.height)
      : 0;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Resolves the image loader started on mount; cancellation ignores a result that lands after close.
  useEffect(() => {
    let cancelled = false;
    loading.then(
      (loaded) => {
        if (!cancelled) setImage(loaded);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "This file could not be opened.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loading]);

  // The dialog portal mounts its children after the first commit, so a mount effect would see no stage.
  const measureStage = (node: HTMLDivElement) => {
    const update = () =>
      setViewport({
        width: Math.max(1, node.clientWidth - 32),
        height: Math.max(1, node.clientHeight - 32),
      });
    update();
    return observeResize(node, update);
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    for (const annotation of annotations) drawAnnotation(context, annotation);
    if (draftRef.current) drawAnnotation(context, draftRef.current);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Paints committed annotations onto the canvas, which React does not render.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    // A queued frame holds the previous render's annotations and would erase a fresh commit.
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    redraw();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancels a pending draft repaint when the editor closes.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const scheduleRedraw = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      redraw();
    });
  };

  const commit = (annotation: Annotation) => {
    if (!sizes || !isMeaningfulAnnotation(annotation, sizes.pen * 2)) return;
    setHistory((current) =>
      commitAnnotations(current, [...currentAnnotations(current), annotation]),
    );
  };

  const editText = (draft: TextDraft | null) => {
    textRef.current = draft;
    setTextDraft(draft);
  };

  const commitText = () => {
    const draft = textRef.current;
    if (!draft || !sizes) return;
    editText(null);
    commit({ kind: "text", color, size: sizes.text, at: draft.at, text: draft.value });
  };

  const imagePoint = (event: ReactPointerEvent<HTMLCanvasElement>): AnnotationPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * event.currentTarget.width) / rect.width,
      y: ((event.clientY - rect.top) * event.currentTarget.height) / rect.height,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!sizes || event.button !== 0 || pointerRef.current !== null) return;
    const point = imagePoint(event);
    commitText();
    if (tool === "text") {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      editText({
        at: point,
        left: event.clientX - rect.left,
        top: event.clientY - rect.top,
        value: "",
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    draftRef.current =
      tool === "pen" || tool === "highlighter"
        ? {
            kind: "stroke",
            color,
            width: tool === "pen" ? sizes.pen : sizes.highlighter,
            opacity: tool === "pen" ? 1 : 0.35,
            points: [point],
          }
        : { kind: tool, color, width: sizes[tool], from: point, to: point };
    scheduleRedraw();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    if (!draft || !sizes || event.pointerId !== pointerRef.current) return;
    const point = imagePoint(event);
    if (draft.kind === "stroke") {
      const last = draft.points[draft.points.length - 1];
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < sizes.pen / 2) return;
      draftRef.current = { ...draft, points: [...draft.points, point] };
    } else if (draft.kind === "arrow" || draft.kind === "rect") {
      draftRef.current = { ...draft, to: point };
    }
    scheduleRedraw();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    const draft = draftRef.current;
    pointerRef.current = null;
    draftRef.current = null;
    if (draft) commit(draft);
    scheduleRedraw();
  };

  const exportFile = async () => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("The image is not ready yet.");
    return new File([await canvasToPng(canvas)], annotatedFileName(props.name), {
      type: "image/png",
    });
  };

  const reportFailure = (title: string, cause: unknown) => {
    toastManager.add({
      type: "error",
      title,
      description: cause instanceof Error ? cause.message : undefined,
    });
  };

  const attach = () => {
    const target = composer?.current;
    if (!target) return;
    void exportFile().then(
      (file) => {
        target.addDroppedFiles([file]);
        props.onClose();
      },
      (cause: unknown) => reportFailure("Could not add the annotated image", cause),
    );
  };

  const copy = () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      reportFailure("Image copying is unavailable", undefined);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The clipboard write must start inside the click; the PNG encodes afterwards.
    navigator.clipboard.write([new ClipboardItem({ "image/png": canvasToPng(canvas) })]).then(
      () => {
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      },
      (cause: unknown) => reportFailure("Could not copy the image", cause),
    );
  };

  const save = () => {
    void exportFile().then(
      (file) => {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      },
      (cause: unknown) => reportFailure("Could not save the image", cause),
    );
  };

  const requestClose = () => {
    if (annotations.length === 0 && !textDraft) {
      props.onClose();
      return;
    }
    const confirmation = requestConfirmDialog("Discard your annotations?", {
      variant: "destructive",
    });
    if (!confirmation) {
      props.onClose();
      return;
    }
    void confirmation.then((confirmed) => {
      if (confirmed) props.onClose();
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      setHistory(event.shiftKey ? redoAnnotation : undoAnnotation);
    } else if (mod && key === "y") {
      event.preventDefault();
      setHistory(redoAnnotation);
    } else if (!mod && !event.altKey) {
      const match = TOOLS.find((entry) => entry.key === key);
      if (match) setTool(match.tool);
    }
  };

  const ready = image !== null && displayScale > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="h-[92vh] w-[94vw] max-w-[94vw] overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <div className="mr-2 min-w-0 max-w-64">
              <DialogTitle>
                <span className="block truncate">{props.name}</span>
              </DialogTitle>
            </div>
            <ToggleGroup
              aria-label="Annotation tool"
              value={[tool]}
              onValueChange={(next) => {
                const value = TOOLS.find((entry) => entry.tool === next[0]);
                if (value) setTool(value.tool);
              }}
            >
              {TOOLS.map(({ tool: value, label, key, Icon }) => (
                <Tooltip key={value}>
                  <TooltipTrigger
                    render={
                      <Toggle value={value} aria-label={label} size="sm">
                        <Icon className="size-4" />
                      </Toggle>
                    }
                  />
                  <TooltipPopup>{`${label} (${key.toUpperCase()})`}</TooltipPopup>
                </Tooltip>
              ))}
            </ToggleGroup>
            <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
              {ANNOTATION_COLORS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={color === entry.value}
                  aria-label={entry.name}
                  onClick={() => setColor(entry.value)}
                  className={cn(
                    "size-5 rounded-full border border-border",
                    color === entry.value &&
                      "ring-2 ring-ring ring-offset-1 ring-offset-background",
                  )}
                  style={{ backgroundColor: entry.value }}
                />
              ))}
            </div>
            <div className="flex items-center">
              <IconAction
                label="Undo"
                disabled={!canUndoAnnotation(history)}
                onPress={() => setHistory(undoAnnotation)}
              >
                <Undo2Icon className="size-4" />
              </IconAction>
              <IconAction
                label="Redo"
                disabled={!canRedoAnnotation(history)}
                onPress={() => setHistory(redoAnnotation)}
              >
                <Redo2Icon className="size-4" />
              </IconAction>
              <IconAction
                label="Clear all"
                disabled={annotations.length === 0}
                onPress={() => setHistory((current) => commitAnnotations(current, []))}
              >
                <Trash2Icon className="size-4" />
              </IconAction>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <IconAction label={copied ? "Copied" : "Copy image"} disabled={!ready} onPress={copy}>
                {copied ? (
                  <CheckIcon className="size-4 text-primary" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </IconAction>
              <IconAction label="Save image" disabled={!ready} onPress={save}>
                <DownloadIcon className="size-4" />
              </IconAction>
              {composer ? (
                <Button type="button" size="sm" disabled={!ready} onClick={attach}>
                  <PaperclipIcon className="size-4" />
                  Add to chat
                </Button>
              ) : null}
              <IconAction label="Close" onPress={requestClose}>
                <XIcon className="size-4" />
              </IconAction>
            </div>
          </div>
          <div
            ref={measureStage}
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/40"
          >
            {error ? (
              <p role="alert" className="px-6 text-center text-sm text-destructive">
                {error}
              </p>
            ) : !ready ? (
              <Spinner size="lg" />
            ) : (
              <div
                className="relative shrink-0 shadow-lg"
                style={{ width: image.width * displayScale, height: image.height * displayScale }}
              >
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label={`Annotation canvas for ${props.name}`}
                  className={cn(
                    "block size-full touch-none",
                    tool === "text" ? "cursor-text" : "cursor-crosshair",
                  )}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onLostPointerCapture={onPointerUp}
                />
                {textDraft && sizes ? (
                  <input
                    autoFocus
                    aria-label="Annotation text"
                    value={textDraft.value}
                    onChange={(event) => editText({ ...textDraft, value: event.target.value })}
                    onBlur={commitText}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitText();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        editText(null);
                      }
                    }}
                    className="absolute min-w-24 border border-dashed border-ring bg-transparent p-0 outline-none"
                    // Offsets cancel the 1px border so the text box starts at the click, as drawn on commit.
                    style={{
                      left: textDraft.left - 1,
                      top: textDraft.top - 1,
                      color,
                      font: annotationFont(sizes.text * displayScale),
                    }}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
