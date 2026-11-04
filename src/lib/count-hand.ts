export type CountHand = "right" | "left";

/** Missing, empty, or unknown values stay on the original right-handed layout. */
export function normalizeCountHand(value: unknown): CountHand {
  return value === "left" ? "left" : "right";
}

/**
 * Equal button columns plus a fixed size track.
 * Right-handed: sizes on the left. Left-handed: sizes on the right.
 */
export function countGridColumns(hand: CountHand, gradeCount: number): string {
  const grades = Math.max(0, Math.floor(gradeCount));
  const sizeTrack = "minmax(4.5rem, 7.5rem)";
  const buttonTrack = grades > 0 ? `repeat(${grades}, minmax(0, 1fr))` : "minmax(0, 1fr)";
  return hand === "left" ? `${buttonTrack} ${sizeTrack}` : `${sizeTrack} ${buttonTrack}`;
}
