/**
 * Shared throbber phrase store — rotates status text while streaming.
 *
 * The phrase is managed centrally so both the StreamingMessage (focused)
 * and StatusBar (defocused) can display it without duplicating timers.
 *
 * The phrase only kicks in after INACTIVITY_MS of silence (no new content)
 * and then rotates every PHRASE_INTERVAL_MS. Any new streaming content
 * resets the inactivity timer via nudge(), hiding the phrase until the
 * next quiet period.
 */
import { pickPhrase } from '$lib/config/throbberPhrases';

/** How often the displayed phrase rotates once visible. */
const PHRASE_INTERVAL_MS = 8000;
/** How long the stream must be quiet before the phrase appears. */
const INACTIVITY_MS = 8000;

let phrase = $state('');
let visible = $state(false);
let intervalId: ReturnType<typeof setInterval> | null = null;
let delayId: ReturnType<typeof setTimeout> | null = null;
let currentTheme: string | null = null;

/** Clear all pending timers without touching visible state. */
function clearTimers() {
  if (delayId) {
    clearTimeout(delayId);
    delayId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * (Re)start the inactivity delay. After INACTIVITY_MS of silence the
 * phrase becomes visible and begins rotating every PHRASE_INTERVAL_MS.
 */
function startInactivityDelay() {
  clearTimers();
  visible = false;
  phrase = '';

  delayId = setTimeout(() => {
    delayId = null;
    phrase = pickPhrase(currentTheme!, undefined);
    visible = true;
    intervalId = setInterval(() => {
      phrase = pickPhrase(currentTheme!, phrase);
    }, PHRASE_INTERVAL_MS);
  }, INACTIVITY_MS);
}

/** Begin tracking a new streaming session. */
function start(theme: string) {
  stop();
  currentTheme = theme;
  startInactivityDelay();
}

/**
 * Signal that new content just arrived — resets the inactivity timer.
 * If the throbber was already visible it hides immediately and the
 * delay starts fresh.
 */
function nudge() {
  if (!currentTheme) return; // not active
  startInactivityDelay();
}

function stop() {
  clearTimers();
  currentTheme = null;
  phrase = '';
  visible = false;
}

export const throbberStore = {
  get phrase() {
    return phrase;
  },
  get visible() {
    return visible;
  },
  start,
  stop,
  nudge,
};
