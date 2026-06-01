// E Popover — injects a floating, draggable, resizable iframe of the local E
// app over the current tab. Built so one screenshared Chrome tab (e.g. a
// YouTube call) can show both the video and your editor, since Linux Discord
// only captures audio from Chrome tabs.
//
// Toggle:  Alt+E, the floating "E" launcher button, the extension's content
//          script message, or window.postMessage({ type: 'EPOP_TOGGLE' }).
//
// The host page's CSP is stripped by declarativeNetRequest (rules.json) so the
// localhost iframe is allowed to load. http://localhost is exempt from Chrome's
// mixed-content blocking, so it loads on https pages too.

(() => {
  'use strict';

  const NS = 'epop';
  const DEFAULT_URL = 'http://localhost:3002';
  const STORE_KEY = 'epop_state';
  const URL_KEY = 'epop_url';

  // Guard against double-injection (SPA re-runs / multiple loads).
  if (window.__E_POPOVER_INSTALLED__) return;
  window.__E_POPOVER_INSTALLED__ = true;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const defaultState = () => ({
    left: Math.max(20, window.innerWidth - 860),
    top: 80,
    width: 820,
    height: 620,
    open: false,
  });

  let state = defaultState();
  let eUrl = DEFAULT_URL;

  // ---- storage (chrome.storage.local, async) --------------------------------
  function load() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORE_KEY, URL_KEY], (res) => {
          if (res && res[STORE_KEY]) state = { ...state, ...res[STORE_KEY] };
          if (res && res[URL_KEY]) eUrl = res[URL_KEY];
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        chrome.storage.local.set({ [STORE_KEY]: state });
      } catch {
        /* ignore */
      }
    }, 200);
  }

  // ---- styles ---------------------------------------------------------------
  const css = `
  .${NS}-launcher {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
    width: 40px; height: 40px; border-radius: 50%;
    background: #6c5ce7; color: #fff; font: 600 18px/40px system-ui, sans-serif;
    text-align: center; cursor: pointer; user-select: none;
    box-shadow: 0 4px 14px rgba(0,0,0,.35); border: none;
    transition: transform .1s ease, opacity .15s ease; opacity: .85;
  }
  .${NS}-launcher:hover { transform: scale(1.08); opacity: 1; }
  .${NS}-panel {
    position: fixed; z-index: 2147483647; display: none;
    background: #1e1e24; border: 1px solid #3a3a44; border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0,0,0,.5); overflow: hidden;
    min-width: 320px; min-height: 220px;
    flex-direction: column; color: #e6e6e6;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .${NS}-panel.${NS}-open { display: flex; }
  .${NS}-bar {
    height: 34px; flex: 0 0 34px; display: flex; align-items: center; gap: 8px;
    padding: 0 8px; background: #2a2a32; cursor: move; user-select: none;
  }
  .${NS}-title { font-size: 12px; font-weight: 600; letter-spacing: .3px; opacity: .9; }
  .${NS}-spacer { flex: 1 1 auto; }
  .${NS}-btn {
    width: 24px; height: 24px; border: none; border-radius: 5px; cursor: pointer;
    background: transparent; color: #cfcfd6; font-size: 14px; line-height: 24px;
  }
  .${NS}-btn:hover { background: #3a3a44; color: #fff; }
  .${NS}-frame { flex: 1 1 auto; width: 100%; border: 0; background: #fff; }
  .${NS}-grip {
    position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
    cursor: nwse-resize; z-index: 2;
    background:
      linear-gradient(135deg, transparent 50%, #6c6c78 50%, #6c6c78 60%, transparent 60%,
      transparent 72%, #6c6c78 72%, #6c6c78 82%, transparent 82%);
  }
  .${NS}-dragging .${NS}-frame { pointer-events: none; }
  `;

  // ---- DOM ------------------------------------------------------------------
  const root = document.documentElement;
  const style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);

  const launcher = document.createElement('button');
  launcher.className = `${NS}-launcher`;
  launcher.textContent = 'E';
  launcher.title = 'Toggle E (Alt+E)';
  root.appendChild(launcher);

  const panel = document.createElement('div');
  panel.className = `${NS}-panel`;
  panel.innerHTML = `
    <div class="${NS}-bar">
      <span class="${NS}-title">E</span>
      <span class="${NS}-spacer"></span>
      <button class="${NS}-btn" data-act="url"     title="Set E URL">⚙</button>
      <button class="${NS}-btn" data-act="reload"  title="Reload">⟳</button>
      <button class="${NS}-btn" data-act="popout"  title="Open in new tab">⇱</button>
      <button class="${NS}-btn" data-act="close"   title="Close (Alt+E)">✕</button>
    </div>
    <iframe class="${NS}-frame" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
    <div class="${NS}-grip" title="Drag to resize"></div>
  `;
  root.appendChild(panel);

  const frame = panel.querySelector(`.${NS}-frame`);
  const bar = panel.querySelector(`.${NS}-bar`);
  const grip = panel.querySelector(`.${NS}-grip`);

  // ---- apply / render -------------------------------------------------------
  function applyGeometry() {
    state.left = clamp(state.left, 0, Math.max(0, window.innerWidth - 120));
    state.top = clamp(state.top, 0, Math.max(0, window.innerHeight - 60));
    panel.style.left = state.left + 'px';
    panel.style.top = state.top + 'px';
    panel.style.width = state.width + 'px';
    panel.style.height = state.height + 'px';
  }

  let frameLoaded = false;
  function ensureFrame() {
    if (!frameLoaded) {
      frame.src = eUrl;
      frameLoaded = true;
    }
  }

  function open() {
    state.open = true;
    ensureFrame();
    applyGeometry();
    panel.classList.add(`${NS}-open`);
    save();
  }
  function close() {
    state.open = false;
    panel.classList.remove(`${NS}-open`);
    save();
  }
  function toggle() {
    state.open ? close() : open();
  }

  // ---- header actions -------------------------------------------------------
  bar.addEventListener('click', (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === 'close') close();
    else if (act === 'reload') frame.src = eUrl;
    else if (act === 'popout') window.open(eUrl, '_blank');
    else if (act === 'url') {
      const next = prompt('E URL:', eUrl);
      if (next && next.trim()) {
        eUrl = next.trim();
        try {
          chrome.storage.local.set({ [URL_KEY]: eUrl });
        } catch {
          /* ignore */
        }
        frame.src = eUrl;
      }
    }
  });

  // ---- drag (header) --------------------------------------------------------
  let drag = null;
  bar.addEventListener('mousedown', (e) => {
    if (e.target.closest(`.${NS}-btn`)) return; // let buttons click
    drag = { dx: e.clientX - state.left, dy: e.clientY - state.top };
    panel.classList.add(`${NS}-dragging`);
    e.preventDefault();
  });

  // ---- resize (grip) --------------------------------------------------------
  let resize = null;
  grip.addEventListener('mousedown', (e) => {
    resize = { sx: e.clientX, sy: e.clientY, w: state.width, h: state.height };
    panel.classList.add(`${NS}-dragging`);
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener(
    'mousemove',
    (e) => {
      if (drag) {
        state.left = e.clientX - drag.dx;
        state.top = e.clientY - drag.dy;
        applyGeometry();
      } else if (resize) {
        state.width = Math.max(320, resize.w + (e.clientX - resize.sx));
        state.height = Math.max(220, resize.h + (e.clientY - resize.sy));
        applyGeometry();
      }
    },
    true,
  );

  window.addEventListener(
    'mouseup',
    () => {
      if (drag || resize) {
        drag = resize = null;
        panel.classList.remove(`${NS}-dragging`);
        save();
      }
    },
    true,
  );

  // ---- triggers -------------------------------------------------------------
  launcher.addEventListener('click', toggle);

  // Alt+E — capture phase + stopPropagation so YouTube's shortcuts don't eat it.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    },
    true,
  );

  // External trigger from a userscript / page: window.postMessage({type:'EPOP_TOGGLE'})
  window.addEventListener('message', (e) => {
    const t = e.data && e.data.type;
    if (t === 'EPOP_TOGGLE') toggle();
    else if (t === 'EPOP_OPEN') open();
    else if (t === 'EPOP_CLOSE') close();
  });

  window.addEventListener('resize', () => state.open && applyGeometry());

  // ---- init -----------------------------------------------------------------
  load().then(() => {
    if (state.open) open();
  });
})();
