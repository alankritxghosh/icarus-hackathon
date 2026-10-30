import type { EvidenceItem } from "@icarus/core";
import { useState } from "react";
import type { Built } from "./design";
import { saveFile } from "./download";
import { checkAgainstDrawing, DrawingError, drawingAsModel } from "./drawingAuditClient";

/** Upload a PDF drawing and see where this design disagrees with it. */
export function DrawingCheck({ built }: { built: Built }) {
  const [ratio, setRatio] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "error"; message: string }
    | { kind: "done"; items: EvidenceItem[] }
  >({ kind: "idle" });

  const [last, setLast] = useState<File | undefined>();
  const [asModel, setAsModel] = useState<EvidenceItem | undefined>();
  const scale = () => (ratio.trim() === "" ? undefined : Number(ratio));

  const downloadModel = async () => {
    if (!last) return;
    setAsModel(undefined);
    try {
      const made = await drawingAsModel(last, last.name, scale());
      const stem =
        last.name
          .replace(/\.pdf$/i, "")
          .replace(/[^A-Za-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase() || "drawing";
      saveFile(`icarus-${stem}-from-drawing.dxf`, made.dxf, "image/vnd.dxf");
      setAsModel(made.summary);
    } catch (error) {
      setAsModel({
        id: "drawing-model",
        label: "Plan read from the drawing",
        status: "fail",
        detail: error instanceof DrawingError ? error.message : "The plan could not be read.",
      });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setLast(file);
    setAsModel(undefined);
    setState({ kind: "busy" });
    try {
      setState({
        kind: "done",
        items: await checkAgainstDrawing(
          file,
          file.name,
          ratio.trim() === "" ? undefined : Number(ratio),
          built,
        ),
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
        Printed at 1: (empty reads it from the sheet)
        <input
          type="number"
          min={1}
          max={5000}
          value={ratio}
          placeholder="auto"
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
      {last && state.kind === "done" && (
        <button type="button" className="ghost" onClick={() => void downloadModel()}>
          Download the plan read from this drawing (.dxf)
        </button>
      )}
      {asModel && (
        <ul className="evidence">
          <li className={asModel.status}>
            <b>{asModel.label}</b>
            <span>{asModel.detail}</span>
          </li>
        </ul>
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
