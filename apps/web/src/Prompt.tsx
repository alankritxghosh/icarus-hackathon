import { useState } from "react";

interface Props {
  placeholder: string;
  onBuild: (text: string) => void;
  disabled?: boolean;
  hint?: string;
  initial?: string;
  compact?: boolean;
}

export function Prompt({ placeholder, onBuild, disabled, hint, initial = "", compact }: Props) {
  const [text, setText] = useState(initial);
  const submit = () => {
    if (!disabled && text.trim()) onBuild(text.trim());
  };
  return (
    <div className={`prompt${compact ? " compact" : ""}${disabled ? " off" : ""}`}>
      <textarea
        value={disabled && hint ? "" : text}
        placeholder={disabled && hint ? hint : placeholder}
        disabled={disabled}
        rows={compact ? 2 : 3}
        aria-label="Describe your office"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="prompt-foot">
        <span className="scope">Office</span>
        <button
          type="button"
          className="build"
          disabled={disabled || !text.trim()}
          onClick={submit}
        >
          BUILD ↗
        </button>
      </div>
    </div>
  );
}
