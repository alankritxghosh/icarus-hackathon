import type { Program } from "@icarus/core";
import { useState } from "react";
import { type Form, fromProgram, OPTIONAL_LABEL, SIDES, toProgram } from "./editForm";

interface Props {
  program: Program;
  seed: number;
  onApply: (program: Program, seed: number) => void;
  onBack: () => void;
}

export function EditPanel({ program, seed, onApply, onBack }: Props) {
  const [form, setForm] = useState<Form>(() => fromProgram(program, seed));
  const [error, setError] = useState<string>();
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const num = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(key, Number(e.target.value) as never);

  const apply = () => {
    const parsed = toProgram(form, program.assumptions);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(" ")}: ${i.message}`).join("; "));
      return;
    }
    setError(undefined);
    onApply(parsed.data, form.seed);
  };

  return (
    <div className="edit">
      <button type="button" className="ghost" onClick={onBack}>
        ← Back
      </button>
      <h3>People</h3>
      <label>
        Headcount
        <input type="number" min={2} max={500} value={form.headcount} onChange={num("headcount")} />
      </label>
      <h3>The space</h3>
      <div className="row">
        <label>
          Width m
          <input type="number" min={6} max={80} value={form.width} onChange={num("width")} />
        </label>
        <label>
          Depth m
          <input type="number" min={6} max={80} value={form.depth} onChange={num("depth")} />
        </label>
        <label>
          Ceiling m
          <input
            type="number"
            step={0.1}
            min={2.4}
            max={6}
            value={form.ceiling}
            onChange={num("ceiling")}
          />
        </label>
      </div>
      <label>
        Entrance wall
        <select
          value={form.entrance}
          onChange={(e) => set("entrance", e.target.value as Form["entrance"])}
        >
          {SIDES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <fieldset className="chips" aria-label="Windows on">
        <span>Windows on</span>
        {SIDES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={form.windows[s]}
            onClick={() => set("windows", { ...form.windows, [s]: !form.windows[s] })}
          >
            {s}
          </button>
        ))}
      </fieldset>
      <h3>Rooms</h3>
      <div className="row">
        <label>
          Meeting rooms
          <input
            type="number"
            min={0}
            max={8}
            value={form.meetingRooms}
            onChange={num("meetingRooms")}
          />
        </label>
        <label>
          Seats each
          <input
            type="number"
            min={2}
            max={20}
            value={form.meetingCapacity}
            onChange={num("meetingCapacity")}
          />
        </label>
      </div>
      <div className="row">
        <label>
          Private offices
          <input
            type="number"
            min={0}
            max={8}
            value={form.privateOffices}
            onChange={num("privateOffices")}
          />
        </label>
        <label>
          Phone booths
          <input
            type="number"
            min={0}
            max={8}
            value={form.phoneBooths}
            onChange={num("phoneBooths")}
          />
        </label>
        <label>
          Restrooms
          <input type="number" min={1} max={4} value={form.restrooms} onChange={num("restrooms")} />
        </label>
      </div>
      <fieldset className="chips" aria-label="Spaces to include">
        {(Object.keys(OPTIONAL_LABEL) as (keyof Form["optional"])[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={form.optional[k]}
            onClick={() => set("optional", { ...form.optional, [k]: !form.optional[k] })}
          >
            {OPTIONAL_LABEL[k]}
          </button>
        ))}
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="primary" onClick={apply}>
        Apply changes
      </button>
    </div>
  );
}
