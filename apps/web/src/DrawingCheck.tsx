import type { EvidenceItem } from "@icarus/core";
import { useState } from "react";
import type { Built } from "./design";
import { checkAgainstDrawing, DrawingError } from "./drawingAuditClient";

/** Upload a PDF drawing and see where this design disagrees with it. */
export function DrawingCheck({ built }: { built: Built }) {
  const [ratio, setRatio] = useState("100");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "error"; message: string }
    | { kind: "done"; items: EvidenceItem[] }
  >({ kind: "idle" });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setState({ kind: "busy" });
    try {
      setState({
        kind: "done",
        items: await checkAgainstDrawing(file, file.name, Number(ratio), built),
      });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof DrawingError ? error.message : "The drawing could not be checked.",
      });
    }
  };

  return (
    <div className="panel-card">
      <p className="eyebrow">CHECK AGAINST A DRAWING</p>
      <p className="hint">
        For a design that should follow a supplied PDF drawing. A freshly generated office will not
        match one.
      </p>
      <label className="field">
        Printed at 1:
        <input
          type="number"
          min={1}
          max={5000}
          value={ratio}
          onChange={(e) => setRatio(e.target.value)}
          aria-label="Scale the drawing was printed at"
        />
      </label>
      <label className="field">
        <input
          type="file"
          accept="application/pdf"
          disabled={state.kind === "busy"}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {state.kind === "busy" && <p className="hint">Reading the drawing…</p>}
      {state.kind === "error" && (
        <p className="hint" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <ul className="evidence">
          {state.items.map((e) => (
            <li key={e.id} className={e.status}>
              <b>{e.label}</b>
              <span>{e.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
