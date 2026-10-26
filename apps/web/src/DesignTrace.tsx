import type { Suggestion } from "@icarus/core";
import type { DesignTrace as Trace } from "./design";

interface Props {
  trace: Trace;
  onApply: (suggestion: Suggestion) => void;
}

const cost = (n: number) => n.toFixed(1);

/** What the model decided, what the checks found, what was repaired and what is still open: nothing hidden. */
export function DesignTrace({ trace, onApply }: Props) {
  const tried = trace.rounds.filter((r) => r.source !== "start");
  return (
    <div className="panel-card trace">
      <p className="eyebrow">HOW THIS WAS DESIGNED</p>

      {trace.proposal === "model" ? (
        <>
          <p className="trace-lead">
            The model ({trace.model}) filled in what your brief left open:
          </p>
          <ul className="decisions">
            {trace.decisions.length === 0 && (
              <li className="quiet">It made no further decisions.</li>
            )}
            {trace.decisions.map((d) => (
              <li key={`${d.topic}-${d.choice}`} className={d.used ? undefined : "unused"}>
                <b>{d.topic}:</b> {d.choice}
                {d.used ? null : <em> (not used: the plan measured worse)</em>}
                <span>{d.reason}</span>
              </li>
            ))}
          </ul>
          {[...trace.vetoed, ...trace.ignored].length > 0 && (
            <ul className="setaside">
              {[...trace.vetoed, ...trace.ignored].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="trace-lead">
          Planned with the rules alone.
          {trace.note ? <span className="quiet"> {trace.note}</span> : null}
        </p>
      )}

      <p className="trace-lead">
        Checked and repaired: {trace.startOpen} open issue{trace.startOpen === 1 ? "" : "s"} →{" "}
        <b>{trace.endOpen}</b> (score {cost(trace.startCost)} → {cost(trace.endCost)}).
      </p>
      {tried.length === 0 ? (
        <p className="quiet">Nothing needed changing.</p>
      ) : (
        <ol className="rounds">
          {tried.map((r) => (
            <li
              key={`${r.round}-${r.source}-${r.description}`}
              className={r.accepted ? "kept" : "dropped"}
            >
              <span className="mark" aria-hidden="true">
                {r.accepted ? "✓" : "✕"}
              </span>
              <span>
                <b>{r.accepted ? "Kept" : "Not kept"}</b> ·{" "}
                {r.source === "model" ? "model" : "rules"}: {r.description}
                <small>
                  {r.reason ? `${r.reason} ` : ""}
                  {r.note ? `${r.note} ` : ""}Score {cost(r.cost)}, {r.open} open.
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {trace.revisions.asked > 0 && (
        <p className="quiet">
          The model suggested {trace.revisions.valid} usable revision
          {trace.revisions.valid === 1 ? "" : "s"}; {trace.revisions.used} measured as an
          improvement and {trace.revisions.used === 1 ? "was" : "were"} kept. Every change is kept
          only if the measurements improve.
        </p>
      )}

      {trace.suggestions.length > 0 && (
        <div className="suggestions">
          <p className="trace-lead">
            This cannot be fixed without changing something you stated. Each option below was
            planned and checked:
          </p>
          {trace.suggestions.map((s) => (
            <div key={s.id} className="suggestion">
              <div>
                <b>{s.label}</b>
                <small>{s.detail}</small>
              </div>
              <button type="button" onClick={() => onApply(s)}>
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
