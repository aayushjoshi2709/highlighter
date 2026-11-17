import { colorWithAlpha, isPresetColor } from "../shared/colors";
import { HIGHLIGHT_COLORS } from "../shared/constants";
import type { HighlightColor } from "../shared/types";

/**
 * Paints highlight ranges. Uses the CSS Custom Highlight API, which does not
 * touch the page's DOM at all. Where it is unavailable, falls back to wrapping
 * text in <mark> elements.
 */
export interface Renderer {
  readonly mutatesDom: boolean;
  /** Replaces everything currently painted. DOM-mutating renderers expect clear() to have run before ranges were resolved. */
  render(items: { id: string; color: HighlightColor; range: Range }[]): void;
  /** Id of the highlight under a viewport point, if any (topmost = most recent). */
  hitTest(x: number, y: number): string | null;
  rangeFor(id: string): Range | null;
  flash(id: string): void;
  clear(): void;
}

/** Highlight-registry name: "wph-yellow" for presets, "wph-c-rrggbb" for custom colours. */
const NAME = (c: HighlightColor) => (isPresetColor(c) ? `wph-${c}` : `wph-c-${c.slice(1)}`);

/** Installs the rules and returns a function that appends further rules later. */
function installStyles(css: string): (rule: string) => void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return (rule) => void sheet.insertRule(rule, sheet.cssRules.length);
  } catch {
    const style = document.createElement("style");
    style.textContent = css;
    (document.head ?? document.documentElement).appendChild(style);
    return (rule) => void style.append(`\n${rule}`);
  }
}

function pointInRange(range: Range, x: number, y: number): boolean {
  for (const r of range.getClientRects()) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

class CssHighlightRenderer implements Renderer {
  readonly mutatesDom = false;
  private ranges = new Map<string, Range>();
  private order: string[] = [];
  /**
   * The stylesheet is installed on first paint, not at start-up: adding a sheet
   * makes the browser restyle the document, which pages without highlights should never pay for.
   */
  private addRule: ((rule: string) => void) | null = null;
  /** Colours that already have a ::highlight rule. */
  private styled = new Set<HighlightColor>(HIGHLIGHT_COLORS);
  /** Registry names set by the last render, so stale ones can be removed. */
  private active = new Set<string>();

  private ensureStyles() {
    if (this.addRule) return this.addRule;
    const rules = HIGHLIGHT_COLORS.map((c) => this.rule(c));
    rules.push(`::highlight(wph-flash){background-color:rgba(239,68,68,.45)}`);
    return (this.addRule = installStyles(rules.join("\n")));
  }

  private rule(c: HighlightColor) {
    return `::highlight(${NAME(c)}){background-color:${colorWithAlpha(c, 0.55)};color:inherit}`;
  }

  render(items: { id: string; color: HighlightColor; range: Range }[]) {
    if (!items.length && !this.active.size) return; // nothing painted, nothing to paint
    const addRule = this.ensureStyles();
    this.ranges.clear();
    this.order = items.map((i) => i.id);
    const byColor = new Map<HighlightColor, Range[]>();
    for (const item of items) {
      this.ranges.set(item.id, item.range);
      const list = byColor.get(item.color) ?? [];
      list.push(item.range);
      byColor.set(item.color, list);
    }
    const next = new Set<string>();
    for (const [c, list] of byColor) {
      if (!this.styled.has(c)) {
        // Custom colours get their rule the first time they are painted.
        addRule(this.rule(c));
        this.styled.add(c);
      }
      CSS.highlights.set(NAME(c), new Highlight(...list));
      next.add(NAME(c));
    }
    for (const name of this.active) if (!next.has(name)) CSS.highlights.delete(name);
    this.active = next;
  }

  hitTest(x: number, y: number) {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const range = this.ranges.get(this.order[i]);
      if (range && pointInRange(range, x, y)) return this.order[i];
    }
    return null;
  }

  rangeFor(id: string) {
    return this.ranges.get(id) ?? null;
  }

  flash(id: string) {
    const range = this.ranges.get(id);
    if (!range) return;
    CSS.highlights.set("wph-flash", new Highlight(range));
    setTimeout(() => CSS.highlights.delete("wph-flash"), 1200);
  }

  clear() {
    this.render([]);
  }
}

const MARK_ATTR = "data-wph-id";

class MarkRenderer implements Renderer {
  readonly mutatesDom = true;

  constructor() {
    const rules = HIGHLIGHT_COLORS.map(
      (c) => `mark[${MARK_ATTR}][data-wph-color="${c}"]{background-color:${colorWithAlpha(c, 0.55)};color:inherit;padding:0;margin:0;border-radius:0}`,
    );
    rules.push(`mark[${MARK_ATTR}].wph-flash{background-color:rgba(239,68,68,.45)!important}`);
    installStyles(rules.join("\n"));
  }

  render(items: { id: string; color: HighlightColor; range: Range }[]) {
    // Ranges were all resolved against the unwrapped DOM. Wrapping from the
    // end of the document backwards keeps the earlier ranges valid.
    const sorted = [...items].sort((a, b) => b.range.compareBoundaryPoints(Range.START_TO_START, a.range));
    // The caller clears previous marks before resolving ranges (see apply()).
    const plans = sorted.map((item) => ({ item, pieces: textPieces(item.range) }));
    for (const { item, pieces } of plans) {
      // Pieces are re-derived from live nodes; wrap last-to-first within a highlight too.
      for (let i = pieces.length - 1; i >= 0; i--) {
        const { node, start, end } = pieces[i];
        if (!node.isConnected || end > node.length) continue;
        let target = node;
        if (end < target.length) target.splitText(end);
        if (start > 0) target = target.splitText(start);
        const mark = document.createElement("mark");
        mark.setAttribute(MARK_ATTR, item.id);
        mark.setAttribute("data-wph-color", item.color);
        if (!isPresetColor(item.color)) mark.style.cssText = `background-color:${colorWithAlpha(item.color, 0.55)};color:inherit;padding:0;margin:0;border-radius:0`;
        target.parentNode?.insertBefore(mark, target);
        mark.appendChild(target);
      }
    }
  }

  hitTest(x: number, y: number) {
    const el = document.elementFromPoint(x, y)?.closest(`mark[${MARK_ATTR}]`);
    return el?.getAttribute(MARK_ATTR) ?? null;
  }

  rangeFor(id: string) {
    const marks = document.querySelectorAll(`mark[${MARK_ATTR}="${CSS.escape(id)}"]`);
    if (!marks.length) return null;
    const range = document.createRange();
    range.setStartBefore(marks[0]);
    range.setEndAfter(marks[marks.length - 1]);
    return range;
  }

  flash(id: string) {
    const marks = document.querySelectorAll(`mark[${MARK_ATTR}="${CSS.escape(id)}"]`);
    marks.forEach((m) => m.classList.add("wph-flash"));
    setTimeout(() => marks.forEach((m) => m.classList.remove("wph-flash")), 1200);
  }

  clear() {
    const parents = new Set<Node>();
    document.querySelectorAll(`mark[${MARK_ATTR}]`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parents.add(parent);
    });
    parents.forEach((p) => p.normalize());
  }
}

/** The text-node slices covered by a range, captured as plain offsets. */
function textPieces(range: Range): { node: Text; start: number; end: number }[] {
  const out: { node: Text; start: number; end: number }[] = [];
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    out.push({ node: root as Text, start: range.startOffset, end: range.endOffset });
    return out;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(n)) continue;
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : n.length;
    if (end > start && n.data.slice(start, end).trim()) out.push({ node: n, start, end });
  }
  return out;
}

export function createRenderer(): Renderer {
  const supported = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
  return supported ? new CssHighlightRenderer() : new MarkRenderer();
}
