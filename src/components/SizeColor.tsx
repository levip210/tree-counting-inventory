"use client";

import { useEffect, useState } from "react";
import { contrastInk, normalizeSizeColor } from "@/lib/size-color";

export function SizeColorPicker({
  value,
  onChange,
  id,
}: {
  value?: string | null;
  onChange: (color: string | null) => void;
  id?: string;
}) {
  const normalized = normalizeSizeColor(value);
  const pickerValue = normalized || "#808080";
  const [hex, setHex] = useState(normalized || "");

  useEffect(() => {
    setHex(normalized || "");
  }, [normalized]);

  return (
    <div className="size-color-picker">
      <input
        id={id}
        type="color"
        aria-label="Size color"
        title="Pick any color"
        value={pickerValue}
        onChange={(e) => onChange(normalizeSizeColor(e.target.value))}
      />
      <input
        aria-label="Size color hex"
        placeholder="#RRGGBB"
        value={hex}
        spellCheck={false}
        onChange={(e) => setHex(e.target.value)}
        onBlur={() => {
          const next = hex.trim();
          if (!next) {
            onChange(null);
            return;
          }
          const parsed = normalizeSizeColor(next);
          if (parsed) onChange(parsed);
          else setHex(normalized || "");
        }}
      />
      {normalized ? (
        <button className="btn cream" type="button" onClick={() => onChange(null)}>
          Clear
        </button>
      ) : (
        <span className="size-color-empty">No color</span>
      )}
    </div>
  );
}

export function SizeNameChip({
  name,
  color,
  compact,
}: {
  name: string;
  color?: string | null;
  compact?: boolean;
}) {
  const hex = normalizeSizeColor(color);
  if (!hex) return <span>{name}</span>;
  return (
    <span
      className={`size-chip${compact ? " compact" : ""}`}
      style={{ backgroundColor: hex, color: contrastInk(hex) }}
    >
      <span className="size-swatch" style={{ backgroundColor: hex }} aria-hidden />
      {name}
    </span>
  );
}
