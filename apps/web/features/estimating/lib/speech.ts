// Nova's voice on the quote comparison: the device reads the reply aloud with its own text-to-speech
// (`speechSynthesis`), so it costs nothing and no audio or text leaves the device. Speech recognition is not here:
// browsers send the audio to their vendor, which breaks the Australia-only rule (X25), so it goes through the `ai` module.

export const speechSupported = () =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance !== 'undefined';

/** Read `text` aloud in Australian English where the device has such a voice; `onEnd` fires when it finishes or stops. */
export function speak(text: string, onEnd: () => void): void {
  if (!speechSupported()) return onEnd();
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-AU';
  const voice = synth.getVoices().find((v) => v.lang.replace('_', '-') === 'en-AU');
  if (voice) utterance.voice = voice;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
