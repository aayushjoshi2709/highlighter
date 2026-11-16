import type { Anchor } from "../shared/types";
import { buildTextIndex, offsetsToRange, rangeToOffsets, type TextIndex } from "./textIndex";

export const CONTEXT_LENGTH = 48;
const MAX_OCCURRENCES = 2000;

export type ResolveStatus =
  | "exact" // the quote was found and identified unambiguously
  | "fuzzy" // the text changed slightly; located through context or position
  | "ambiguous" // several equally good candidates; refusing to guess
  | "orphaned"; // not found

export interface Resolution {
  status: ResolveStatus;
  start: number;
  end: number;
}

const NOT_FOUND = (status: "ambiguous" | "orphaned"): Resolution => ({ status, start: -1, end: -1 });

/** Builds a TextQuote + TextPosition anchor for a normalised text span. */
export function describeOffsets(text: string, start: number, end: number): Anchor {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
  };
}

export function describeRange(index: TextIndex, range: AbstractRange): Anchor | null {
  const o = rangeToOffsets(index, range);
  return o ? describeOffsets(index.text, o.start, o.end) : null;
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** 0..1: how much of the stored context surrounds [start, end) in `text`. */
export function contextScore(text: string, start: number, end: number, anchor: Anchor): number {
  const total = anchor.prefix.length + anchor.suffix.length;
  if (!total) return 0;
  const before = text.slice(Math.max(0, start - anchor.prefix.length), start);
  const after = text.slice(end, end + anchor.suffix.length);
  return (commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix)) / total;
}

/** Similarity ratio in 0..1 based on edit distance (word overlap for very long strings). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (a.length > 1500 || b.length > 1500) {
    const wa = new Set(a.split(" "));
    const wb = b.split(" ");
    const shared = wb.filter((w) => wa.has(w)).length;
    return shared / Math.max(wa.size, wb.length);
  }
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function allIndexesOf(text: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(needle); i !== -1 && out.length < MAX_OCCURRENCES; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * Locates an anchor in normalised text.
 *
 * 1. Exact quote, disambiguated by surrounding context, then by position.
 * 2. If the quote is gone: text between the stored prefix and suffix, then the
 *    text at the stored position, accepted only if still similar to the quote.
 * 3. Otherwise "ambiguous" or "orphaned" – a highlight is never attached to
 *    text we cannot justify.
 */
export function resolveAnchor(text: string, anchor: Anchor): Resolution {
  const { exact } = anchor;
  const len = exact.length;
  const hasPosition = anchor.start !== undefined;
  const hasContext = anchor.prefix.length + anchor.suffix.length > 0;

  const occurrences = allIndexesOf(text, exact);
  if (occurrences.length === 1) {
    const start = occurrences[0];
    const ctx = contextScore(text, start, start + len, anchor);
    const confident = len >= 16 || ctx >= 0.25 || !hasContext || (hasPosition && start === anchor.start);
    return confident ? { status: "exact", start, end: start + len } : NOT_FOUND("orphaned");
  }

  if (occurrences.length > 1) {
    const scored = occurrences
      .map((start) => ({ start, ctx: contextScore(text, start, start + len, anchor) }))
      .sort((a, b) => b.ctx - a.ctx);
    const best = scored[0];
    if (best.ctx >= 0.25 && best.ctx - scored[1].ctx >= 0.1) {
      return { status: "exact", start: best.start, end: best.start + len };
    }
    // Context cannot separate the top candidates: only an exact position match may break the tie.
    const tied = scored.filter((s) => best.ctx - s.ctx < 0.1);
    const atPosition = hasPosition ? tied.find((s) => s.start === anchor.start) : undefined;
    if (atPosition) return { status: "exact", start: atPosition.start, end: atPosition.start + len };
    return NOT_FOUND("ambiguous");
  }

  // --- The exact quote no longer exists. ---

  // Context-based: text enclosed by the stored prefix and suffix.
  if (anchor.prefix.length >= 8 && anchor.suffix.length >= 8) {
    const candidates: Resolution[] = [];
    for (const p of allIndexesOf(text, anchor.prefix)) {
      const start = p + anchor.prefix.length;
      const s = text.indexOf(anchor.suffix, start);
      if (s === -1 || s === start || s - start > len * 2 + 64) continue;
      if (similarity(text.slice(start, s), exact) >= 0.6) candidates.push({ status: "fuzzy", start, end: s });
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return NOT_FOUND("ambiguous");
  }

  // Position-based: same offsets, text still nearly identical and context agrees.
  if (hasPosition && anchor.end !== undefined && anchor.end <= text.length) {
    const candidate = text.slice(anchor.start, anchor.end);
    if (similarity(candidate, exact) >= 0.85 && contextScore(text, anchor.start!, anchor.end, anchor) >= 0.5) {
      return { status: "fuzzy", start: anchor.start!, end: anchor.end };
    }
  }

  return NOT_FOUND("orphaned");
}

export interface ResolvedRange {
  status: ResolveStatus;
  range: Range | null;
}

export function resolveToRange(index: TextIndex, anchor: Anchor): ResolvedRange {
  const r = resolveAnchor(index.text, anchor);
  if (r.start < 0) return { status: r.status, range: null };
  const range = offsetsToRange(index, r.start, r.end);
  return range ? { status: r.status, range } : { status: "orphaned", range: null };
}

export { buildTextIndex };
