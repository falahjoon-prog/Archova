// Nova's voice on the quote comparison. Speaking: the device reads the reply aloud with its own text-to-speech
// (`speechSynthesis`), so it costs nothing and no text leaves the device. Listening: the browser only records a short
// clip; the words come from the speech service in Australia through the `ai` module, never from the browser's own
// recogniser, which sends the audio to its vendor (X25).

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

export const recordingSupported = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== 'undefined';

/** A longest clip: Nova listens to a question, not a meeting. The API accepts about a minute. */
export const MAX_RECORDING_MS = 45_000;

/**
 * Starts the microphone and returns a handle; `stop()` ends it and gives the clip. The microphone is released as
 * soon as the clip ends, and nothing is uploaded until the caller sends the clip to Nova.
 */
export async function startRecording(): Promise<{ stop(): Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
  });
  recorder.start();
  const timer = setTimeout(
    () => recorder.state !== 'inactive' && recorder.stop(),
    MAX_RECORDING_MS,
  );
  return {
    stop() {
      clearTimeout(timer);
      if (recorder.state !== 'inactive') recorder.stop();
      return done;
    },
  };
}
