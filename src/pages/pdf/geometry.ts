import type { NormRect } from "../../shared/types";

/** Client rects of a range, normalised to the page box and merged per text line. */
export function rangeRects(range: Range, pageEl: Element): NormRect[] {
  const page = pageEl.getBoundingClientRect();
  if (!page.width || !page.height) return [];
  const raw = [...range.getClientRects()]
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const lines: (typeof raw)[number][] = [];
  for (const r of raw) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
      const sameLine = overlap > 0.5 * Math.min(l.bottom - l.top, r.bottom - r.top);
      return sameLine && r.left <= l.right + 4 && r.right >= l.left - 4;
    });
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ ...r });
  }
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return lines.map((l) => {
    const x = clamp((l.left - page.left) / page.width);
    const y = clamp((l.top - page.top) / page.height);
    return {
      x,
      y,
      w: clamp((l.right - page.left) / page.width) - x,
      h: clamp((l.bottom - page.top) / page.height) - y,
    };
  });
}

export function hitRects(rects: NormRect[] | undefined, x: number, y: number): boolean {
  return Boolean(rects?.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h));
}
