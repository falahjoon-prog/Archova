// Writes a drawn signature to the app sandbox as a PNG, ready for upload.
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { signaturePng, type UnitPoint } from './png';
import type { SignatureImage } from './commands';

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export async function saveSignature(
  attendeeId: string,
  strokes: readonly (readonly UnitPoint[])[],
): Promise<SignatureImage> {
  const dir = new Directory(Paths.cache, 'signatures');
  if (!dir.exists) dir.create({ intermediates: true });
  const png = new Uint8Array(signaturePng(strokes));
  const file = new File(dir, `signature-${attendeeId}.png`);
  if (file.exists) file.delete();
  file.create();
  file.write(png);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, png);
  return {
    localUri: file.uri,
    filename: file.name,
    sizeBytes: png.byteLength,
    sha256: toHex(new Uint8Array(digest)),
  };
}
