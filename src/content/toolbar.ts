import { COLOR_HEX, COLOR_LABEL } from "../shared/colors";
import { HIGHLIGHT_COLORS } from "../shared/constants";
import type { Highlight, HighlightColor } from "../shared/types";

/**
 * The floating toolbar. Lives in a shadow root so page styles cannot leak in
 * and ours cannot leak out. Plain DOM (no framework) to keep the script that
 * is injected into every page small.
 */

export interface ToolbarActions {
  onCreate(color: HighlightColor, withNote: boolean): void;
  onRecolor(id: string, color: HighlightColor): void;
  onNote(id: string, note: string): void;
  onFavorite(id: string, favorite: boolean): void;
  onDelete(id: string): void;
  onAttach(): void;
  onCancelRepair(): void;
}

const CSS_TEXT = `
:host{all:initial}
.bar{position:absolute;display:flex;align-items:center;gap:6px;padding:6px 8px;background:#1f2937;color:#f9fafb;
  border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.28);font:13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;
  pointer-events:auto;user-select:none;width:max-content;max-width:320px;flex-wrap:wrap}
[hidden]{display:none!important}
.sw{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;box-sizing:border-box}
.sw:hover{transform:scale(1.15)}
.sw.on{border-color:#fff}
.btn{background:transparent;border:0;color:#e5e7eb;cursor:pointer;padding:4px 6px;border-radius:6px;font:inherit}
.btn:hover{background:#374151;color:#fff}
.btn.primary{background:#2563eb;color:#fff}
.sep{width:1px;height:18px;background:#4b5563}
.note{flex-basis:100%;display:flex;flex-direction:column;gap:6px;margin-top:4px}
textarea{width:290px;max-width:100%;min-height:64px;box-sizing:border-box;border-radius:6px;border:1px solid #4b5563;background:#111827;
  color:#f9fafb;font:inherit;padding:6px;resize:vertical}
.row{display:flex;gap:6px;justify-content:flex-end}
.banner{position:fixed;left:50%;top:12px;transform:translateX(-50%);background:#1f2937;color:#f9fafb;padding:8px 12px;border-radius:10px;
  font:13px/1.3 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.28);display:flex;gap:10px;align-items:center;pointer-events:auto}
`;

type Mode =
  | { kind: "hidden" }
  | { kind: "selection"; rect: DOMRect }
  | { kind: "attach"; rect: DOMRect }
  | { kind: "edit"; rect: DOMRect; highlight: Highlight; noteOpen: boolean };

export class Toolbar {
  private host: HTMLElement;
  private root: ShadowRoot;
  private bar: HTMLDivElement;
  private banner: HTMLDivElement;
  private mode: Mode = { kind: "hidden" };

  constructor(private actions: ToolbarActions) {
    this.host = document.createElement("wph-root");
    this.host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    this.bar = document.createElement("div");
    this.bar.className = "bar";
    this.bar.hidden = true;
    this.banner = document.createElement("div");
    this.banner.className = "banner";
    this.banner.hidden = true;
    this.root.append(style, this.bar, this.banner);
    // Keep the page selection alive while clicking toolbar buttons.
    this.bar.addEventListener("mousedown", (e) => {
      if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
    });
  }

  private mount() {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && (target === this.host || this.host.contains(target));
  }

  get isOpen() {
    return this.mode.kind !== "hidden";
  }

  get isEditingNote() {
    return this.mode.kind === "edit" && this.mode.noteOpen;
  }

  get editingId() {
    return this.mode.kind === "edit" ? this.mode.highlight.id : null;
  }

  showForSelection(rect: DOMRect, repairing: boolean) {
    this.mode = repairing ? { kind: "attach", rect } : { kind: "selection", rect };
    this.draw();
  }

  showForHighlight(rect: DOMRect, highlight: Highlight, noteOpen = false) {
    this.mode = { kind: "edit", rect, highlight, noteOpen };
    this.draw();
  }

  hide() {
    this.mode = { kind: "hidden" };
    this.bar.hidden = true;
  }

  setRepairBanner(text: string | null) {
    this.mount();
    this.banner.replaceChildren();
    this.banner.hidden = !text;
    if (!text) return;
    const span = document.createElement("span");
    span.textContent = text;
    this.banner.append(span, this.button("Cancel", () => this.actions.onCancelRepair()));
  }

  private button(label: string, onClick: () => void, cls = "btn", title?: string) {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.title = title ?? label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private swatches(current: HighlightColor | null, onPick: (c: HighlightColor) => void) {
    return HIGHLIGHT_COLORS.map((c) => {
      const b = this.button("", () => onPick(c), `sw${c === current ? " on" : ""}`, `${COLOR_LABEL[c]}`);
      b.style.background = COLOR_HEX[c];
      b.setAttribute("aria-label", `Highlight ${COLOR_LABEL[c]}`);
      b.dataset.color = c;
      return b;
    });
  }

  private sep() {
    const s = document.createElement("span");
    s.className = "sep";
    return s;
  }

  private draw() {
    this.mount();
    const m = this.mode;
    if (m.kind === "hidden") return this.hide();
    this.bar.replaceChildren();

    if (m.kind === "attach") {
      this.bar.append(this.button("Attach highlight here", () => this.actions.onAttach(), "btn primary"));
    } else if (m.kind === "selection") {
      this.bar.append(
        ...this.swatches(null, (c) => this.actions.onCreate(c, false)),
        this.sep(),
        this.button("✎ Note", () => this.actions.onCreate(this.defaultColor, true), "btn", "Highlight and add a note"),
        this.button("✕", () => this.hide(), "btn", "Dismiss"),
      );
    } else {
      const h = m.highlight;
      this.bar.append(
        ...this.swatches(h.color, (c) => this.actions.onRecolor(h.id, c)),
        this.sep(),
        this.button("✎", () => this.showForHighlight(m.rect, h, !m.noteOpen), "btn", h.note ? "Edit note" : "Add note"),
        this.button(h.favorite ? "★" : "☆", () => this.actions.onFavorite(h.id, !h.favorite), "btn", h.favorite ? "Remove favorite" : "Favorite"),
        this.button("⧉", () => void navigator.clipboard.writeText(h.anchor.exact).catch(() => {}), "btn", "Copy text"),
        this.button("🗑", () => this.actions.onDelete(h.id), "btn", "Delete highlight"),
        this.button("✕", () => this.hide(), "btn", "Dismiss"),
      );
      if (m.noteOpen) {
        const wrap = document.createElement("div");
        wrap.className = "note";
        const ta = document.createElement("textarea");
        ta.value = h.note ?? "";
        ta.placeholder = "Add a note…";
        // Stop page-level keyboard shortcuts from firing while typing.
        for (const ev of ["keydown", "keyup", "keypress"]) ta.addEventListener(ev, (e) => e.stopPropagation());
        const row = document.createElement("div");
        row.className = "row";
        row.append(
          this.button("Cancel", () => this.showForHighlight(m.rect, h, false)),
          this.button("Save", () => this.actions.onNote(h.id, ta.value), "btn primary"),
        );
        wrap.append(ta, row);
        this.bar.append(wrap);
        setTimeout(() => ta.focus(), 0);
      }
    }

    this.bar.hidden = false;
    this.position(m.rect);
  }

  defaultColor: HighlightColor = "yellow";

  /** Places the bar above the target (below if there is no room), clamped to the viewport. */
  private position(rect: DOMRect) {
    const { width, height } = this.bar.getBoundingClientRect();
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    let top = rect.top - height - margin;
    if (top < margin) top = Math.min(rect.bottom + margin, vh - height - margin);
    top = Math.max(margin, top);
    // The host is absolutely positioned at the document origin, so the bar scrolls with the text.
    const origin = this.host.getBoundingClientRect();
    this.bar.style.left = `${left - origin.left}px`;
    this.bar.style.top = `${top - origin.top}px`;
  }
}
