// The phone's own speech recognition and read-back, behind a small port so the screen and tests never touch
// the native modules. Recognition asks for on-device models where the OS has them (docs/mobile/01: raw audio
// stays on the phone); only the transcript is used.
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import * as Speech from 'expo-speech';

export interface SpeechPort {
  /** Ask for the microphone and speech permissions; false if refused. */
  ensurePermission(): Promise<boolean>;
  /** Listen for one phrase; resolves with the final transcript ('' if nothing was heard). */
  listen(): Promise<string>;
  stopListening(): void;
  speak(text: string): void;
  stopSpeaking(): void;
}

export const deviceSpeech: SpeechPort = {
  async ensurePermission() {
    const r = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return r.granted;
  },
  listen() {
    return new Promise<string>((resolve) => {
      let best = '';
      const subs: { remove(): void }[] = [];
      const done = () => {
        subs.forEach((s) => s.remove());
        resolve(best);
      };
      subs.push(
        ExpoSpeechRecognitionModule.addListener('result', (e) => {
          best = e.results[0]?.transcript ?? best;
        }),
        ExpoSpeechRecognitionModule.addListener('error', done),
        ExpoSpeechRecognitionModule.addListener('end', done),
      );
      ExpoSpeechRecognitionModule.start({
        lang: 'en-AU',
        interimResults: false,
        requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
        // Site noise: stop after a pause rather than listening forever.
        iosTaskHint: 'dictation',
        contextualStrings: ['Nova', 'RFI', 'SWMS', 'diary', 'incident', 'near miss'],
      });
    });
  },
  stopListening() {
    ExpoSpeechRecognitionModule.stop();
  },
  speak(text) {
    Speech.speak(text, { language: 'en-AU' });
  },
  stopSpeaking() {
    void Speech.stop();
  },
};
