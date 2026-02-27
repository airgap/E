/**
 * Shared throbber phrase store — rotates status text while streaming.
 *
 * The phrase is managed centrally so both the StreamingMessage (focused)
 * and StatusBar (defocused) can display it without duplicating timers.
 *
 * The phrase only kicks in after INITIAL_DELAY_MS of streaming (to avoid
 * flashing text on quick responses) and then rotates every PHRASE_INTERVAL_MS.
 */
import { pickPhrase } from '$lib/config/throbberPhrases';

const PHRASE_INTERVAL_MS = 8000;
const INITIAL_DELAY_MS = 8000;

let phrase = $state('');
let visible = $state(false);
let intervalId: ReturnType<typeof setInterval> | null = null;
let delayId: ReturnType<typeof setTimeout> | null = null;
let currentTheme: string | null = null;

function start(theme: string) {
  stop();
  currentTheme = theme;
  // Don't show any phrase for the first 8 seconds
  phrase = '';
  visible = false;

  delayId = setTimeout(() => {
    delayId = null;
    phrase = pickPhrase(theme, undefined);
    visible = true;
    intervalId = setInterval(() => {
      phrase = pickPhrase(theme, phrase);
    }, PHRASE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
}

function stop() {
  if (delayId) {
    clearTimeout(delayId);
    delayId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
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
};
