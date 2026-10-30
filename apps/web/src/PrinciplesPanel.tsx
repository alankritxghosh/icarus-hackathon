import { reviewAgainstPrinciples } from "@icarus/spatial/model";
import { useMemo, useState } from "react";
import type { Built } from "./design";

const LABEL = {
  checked: "Checked",
  "not-applicable": "Does not apply",
  "not-assessable": "Cannot be judged yet",
} as const;

/**
 * The design principles that concern this design, and why the others were left out. Icarus holds a design only against
 * the principles it has data for, says so for the rest, and never reports a pass it cannot back.
 */
export function PrinciplesPanel({ built }: { built: Built }) {
  const [open, setOpen] = useState(false);
  const review = useMemo(() => reviewAgainstPrinciples(built.model), [built.model]);
  const count = (s: keyof typeof LABEL) => review.decisions.filter((d) => d.status === s).length;

  return (
    <div className="panel-card">
      <p className="eyebrow">DESIGN PRINCIPLES</p>
      <p className="hint">
        {count("checked")} checked, {count("not-applicable")} do not apply,{" "}
        {count("not-assessable")} cannot be judged from this model.
      </p>
      {review.top.length > 0 ? (
        <ul className="evidence">
          {review.top.map((f) => (
            <li
              key={`${f.code}-${f.ids.join("-")}`}
              className={f.level === "error" ? "fail" : "warn"}
            >
              <b>{f.level === "error" ? "Worth fixing" : "Worth a look"}</b>
              <span>{f.message}.</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing to raise under the principles that were checked.</p>
      )}
      {review.heldBack > 0 && (
        <p className="hint">{review.heldBack} smaller findings are held back.</p>
      )}
      <button type="button" className="link" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} Why each principle was or was not used
      </button>
      {open && (
        <ul className="notes">
          {review.decisions.map((d) => (
            <li key={d.principle}>
              {d.principle}. {d.name}: {LABEL[d.status]}. {d.reason}.
              {d.source ? ` Source: ${d.source}.` : ""}
            </li>
          ))}
          <li>{review.note}</li>
        </ul>
      )}
    </div>
  );
}
