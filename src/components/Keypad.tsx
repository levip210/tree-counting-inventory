"use client";

import { playFeedback } from "@/lib/feedback";

export function Keypad({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const press = (key: string) => {
    if (disabled) return;
    playFeedback(true, true, true);
    if (key === "del") onChange(value.slice(0, -1));
    else if (key === "go") onSubmit();
    else if (value.length < 10) onChange(value + key);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "go"];
  return (
    <div className="keypad">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => press(k)} disabled={disabled} className={k === "del" ? "wide" : ""}>
          {k === "del" ? "⌫" : k === "go" ? "Go" : k}
        </button>
      ))}
    </div>
  );
}
