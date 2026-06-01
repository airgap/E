# E Popover (Chrome extension)

Floats a draggable, resizable **E** window over a tab so a single shared Chrome
tab carries both the video and your editor — works around Linux Discord only
capturing audio from Chrome tabs.

## Why an extension (not just Tampermonkey)

YouTube's `Content-Security-Policy` blocks injected iframes pointing at
`localhost`. A userscript can't override the host page's CSP; this extension
strips it via `declarativeNetRequest` (`rules.json`). `http://localhost` is
exempt from Chrome's mixed-content blocking, so the iframe loads on https pages.

## Install

1. Make sure E is running locally (`e serve`, or any `e` launch → it serves on
   `http://localhost:3002`).
2. `chrome://extensions` → enable **Developer mode** (top-right).
3. **Load unpacked** → select this `e-popover-extension/` folder.
4. Open/refresh a YouTube tab.

## Use

- **Alt+E**, or the round **E** button (bottom-right), toggles the window.
- Drag the title bar to move; drag the bottom-right grip to resize.
- Title-bar buttons: ⚙ set E URL · ⟳ reload · ⇱ open in new tab · ✕ close.
- Position/size/open-state persist across reloads.

Then screenshare that one YouTube tab in Discord — both the video and the E
editor are in the same captured surface.

## Tweaks

- **Other sites:** add match patterns to `content_scripts[].matches` **and**
  `host_permissions` in `manifest.json`, and broaden the `condition.urlFilter`
  in `rules.json` (or add rules) so their CSP is relaxed too. Reload the
  extension afterward.
- **Different port/host:** click ⚙ in the title bar, or change `DEFAULT_URL` in
  `content.js`.

## Trigger from a Tampermonkey/userscript

The content script listens for window messages, so any script on the page can
toggle it:

```js
window.postMessage({ type: 'EPOP_TOGGLE' }, '*'); // also EPOP_OPEN / EPOP_CLOSE
```

## Caveats

- If the iframe is blank: confirm E is up (`curl http://localhost:3002/health`),
  and check the tab's DevTools console. Newer Chrome may gate local-network
  iframes behind Private Network Access — if so, E's server needs to answer the
  preflight with `Access-Control-Allow-Private-Network: true` (small server
  change; ask and I'll add it).
- Stripping YouTube's CSP is broad but scoped to youtube.com and only affects
  your browser.
