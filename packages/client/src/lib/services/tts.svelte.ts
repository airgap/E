// Text-to-speech store using Web Speech API SpeechSynthesis
class TtsStore {
  speaking = $state(false);
  currentId = $state<string | null>(null); // message ID being read

  speak(text: string, messageId: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    // Prefer a natural English voice
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang.startsWith('en') && !v.name.includes('Google')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0];
    if (preferred) utterance.voice = preferred;

    this.speaking = true;
    this.currentId = messageId;
    utterance.onend = () => {
      this.speaking = false;
      this.currentId = null;
    };
    utterance.onerror = () => {
      this.speaking = false;
      this.currentId = null;
    };
    window.speechSynthesis.speak(utterance);
  }

  stop() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.speaking = false;
    this.currentId = null;
  }

  toggle(text: string, messageId: string) {
    if (this.currentId === messageId) this.stop();
    else this.speak(text, messageId);
  }
}

export const ttsStore = new TtsStore();
