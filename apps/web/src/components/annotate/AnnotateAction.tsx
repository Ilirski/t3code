import { PenLineIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { FileSurfaceAction } from "../files/fileSurfaceChrome";
import type { AnnotationImage } from "./annotationSources";

const AnnotationEditor = lazy(() => import("./AnnotationEditor"));

/** Toolbar button that opens the annotator on whatever image `load` produces at click time. */
export function AnnotateAction(props: {
  readonly label: string;
  readonly name: string;
  readonly disabled?: boolean;
  readonly load: () => Promise<AnnotationImage>;
}) {
  const [session, setSession] = useState<{
    readonly name: string;
    readonly load: () => Promise<AnnotationImage>;
  } | null>(null);
  return (
    <>
      <FileSurfaceAction
        label={props.label}
        disabled={props.disabled ?? false}
        onPress={() => setSession({ name: props.name, load: props.load })}
      >
        <PenLineIcon className="size-3.5" />
      </FileSurfaceAction>
      {session ? (
        <Suspense fallback={null}>
          <AnnotationEditor
            name={session.name}
            load={session.load}
            onClose={() => setSession(null)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
