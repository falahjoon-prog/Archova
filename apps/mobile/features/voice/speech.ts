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

/** Long dictation for the voice log: keeps listening through pauses until stopped, and reports the text so far. */
export interface DictationPort {
  ensurePermission(): Promise<boolean>;
  /** Listen until `stop()`; `onText` gets the whole transcript each time it grows. Resolves with the final text. */
  dictate(onText: (text: string) => void): Promise<string>;
  stop(): void;
}

export const deviceDictation: DictationPort = {
  ensurePermission: deviceSpeech.ensurePermission,
  dictate(onText) {
    return new Promise<string>((resolve) => {
      const finals: string[] = [];
      let interim = '';
      const subs: { remove(): void }[] = [];
      const text = () => [...finals, interim].filter(Boolean).join(' ').trim();
      const done = () => {
        subs.forEach((s) => s.remove());
        resolve([...finals, interim].filter(Boolean).join(' ').trim());
      };
      subs.push(
        ExpoSpeechRecognitionModule.addListener('result', (e) => {
          const best = e.results[0]?.transcript ?? '';
          if (e.isFinal) {
            if (best) finals.push(best);
            interim = '';
          } else interim = best;
          onText(text());
        }),
        ExpoSpeechRecognitionModule.addListener('error', done),
        ExpoSpeechRecognitionModule.addListener('end', done),
      );
      ExpoSpeechRecognitionModule.start({
        lang: 'en-AU',
        interimResults: true,
        continuous: true,
        // The audio never leaves the phone where the OS can do this on device; only the text goes to Nova.
        requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
        iosTaskHint: 'dictation',
        contextualStrings: ['Nova', 'RFI', 'SWMS', 'diary', 'near miss', 'formwork', 'scaffold'],
      });
    });
  },
  stop() {
    ExpoSpeechRecognitionModule.stop();
  },
};
