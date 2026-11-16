# Web & PDF Highlighter

A Chrome extension (Manifest V3) for highlighting text on webpages and PDFs. Highlights are saved locally first
(IndexedDB) and can optionally sync between devices through a hidden app folder in Google Drive. There is no backend.

## Run it

```bash
npm install
```

```bash
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select the `dist` folder.

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and build into `dist/` |
| `npm run dev` | Rebuild pages and service worker on change (re-run `build` for content-script changes) |
| `npm test` | Unit tests (Vitest): anchoring, repository, merge, search |
| `npm run test:e2e` | Builds, then runs Playwright against the real extension (`npx playwright install chromium` first) |

Everything except sign-in and sync works immediately. For local PDFs opened as `file://` URLs, turn on
**Allow access to file URLs** for the extension, or use **Import PDF** in the viewer.

## Google sign-in and Drive sync setup

Sync needs an OAuth client that belongs to *your* extension ID, so it cannot ship pre-configured.

1. Load the unpacked extension and copy its ID from `chrome://extensions`. To keep the ID stable across machines,
   add a `key` to `public/manifest.json` (see Chrome's "keep a consistent extension ID" docs).
2. In Google Cloud Console: create a project, enable the **Google Drive API**, configure the OAuth consent screen
   with the scopes `openid`, `email`, `profile` and `https://www.googleapis.com/auth/drive.appdata`.
3. Create an OAuth client of type **Chrome extension** using the extension ID.
4. Put the client ID in `public/manifest.json` under `oauth2.client_id`, rebuild and reload.

No client secret is used or needed. Signing in only requests the basic profile; the Drive scope is requested
separately when the user turns sync on in **Dashboard → Settings**.

## How it works

```
content script ──messages──▶ service worker ─┐
popup / dashboard / PDF viewer ──────────────┴──▶ IndexedDB (Dexie) ──sync queue──▶ Google Drive appDataFolder
```

- **`src/anchoring`** – text anchoring. The page is turned into whitespace-normalised text with a map back to DOM
  positions. An anchor stores the exact quote, 48 characters of prefix/suffix context and its offsets (W3C
  TextQuoteSelector + TextPositionSelector). Restoring tries: the exact quote, disambiguated by context and then by
  position → the text between the stored prefix and suffix → the text at the stored position if still ≥85% similar.
  Equal candidates are reported as *ambiguous* and missing text as *orphaned*; a highlight is never attached to a guess.
- **`src/content`** – selection toolbar (shadow DOM, no framework, ~20 kB), painting with the CSS Custom Highlight
  API (no DOM changes) with a `<mark>`-wrapping fallback, re-anchoring after DOM mutations and SPA URL changes, and
  a repair mode for orphaned highlights (popup → *Repair* → reselect the text).
- **`src/pages/pdf`** – PDF.js viewer: lazy page rendering, zoom, page navigation, import, per-page text anchors plus
  page-normalised rectangles. Links ending in `.pdf` are redirected here because Chrome's built-in viewer cannot be
  scripted (switch this off in Settings).
- **`src/pages/dashboard`** – all/web/PDF/favorite highlights with local full-text search, filters, sorting, bulk
  actions, collections, tags, documents, settings, export (JSON/Markdown) and import.
- **`src/background`** – service worker: message router, Google auth (`chrome.identity`), Drive client, sync.
- **`src/shared`** – models with Zod schemas, Dexie database, the repository (every write is one transaction that
  also records a pending sync operation), last-writer-wins merge.

### Sync

Incremental and append-only. A push uploads only the entities changed since the last push as a new
`ops_<time>_<device>.json`; a pull downloads only files this device has not applied. Entities merge by
`updatedAt` (last writer wins) and deletions travel as tombstones, so merging is idempotent. After 40 op files one
device writes `snapshot.json` and removes the files it folded in. Imported PDF files are **not** uploaded unless
"Also back up imported PDF files" is turned on; without it, a synced PDF highlight on another device asks you to
import the same file.

## Decisions that differ from the PRD

The PRD text I was given stopped partway through §8.4 (the `SyncOperation` model), so the sync design above and
anything after that point are my own.

- **No `highlightTags` table.** `Highlight.tags` holds tag ids with a multi-entry index, which gives the same queries
  without a second copy of the relationship to keep consistent across devices.
- **No `settings` table.** Preferences live in `chrome.storage.local` (the PRD allows this for lightweight
  preferences) so the content script can read them. An extra `pdfFiles` table stores imported PDF bytes.
- **`Anchor.rects`** (optional) was added for PDF selection geometry; `Document` gained `deletedAt` and `localFile`.
- **A selection spanning several PDF pages** becomes one highlight per page, so every anchor is page-local.
- **Pages you only visit are not recorded.** A document row is created with its first highlight.

## Known limits

- PDFs served from URLs that do not end in `.pdf` are not redirected automatically; use the popup button
  *Open this PDF in Highlighter* or the link context menu.
- Text inside iframes, canvas and closed shadow roots cannot be highlighted.
- Tombstones are kept indefinitely (no garbage collection yet).
- Google sign-in and Drive sync have not been exercised against a real Google account in this repository's tests;
  they need the OAuth setup above.
# highlighter
