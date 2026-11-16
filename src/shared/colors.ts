import type { HighlightColor } from "./types";

/** Central palette; change here to reconfigure colours everywhere. */
export const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#fde047",
  green: "#86efac",
  blue: "#93c5fd",
  pink: "#f9a8d4",
  purple: "#d8b4fe",
  orange: "#fdba74",
};

export const COLOR_LABEL: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  purple: "Purple",
  orange: "Orange",
};

export function colorWithAlpha(color: HighlightColor, alpha: number): string {
  const hex = COLOR_HEX[color];
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
