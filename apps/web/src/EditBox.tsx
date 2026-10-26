import { useState } from "react";
import type { EditEntry } from "./design";

interface Props {
  /** Rooms the user has locked, by display name, with a way to release each. */
  locked: { id: string; name: string }[];
  /** Runs the request; resolves with what to show. */
  onSubmit: (text: string) => Promise<EditEntry>;
  onUnlock: (id: string) => void;
}

const EXAMPLES = [
  "Move the kitchen east",
  "Add a third phone booth",
  "Swap reception and the lounge",
];

const MARK: Record<EditEntry["lines"][number]["status"], string> = {
  applied: "✓",
  unchanged: "•",
  refused: "✕",
  note: "•",
};

/** Change the design by typing what you want. Every line says what was measured and kept or refused. */
export function EditBox({ locked, onSubmit, onUnlock }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<EditEntry>();

  const run = async (value: string) => {
    const said = value.trim();
    if (!said || busy) return;
    setBusy(true);
    try {
      setLast(await onSubmit(said));
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-card editbox">
      <p className="eyebrow">CHANGE IT WITH WORDS</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
      >
        <input
          type="text"
          value={text}
          disabled={busy}
          maxLength={300}
          placeholder="e.g. move the kitchen east"
          aria-label="Change the office in words"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {busy ? "Working…" : "Apply"}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" disabled={busy} onClick={() => void run(example)}>
            {example}
          </button>
        ))}
      </div>
      {last && (
        <ul className="edit-lines" aria-live="polite">
          {last.lines.map((line) => (
            <li key={`${line.status}-${line.text}`} className={line.status}>
              <span className="glyph" aria-hidden="true">
                {MARK[line.status]}
              </span>
              <span>{line.text}</span>
            </li>
          ))}
          {last.by === "model" && (
            <li className="quiet">
              The model read this request; the plan was changed by the same checked operations.
            </li>
          )}
        </ul>
      )}
      {locked.length > 0 && (
        <p className="locks">
          Locked in place:{" "}
          {locked.map((room) => (
            <button
              key={room.id}
              type="button"
              className="chip"
              title="Unlock"
              onClick={() => onUnlock(room.id)}
            >
              {room.name} ✕
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
