import { type AccountLesson, teach } from "@icarus/spatial/model";
import { useState } from "react";

/** Say a rule in your own words; Icarus keeps it and checks every design against it. */
export function TeachPanel({
  lessons,
  onChange,
}: {
  lessons: AccountLesson[];
  onChange: (next: AccountLesson[]) => void;
}) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | undefined>();

  const submit = () => {
    if (!text.trim()) return;
    const { lessons: next, added } = teach(lessons, text);
    if (!added) {
      setMessage(
        lessons.length >= 50
          ? "That is as many lessons as one account can keep."
          : "I could not understand that. Try “never put plants in the kitchen”, “always put a bin in the kitchen” or “no carpet in the kitchen”.",
      );
      return;
    }
    setMessage(undefined);
    setText("");
    onChange(next);
  };

  return (
    <div className="panel-card">
      <p className="eyebrow">TEACH ICARUS</p>
      <p className="hint">
        Rules only for you. Icarus checks every design against them and tells you when one is
        broken.
      </p>
      <label className="field">
        <input
          type="text"
          value={text}
          placeholder="never put plants in the kitchen"
          maxLength={300}
          aria-label="A rule in your own words"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button type="button" className="ghost" onClick={submit}>
          Teach
        </button>
      </label>
      {message && (
        <p className="hint" role="alert">
          {message}
        </p>
      )}
      {lessons.length > 0 && (
        <ul className="evidence">
          {lessons.map((l) => (
            <li key={l.id} className="info">
              <b>{l.said}</b>
              <span>
                {l.date}{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => onChange(lessons.filter((x) => x.id !== l.id))}
                >
                  forget this
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
