/**
 * Lightweight app-ready signal.
 *
 * AppShell resolves this after the full init chain completes
 * (server ready → workspace init → stream reconnect → conversation restore).
 * The root layout awaits it before dismissing the splash screen so users
 * never see a half-rendered UI flash.
 *
 * A safety timeout ensures the splash is never permanently stuck.
 */

let _resolve: () => void;

export const appReady = new Promise<void>((r) => {
  _resolve = r;
});

let _signalled = false;

export function signalAppReady() {
  if (_signalled) return;
  _signalled = true;
  _resolve();
  // Bridge to the vanilla splash animation script in app.html
  if (typeof window !== 'undefined') {
    (window as any).__splashReady = true;
  }
}

export function isAppReady() {
  return _signalled;
}
