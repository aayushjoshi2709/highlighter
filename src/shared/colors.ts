import { CUSTOM_COLOR_PATTERN, HIGHLIGHT_COLORS, type CustomColor, type PresetColor } from "./constants";
import type { HighlightColor } from "./types";

/** Central palette; change here to reconfigure the preset colours everywhere. */
export const COLOR_HEX: Record<PresetColor, string> = {
  yellow: "#fde047",
  green: "#86efac",
  blue: "#93c5fd",
  pink: "#f9a8d4",
  purple: "#d8b4fe",
  orange: "#fdba74",
};

export const COLOR_LABEL: Record<PresetColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  purple: "Purple",
  orange: "Orange",
};

export function isPresetColor(color: string): color is PresetColor {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(color);
}

export function isCustomColor(color: string): color is CustomColor {
  return CUSTOM_COLOR_PATTERN.test(color);
}

/** Normalises colour-picker output to a storable custom colour. */
export function toCustomColor(value: string): CustomColor | null {
  const v = value.trim().toLowerCase();
  return isCustomColor(v) ? v : null;
}

/** "#rrggbb" for any highlight colour; unknown values fall back to yellow. */
export function colorHex(color: HighlightColor): string {
  if (isPresetColor(color)) return COLOR_HEX[color];
  return isCustomColor(color) ? color : COLOR_HEX.yellow;
}

export function colorLabel(color: HighlightColor): string {
  return isPresetColor(color) ? COLOR_LABEL[color] : color.toUpperCase();
}

export function colorWithAlpha(color: HighlightColor, alpha: number): string {
  const n = parseInt(colorHex(color).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
