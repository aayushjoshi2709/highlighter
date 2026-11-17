/**
 * A whitespace-normalised view of the text under a root node, with a mapping
 * back to DOM positions. Anchors are expressed against this text, never
 * against DOM nodes, so they survive reloads and markup changes.
 */

export interface Segment {
  node: Text;
  /** Offset in the normalised text of this node's first kept character. */
  start: number;
  /** For each kept character, its offset inside `node.data`. */
  offsets: number[];
}

export interface TextIndex {
  text: string;
  segments: Segment[];
  byNode: Map<Text, Segment>;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT", "OPTION", "IFRAME", "OBJECT", "SVG", "CANVAS", "WPH-ROOT"]);
const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DATA", "DFN", "EM", "FONT", "I", "KBD", "MARK", "Q", "RP", "RT", "RUBY",
  "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR", "INS", "DEL", "LABEL", "TT", "BIG", "NOBR",
]);

function blockOf(node: Node, cache: WeakMap<Node, Node | null>): Node | null {
  let el = node.parentNode;
  const visited: Node[] = [];
  while (el) {
    const hit = cache.get(el);
    if (hit !== undefined) {
      for (const v of visited) cache.set(v, hit);
      return hit;
    }
    if (el.nodeType !== Node.ELEMENT_NODE || !INLINE_TAGS.has((el as Element).tagName.toUpperCase())) break;
    visited.push(el);
    el = el.parentNode;
  }
  for (const v of visited) cache.set(v, el);
  if (el) cache.set(el, el);
  return el;
}

/**
 * Incremental index construction. `step` walks text nodes until `shouldPause`
 * says the time slice is used up, so a large page can be indexed across many
 * short tasks instead of one long one.
 */
function createIndexBuilder(root: Node) {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const tag = (node as Element).tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
      return tag === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const parts: string[] = [];
  const segments: Segment[] = [];
  const byNode = new Map<Text, Segment>();
  const blockCache = new WeakMap<Node, Node | null>();
  let length = 0;
  let lastWasSpace = true; // suppresses leading whitespace
  let lastBlock: Node | null | undefined;

  const pushBreak = () => {
    if (lastWasSpace) return;
    parts.push(" ");
    length++;
    lastWasSpace = true;
  };

  /** Returns true when the whole tree has been walked. */
  const step = (shouldPause?: () => boolean): boolean => {
   let sinceCheck = 0;
   for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    visit(node);
    if (shouldPause && ++sinceCheck >= 32) {
      sinceCheck = 0;
      if (shouldPause()) return false;
    }
   }
   return true;
  };

  const visit = (node: Node) => {
    if (node.nodeType !== Node.TEXT_NODE) {
      pushBreak(); // <br>
      return;
    }
    const textNode = node as Text;
    const data = textNode.data;
    if (!data) return;
    const block = blockOf(textNode, blockCache);
    if (lastBlock !== undefined && block !== lastBlock) pushBreak();
    lastBlock = block;

    const offsets: number[] = [];
    let chunk = "";
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      const isSpace = code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0x200b || code === 0x2028 || code === 0x2029 || code === 0xfeff;
      if (isSpace) {
        if (lastWasSpace) continue;
        chunk += " ";
        lastWasSpace = true;
      } else {
        chunk += data[i];
        lastWasSpace = false;
      }
      offsets.push(i);
    }
    if (!offsets.length) return;
    const seg: Segment = { node: textNode, start: length, offsets };
    segments.push(seg);
    byNode.set(textNode, seg);
    parts.push(chunk);
    length += chunk.length;
  };

  return { step, finish: (): TextIndex => ({ text: parts.join(""), segments, byNode }) };
}

export function buildTextIndex(root: Node): TextIndex {
  const builder = createIndexBuilder(root);
  builder.step();
  return builder.finish();
}

export interface AsyncIndexOptions {
  /** Longest uninterrupted stretch of work, in milliseconds. */
  sliceMs?: number;
  /** Hands control back to the page between slices. */
  yieldToMain: () => Promise<void>;
  /** Checked after every slice; a cancelled build resolves to null. */
  isCancelled?: () => boolean;
}

/**
 * Same result as buildTextIndex, but in short slices with a yield between
 * them so the page can render and handle input while a large document is indexed.
 * The caller must discard the result if the DOM changed while it was being built.
 */
export async function buildTextIndexAsync(root: Node, options: AsyncIndexOptions): Promise<TextIndex | null> {
  const sliceMs = options.sliceMs ?? 5;
  const builder = createIndexBuilder(root);
  for (;;) {
    const deadline = performance.now() + sliceMs;
    if (builder.step(() => performance.now() >= deadline)) return builder.finish();
    await options.yieldToMain();
    if (options.isCancelled?.()) return null;
  }
}

function lowerBound(arr: number[], value: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Normalised offset of a DOM boundary point. */
function pointToOffset(index: TextIndex, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const seg = index.byNode.get(container as Text);
    if (seg) return seg.start + lowerBound(seg.offsets, offset);
  }
  // Boundary in an element or an unindexed text node: find the first indexed
  // text node that starts at or after the point.
  const probe = (container.ownerDocument ?? document).createRange();
  probe.setStart(container, offset);
  probe.collapse(true);
  let lo = 0, hi = index.segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (probe.comparePoint(index.segments[mid].node, 0) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo < index.segments.length ? index.segments[lo].start : index.text.length;
}

export function rangeToOffsets(index: TextIndex, range: AbstractRange): { start: number; end: number } | null {
  let start = pointToOffset(index, range.startContainer, range.startOffset);
  let end = pointToOffset(index, range.endContainer, range.endOffset);
  const t = index.text;
  while (start < end && t[start] === " ") start++;
  while (end > start && t[end - 1] === " ") end--;
  return end > start ? { start, end } : null;
}

function segmentAt(index: TextIndex, pos: number): number {
  // Last segment whose start is <= pos.
  let lo = 0, hi = index.segments.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.segments[mid].start <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function offsetsToRange(index: TextIndex, start: number, end: number): Range | null {
  if (!(end > start) || end > index.text.length || !index.segments.length) return null;
  const doc = index.segments[0].node.ownerDocument;
  const range = doc.createRange();

  // Start: the character at `start`. If it is a virtual separator, move forward.
  let si = Math.max(0, segmentAt(index, start));
  let seg = index.segments[si];
  if (start - seg.start >= seg.offsets.length) {
    si++;
    if (si >= index.segments.length) return null;
    seg = index.segments[si];
    range.setStart(seg.node, seg.offsets[0]);
  } else {
    range.setStart(seg.node, seg.offsets[Math.max(0, start - seg.start)]);
  }

  // End: just after the character at `end - 1`. If virtual, fall back to the segment's end.
  const ei = segmentAt(index, end - 1);
  if (ei < 0) return null;
  const eseg = index.segments[ei];
  const local = Math.min(end - 1 - eseg.start, eseg.offsets.length - 1);
  range.setEnd(eseg.node, eseg.offsets[local] + 1);
  return range.collapsed ? null : range;
}
