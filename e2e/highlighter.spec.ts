import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Selects `text` inside the element matching `selector` with a real mouse drag-equivalent. */
async function selectText(page: Page, selector: string, text: string) {
  const box = await page.evaluate(
    ([sel, t]) => {
      const el = document.querySelector(sel)!;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const i = n.data.indexOf(t);
        if (i === -1) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + t.length);
        const sel2 = window.getSelection()!;
        sel2.removeAllRanges();
        sel2.addRange(range);
        const r = range.getBoundingClientRect();
        return { x: r.right - 1, y: r.top + r.height / 2 };
      }
      throw new Error("text not found: " + t);
    },
    [selector, text] as const,
  );
  // The toolbar opens on mouseup; dispatch one where the selection ends without clearing it.
  await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y })), box);
}

/** Text currently painted by the CSS Custom Highlight API, per colour. */
const painted = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string[]> = {};
    // @ts-expect-error HighlightRegistry is map-like
    for (const [name, hl] of CSS.highlights) out[name] = [...hl].map((r: Range) => r.toString());
    return out;
  });

test("highlight a webpage, restore it after reload and manage it in the dashboard", async ({ context, extensionId, site }) => {
  const page = await context.newPage();
  await page.goto(`${site}/article`);
  await page.waitForTimeout(500);

  await selectText(page, "#p2", "Raft tolerate crash failures");
  await page.locator("wph-root button[data-color=green]").click();
  await expect.poll(() => painted(page)).toEqual({ "wph-green": ["Raft tolerate crash failures"] });
  // The page's own DOM is untouched.
  expect(await page.locator("#p2").innerHTML()).toBe("Consensus protocols such as Raft tolerate crash failures of a minority of nodes.");

  await page.reload();
  await expect.poll(() => painted(page)).toEqual({ "wph-green": ["Raft tolerate crash failures"] });

  // Dynamic content: the paragraph is inserted 1.5s after load, in different markup.
  await page.goto(`${site}/article?late=1`);
  await page.waitForTimeout(500);
  await selectText(page, "#p1", "fail in partial ways");
  await page.locator("wph-root button[data-color=pink]").click();
  await page.goto(`${site}/article`);
  await expect.poll(() => painted(page)).toEqual({ "wph-green": ["Raft tolerate crash failures"] });

  // Dashboard: listed, searchable, editable; changes flow back to the open page.
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard/index.html`);
  await expect(dash.getByText("Raft tolerate crash failures")).toBeVisible();
  await expect(dash.getByText("fail in partial ways")).toBeVisible();
  await dash.getByPlaceholder(/Search/).fill("raft");
  await expect(dash.getByText("fail in partial ways")).toBeHidden();
  await dash.getByRole("button", { name: "Add note" }).click();
  await dash.getByPlaceholder("Add a note…").fill("Read the Raft paper");
  await dash.getByRole("button", { name: "Save note" }).click();
  await expect(dash.getByText("Read the Raft paper")).toBeVisible();
  await dash.locator("li").filter({ hasText: "Raft tolerate" }).getByRole("button", { name: "Blue" }).click();
  await expect.poll(() => painted(page)).toEqual({ "wph-blue": ["Raft tolerate crash failures"] });

  await dash.locator("li").filter({ hasText: "Raft tolerate" }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => painted(page)).toEqual({});
});

test("a highlight in late-loading content is restored once the content appears", async ({ context, site }) => {
  const page = await context.newPage();
  await page.goto(`${site}/x?late=1`);
  await page.waitForSelector("#late p");
  await page.waitForTimeout(300);
  await selectText(page, "#late", "tolerate crash failures");
  await page.locator("wph-root button[data-color=yellow]").click();
  await expect.poll(() => painted(page)).toEqual({ "wph-yellow": ["tolerate crash failures"] });
  await page.reload();
  expect(await painted(page)).toEqual({}); // not there yet
  await expect.poll(() => painted(page), { timeout: 10_000 }).toEqual({ "wph-yellow": ["tolerate crash failures"] });
});

test("highlight a PDF in the extension viewer and reopen it from the dashboard", async ({ context, extensionId, site }) => {
  const page = await context.newPage();
  // Opened in the viewer directly: headless Chromium downloads PDFs instead of displaying them,
  // so the automatic redirect of .pdf tabs cannot be exercised here.
  await page.goto(`chrome-extension://${extensionId}/pdf/index.html?src=${encodeURIComponent(`${site}/doc.pdf`)}`);
  await expect(page.locator(".textLayer span").first()).toContainText("Highlight this PDF");

  await selectText(page, ".textLayer", "this PDF sentence");
  await page.locator("[data-popover]").getByRole("button", { name: "Orange" }).click();
  await expect(page.locator(".hl-layer > div")).toHaveCount(1);
  await expect(page.getByRole("complementary").getByText("this PDF sentence")).toBeVisible();

  await page.reload();
  await expect(page.locator(".hl-layer > div")).toHaveCount(1);

  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard/index.html#pdf`);
  await expect(dash.getByText("this PDF sentence")).toBeVisible();
  await expect(dash.getByText("p. 1")).toBeVisible();
  const [viewer] = await Promise.all([context.waitForEvent("page"), dash.getByRole("button", { name: "Open PDF" }).click()]);
  await expect(viewer.locator(".hl-layer > div")).toHaveCount(1);
});

test("pick a custom color from the page toolbar and keep it after reload", async ({ context, extensionId, site }) => {
  const page = await context.newPage();
  await page.goto(`${site}/custom`);
  await page.waitForTimeout(500);
  await selectText(page, "#p1", "fail in partial ways");
  // Stand-in for choosing a colour in the browser's picker and closing it.
  await page.locator("wph-root input[type=color]").evaluate((el: HTMLInputElement) => {
    el.value = "#14B8A6";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(() => painted(page)).toEqual({ "wph-c-14b8a6": ["fail in partial ways"] });
  await page.reload();
  await expect.poll(() => painted(page)).toEqual({ "wph-c-14b8a6": ["fail in partial ways"] });

  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard/index.html`);
  await dash.getByRole("button", { name: /Filters/ }).click();
  await expect(dash.getByRole("button", { name: "#14B8A6" })).toBeVisible();
  // Recolor back to a preset from the dashboard; the open page follows.
  await dash.locator("li").filter({ hasText: "fail in partial ways" }).getByRole("button", { name: "Purple" }).click();
  await expect.poll(() => painted(page)).toEqual({ "wph-purple": ["fail in partial ways"] });
});
