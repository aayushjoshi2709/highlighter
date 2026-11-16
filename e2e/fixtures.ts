import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

const ARTICLE = `<!doctype html><html><head><title>Consensus notes</title></head><body>
<h1>Consensus notes</h1>
<p id="p1">Distributed systems fail in partial ways, which makes them hard to reason about.</p>
<p id="p2">Consensus protocols such as Raft tolerate crash failures of a minority of nodes.</p>
<div id="late"></div>
<script>
  if (location.search.includes("late")) {
    // Simulates a dynamic page: the highlighted paragraph only appears later.
    const p2 = document.getElementById("p2"); const text = p2.textContent; p2.remove();
    setTimeout(() => { document.getElementById("late").innerHTML = "<section><p>" + text + "</p></section>"; }, 1500);
  }
</script></body></html>`;

/** A one-page PDF containing a single line of text. */
function tinyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 24 Tf 72 700 Td (Highlight this PDF sentence please) Tj ET";
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<a1b2c3d4e5f60718a1b2c3d4e5f60718> <a1b2c3d4e5f60718a1b2c3d4e5f60718>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export const test = base.extend<{ context: BrowserContext; extensionId: string; site: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      // Optional: point at another Chromium build (e.g. when Playwright's own download is unavailable).
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(worker.url().split("/")[2]);
  },
  // eslint-disable-next-line no-empty-pattern
  site: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      if (req.url?.startsWith("/doc.pdf")) {
        res.writeHead(200, { "Content-Type": "application/pdf", "Access-Control-Allow-Origin": "*" });
        res.end(tinyPdf());
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ARTICLE);
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    await use(`http://127.0.0.1:${port}`);
    server.close();
  },
});

export { expect } from "@playwright/test";
