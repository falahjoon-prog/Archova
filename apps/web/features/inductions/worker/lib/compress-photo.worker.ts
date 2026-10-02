import { reencode } from './compress-photo';

// Off the main thread so the phone stays responsive while a 12 MP photo is resized.
self.onmessage = async (e: MessageEvent<Blob>) => {
  try {
    self.postMessage(await reencode(e.data));
  } catch {
    self.postMessage(null);
  }
};
