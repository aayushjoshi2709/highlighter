import { describe, expect, it } from "vitest";
import { buildTextIndex, describeOffsets, describeRange, resolveAnchor, resolveToRange, similarity } from "../src/anchoring/anchor";
import { buildTextIndexAsync, offsetsToRange } from "../src/anchoring/textIndex";

function page(html: string) {
  document.body.innerHTML = html;
  return buildTextIndex(document.body);
}

function selectText(index: ReturnType<typeof buildTextIndex>, text: string, nth = 0) {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = index.text.indexOf(text, at + 1);
  return offsetsToRange(index, at, at + text.length)!;
}

describe("text index", () => {
  it("normalises whitespace and separates blocks", () => {
    const index = page("<h1>Title</h1><p>Hello   <b>brave</b>\n new&nbsp;world</p><script>ignored()</script><p>Bye</p>");
    expect(index.text).toBe("Title Hello brave new world Bye");
  });

  it("round-trips a range across inline elements", () => {
    const index = page("<p>The <em>quick brown</em> fox jumps</p>");
    const range = selectText(index, "quick brown fox");
    expect(range.toString()).toBe("quick brown fox");
    const anchor = describeRange(index, range)!;
    expect(anchor.exact).toBe("quick brown fox");
    expect(anchor.prefix).toBe("The ");
    expect(anchor.suffix).toBe(" jumps");
  });

  it("trims whitespace at the selection edges", () => {
    const index = page("<p>alpha beta gamma</p>");
    const node = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 5); // " beta "
    range.setEnd(node, 11);
    expect(describeRange(index, range)!.exact).toBe("beta");
  });
});

describe("restoration", () => {
  const original = "<article><p>Distributed systems fail in partial ways.</p><p>Consensus protocols such as Raft tolerate crash failures.</p></article>";

  it("restores after the markup around the text changes", () => {
    const index = page(original);
    const anchor = describeRange(index, selectText(index, "Raft tolerate crash"))!;
    const changed = page("<nav>Menu Home About</nav><main><div>Distributed systems fail in partial ways.</div><div>Consensus protocols such as <a href=\"#\">Raft</a> tolerate crash failures.</div></main>");
    const { status, range } = resolveToRange(changed, anchor);
    expect(status).toBe("exact");
    expect(range!.toString()).toBe("Raft tolerate crash");
  });

  it("uses context to pick between repeated text", () => {
    const html = "<ul><li>Read more about caching</li><li>Read more about sharding</li><li>Read more about queues</li></ul>";
    const index = page(html);
    const anchor = describeRange(index, selectText(index, "Read more", 1))!;
    // New content pushes everything down, so the stored position is wrong.
    const shifted = page("<p>Breaking news banner inserted at the top.</p>" + html);
    const r = resolveAnchor(shifted.text, anchor);
    expect(r.status).toBe("exact");
    expect(shifted.text.slice(r.end, r.end + 15)).toBe(" about sharding");
  });

  it("falls back to position when context is identical", () => {
    const text = "same same same same";
    const anchor = { exact: "same", prefix: "", suffix: "", start: 10, end: 14 };
    expect(resolveAnchor(text, anchor)).toMatchObject({ status: "exact", start: 10 });
  });

  it("reports ambiguity instead of guessing", () => {
    const anchor = describeOffsets("x: item. y: item. z: item.", 12, 16);
    const r = resolveAnchor("item / item / item / item", anchor);
    expect(r.status).toBe("ambiguous");
    expect(r.start).toBe(-1);
  });

  it("re-attaches a lightly edited quote through its context", () => {
    const before = "Intro text here. The system processes ten thousand requests per second under load. Closing remarks follow.";
    const s = before.indexOf("The system");
    const e = before.indexOf(" Closing");
    const anchor = describeOffsets(before, s, e);
    const after = before.replace("ten thousand", "10,000");
    const r = resolveAnchor(after, anchor);
    expect(r.status).toBe("fuzzy");
    expect(after.slice(r.start, r.end)).toBe("The system processes 10,000 requests per second under load.");
  });

  it("orphans a highlight whose text is gone", () => {
    const index = page(original);
    const anchor = describeRange(index, selectText(index, "Consensus protocols"))!;
    expect(resolveToRange(page("<p>An entirely different article about gardening and soil.</p>"), anchor)).toEqual({ status: "orphaned", range: null });
  });

  it("does not attach a short quote to an unrelated occurrence", () => {
    const anchor = describeOffsets("We measured the latency of the cache layer.", 16, 23); // "latency"
    expect(resolveAnchor("Totally unrelated page where latency appears once in passing.", anchor).status).toBe("orphaned");
  });
});

describe("similarity", () => {
  it("is 1 for equal strings and low for unrelated ones", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("kitten", "sitting")).toBeCloseTo(1 - 3 / 7);
    expect(similarity("abcdef", "uvwxyz")).toBe(0);
  });
});

describe("time-sliced indexing", () => {
  const big = Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i} with <b>some</b> text.</p>`).join("");

  it("yields between slices and produces the same index as the synchronous build", async () => {
    const sync = page(big);
    let yields = 0;
    const index = await buildTextIndexAsync(document.body, {
      sliceMs: 0, // every slice is exhausted at once, forcing a yield per batch of nodes
      yieldToMain: async () => void yields++,
    });
    expect(yields).toBeGreaterThan(10);
    expect(index!.text).toBe(sync.text);
    expect(index!.segments.length).toBe(sync.segments.length);
    expect(resolveToRange(index!, describeOffsets(sync.text, 100, 140)).range!.toString().length).toBeGreaterThan(0);
  });

  it("stops when cancelled", async () => {
    page(big);
    let yields = 0;
    const index = await buildTextIndexAsync(document.body, { sliceMs: 0, yieldToMain: async () => void yields++, isCancelled: () => yields >= 2 });
    expect(index).toBeNull();
    expect(yields).toBe(2);
  });
});
