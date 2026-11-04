# JSON Formatter and Compare

English | [简体中文](README.zh-CN.md)

A Chrome extension (Manifest V3) that provides a local, ad-free JSON toolbox with no permissions required. Web Worker processing and virtual scrolling help keep the interface responsive when working with large JSON documents. The extension collects no data and makes no network requests.

See the `version` field in [`manifest.json`](manifest.json) for the current version.

## Features

| Tool | Features |
| --- | --- |
| **JSON Formatter** | Pretty-print with 2 spaces, 4 spaces, or tabs; report syntax errors and show line/column positions with cursor navigation when available; browse collapsible trees, expand by depth, search keys and values, navigate highlighted matches, and copy results |
| **JSON Minifier** | Remove whitespace to produce a single line; report invalid JSON with line/column positions when available |
| **JSON Escape / Unescape** | Convert between plain text and escaped JSON string content, with one-click copying |
| **JSON Compare** | Compare JSON structures for additions, removals, value changes, and type changes; match array elements by index or key; ignore selected paths; highlight differences in trees, show only differences, and compare text line by line |

Use the sidebar to switch between tools. The interface supports English and Simplified Chinese (`_locales/`).

## Load Locally (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select the **repository root** containing `manifest.json`, rather than a ZIP file in `dist/`.
5. Click the extension icon in the toolbar to open the JSON toolbox.

Keyboard shortcut: most pages support **Cmd/Ctrl + Enter** to run the current operation.

## Project Structure

```
manifest.json          # Extension manifest; load from the repository root
*.html                 # Stable entry points for the five tool pages
src/
  background.js        # Service Worker: opens the toolbox when the extension icon is clicked
  pages/               # Page interactions, view state, and rendering
    formatter.js
    compare.js
    transform.js       # Shared page logic for minify, escape, and unescape
  shared/              # Navigation, i18n, virtual tree/text views, clipboard, Worker protocol
  core/                # Pure algorithms: JSON formatting, paths, search, structural/text diff
  worker/
    index.js           # Web Worker message entry point
    tasks.js           # Task dispatch, cached search data, and error responses
styles/app.css         # Shared styles for all five pages
icons/                 # Extension icons referenced by the manifest
_locales/              # Translations
tests/                 # Algorithm and messaging contracts, release validation
bench/                 # Search/diff benchmarks and optional browser checks
package.json           # Native ES modules and test commands; no third-party dependencies
gen_icons.py           # Regenerate PNG files in icons/ (optional)
build_release.py       # Release validation and allowlist packaging using Python's standard library
STORE_LISTING.md       # Chrome Web Store listing copy and submission guidance
PRIVACY.md             # English and Chinese privacy policy hosted in the public repository
store-assets/          # Store screenshots and promotional images, excluded from the extension ZIP
```

Runtime code uses native browser ES modules. No dependency installation or build step is needed to load the extension. Each HTML page loads a single entry module; navigation is rendered before translations are applied, without relying on global functions or the ordering of multiple script tags.

| Boundary | Responsibilities and contracts |
| --- | --- |
| `pages → shared` | Pages own their state; shared modules handle browser interactions. The formatter and comparison trees retain their own expansion, search, and difference logic. |
| `pages/shared → core` | Views use JSON Pointer encoding and line-offset indexes. JSON parsing, search, and comparison run in the Worker. |
| `shared/worker-client → worker/index` | Requests match by id and busy lasts until all finish. Pages enable a serial queue that coalesces unsent work by key; clear discards queued work, whose responses carry `cancelled: true`. |
| `worker/tasks → core` | Each Worker caches its current document/comparison. `retainSnapshot`/`snapshotId` reuse parsing; `includeData: false` defers object transfer until tree view is needed. Clear invalidates snapshots, and the minify page does not retain unused search data. |
| `core` | Algorithms do not depend on the DOM, Chrome APIs, or Worker globals. Invalid input throws an exception, which the task layer converts to an error response. Scanning and restoring original number literals is centralized in `json.js`. |

Shared virtual renderers own viewport indexing and DOM lifecycles; pages retain their distinct search, pairing, filtering, and navigation behavior. To add a task, place its algorithm in `core/` and connect it through `worker/tasks.js`. Add any new runtime files to the allowlist in `build_release.py` as well.

## Development Checks

Requires Node.js 20+ and Python 3. No `npm install` is needed:

```bash
npm test
python3 build_release.py --check
```

Tests cover number literals and special keys, cached search data and result limits, structural and text comparisons, concurrent Worker requests and failure responses, and transitive module dependencies in the release package. Browser interactions should also be checked using the checklist below.

### Performance Checks

Run `npm run bench` for search and diff benchmarks. Each case has two warmups and seven measured samples; the scripts report medians and accept a baseline module/source directory. Memory deltas include temporary allocations awaiting GC and are neither peak nor retained memory. Run benchmarks sequentially.

First round (`61480ce`), on 2026-11-04, Linux, i5-12400, Node 24.16.0, comparing against `f070f32` with synthetic inputs:

| Scenario | Before | After |
| --- | ---: | ---: |
| Search a 1-million-element array | 110.59 ms | 16.03 ms |
| Search a 200,000-field object | 59.22 ms | 45.65 ms |
| Compare 50,000 nested records | 142.66 ms | 24.36 ms |
| Compare 50,000 reversed records by key | 181.80 ms | 48.32 ms |
| Exact text diff, 1,500 changed lines per side | 58.87 ms | 38.02 ms |

Search reuses active traversal cursors and generates paths only for the first 500 matches while counting every match. Structural diff reuses path stacks. Myers diff stores only active diagonals, reducing trace buffers from about 72 MB to 18 MB in this worst-case fixture; identical text avoids two line arrays.

The second round uses `61480ce` as its baseline:

- Trees now use flat virtual rows. Unexpanded siblings share compressed ranges; only the viewport has DOM entries. A million-element array does not allocate one row object per item. Expansion levels, escaped keys, search navigation, diff filtering, and keyed-array synchronization remain available without a DOM budget or paging buttons.
- Text views retain complete source strings with compact line-offset indexes, and render both vertical and horizontal windows. Long single lines and results beyond browser scroll-size limits remain accessible. Text diffs no longer stop at 50,000 displayed rows; small outputs keep native text rendering.
- Worker snapshots reuse parsed documents/comparisons across views. Text-only comparison omits both object trees; tree data is fetched when needed. A serial queue coalesces obsolete requests before transferring them, and clear cancels queued work and releases snapshots.
- Structural comparison uses iterative active frames. A 20,000-level fixture now completes in about 7 ms instead of overflowing the stack; 50,000 ordinary nested records remain about 24 → 22 ms (seven-sample medians). If a browser cannot clone a deep result, only that exceptional transfer uses snapshot source text for recovery; normal objects are not parsed again on the main thread.

On local Chromium 153, a real Worker successfully returns 20,000-level data. Repeated comparisons of a 10.12 MiB fixture took about 59 ms with object transfer versus 22 ms for summaries after warmup; these round trips include input transfer and reuse cached parsing. Isolated text-component rendering took about 6.4 ms for 10 MB/100,000 lines and 8.1 ms for a 5 MiB single line, with 80 and 4 DOM elements respectively. These component samples exclude input editing, Worker computation, and transfer and are not total operation timings.

`bench/tree-rendering.mjs` compares view generation with the same minimal DOM: expanding a 200×200 numeric fixture took about 183 → 12 ms and 242,412 → 193 DOM elements; reaching the end of 120,000 primitive values took 402 → 1 ms. It measures allocation and node counts, not browser layout or paint. The actual-browser checks below cover rendering and interaction.

Optional browser checks use an existing development installation of Playwright and Chromium, with no extension runtime dependency:

```bash
# Omit PLAYWRIGHT_MODULE if playwright can already be imported locally.
export PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
# Optional: export CHROMIUM_EXECUTABLE=/path/to/chromium
node bench/browser.mjs . --verify
node bench/text-view.mjs
node bench/tree-view.mjs
node bench/worker-transfer.mjs
```

These scripts start temporary local HTTP servers and check distant matches, long-line/scroll endpoints, copying, paired navigation, view switching, deep transfers, and clear. HTTP previews do not validate extension installation or Chrome i18n. `bench/text-rendering.mjs` is a separate candidate-renderer experiment; use `text-view.mjs` for the actual component. Run benchmarks sequentially.

Limits: complete inputs/results are still held in memory; this is not a streaming parser. Expand-all must still inspect containers and build a logical index. Native browser Find covers only mounted windows in large results; use tree search for JSON navigation and the copy button or focused Ctrl/Cmd+A, C for complete text. Text diff still uses block replacement above 3,000 middle lines. Measurements do not guarantee performance for arbitrary files, depths, or devices.

For normal use, load the extension as described above. To preview the pages, run `python3 -m http.server 8000` and visit `http://localhost:8000/formatter.html`. Native modules cannot be loaded by opening the HTML files directly through `file://`, and HTTP previews do not provide Chrome's extension internationalization API.

## Regenerate Icons

Requires Python 3 with no third-party dependencies:

```bash
python3 gen_icons.py
```

The output directory is `icons/`. Existing PNG files are overwritten.

## Build a Release

Requires Python 3 with no third-party dependencies:

```bash
python3 build_release.py --check
python3 build_release.py
```

The script validates the version, name and description lengths in both languages, translation keys, icon dimensions, HTML resource references, and relative paths for JavaScript static imports and the Worker entry point. It then packages runtime files from an explicit allowlist. Output is written to `dist/json-formatter-extension-<version>.zip` with a matching `.zip.sha256` checksum file. The ZIP contains `manifest.json` at its root and excludes tests, documentation, screenshots, development configuration, and `.git`. The `dist/` directory is ignored by Git.

Before uploading, extract the ZIP to a new directory, load that directory through `chrome://extensions/`, and complete the checks below. For subsequent releases, increase the version in `manifest.json` before rebuilding.

### First Store Submission

1. Register an account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/), read and accept the agreement, and pay the one-time registration fee shown there. See the [registration instructions](https://developer.chrome.com/docs/webstore/register).
2. Set your publisher name, verify your contact email, and complete the account details requested by the dashboard. Enable two-step verification on your Google account, as required by the [publishing policy](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification).
3. Use the [public privacy policy URL](https://github.com/michaelHMK/json-formatter-extension/blob/main/PRIVACY.md), hosted in this repository. To update the public policy, edit [PRIVACY.md](PRIVACY.md), then commit and push to `main`. Confirm that the link is accessible in a signed-out browser window before submitting.
4. Create a store listing and upload the extension ZIP from `dist/`. Follow [STORE_LISTING.md](STORE_LISTING.md) for English and Chinese descriptions, privacy declarations, and testing instructions. Upload the images for each language from `store-assets/`.
5. Choose distribution regions and public visibility, review the preview, and submit for review. You can publish automatically after approval or publish manually; see the [official publishing process](https://developer.chrome.com/docs/webstore/publish).

### Pre-Upload Functional Checklist

- Click the extension icon to open the toolbox and confirm that the extension management page shows no loading errors.
- Check all three indentation options, invalid JSON location reporting, tree expansion, search, copying, and clearing.
- Check minify, escape, and unescape with newlines, quotes, backslashes, and Unicode text.
- Check additions, removals, value changes, and type changes in JSON Compare, along with array key matching, ignored paths, differences-only mode, and text comparison.
- Check interface text with both English and Chinese browser languages, then repeat the main operations while offline.
- Keep release materials consistent with the actual version, and avoid claims about file-processing speed that have not been verified.

## Privacy

- No sensitive permissions, such as host access or storage, are requested; see `manifest.json`.
- All processing happens locally in the browser, with no third-party SDKs or telemetry.
- See the [privacy policy](PRIVACY.md) for details. Use the [publicly hosted version](https://github.com/michaelHMK/json-formatter-extension/blob/main/PRIVACY.md) for the store listing.
