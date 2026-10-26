/** Normalize a free-form color to #RRGGBB, or null when empty/invalid. */
export function normalizeSizeColor(input: unknown): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const hex = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    const r = hex[1];
    const g = hex[2];
    const b = hex[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/** Dark ink on light colors, cream on dark colors — keeps size chips readable. */
export function contrastInk(color: string | null | undefined): string {
  const hex = normalizeSizeColor(color);
  if (!hex) return "#1b1710";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#1b1710" : "#f4efe3";
}
