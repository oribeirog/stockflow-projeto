import sharp from 'sharp';
import { nativeImage } from 'electron';
import { FotoError, MAX_SOURCE, imageHeader } from './foto-validation';
import type { FotoDiagnostic } from './foto-diagnostics';
import type { FotoNormalizada } from './fotos';

// One application photo lock serializes capture, normalization and persistence.
// Bound libvips threads/cache as well as decoded pixels; no file/URL input is used.
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 16 });

export function webpHeader(bytes: Buffer) {
  if (bytes.length > MAX_SOURCE) throw new FotoError('PHOTO_SIZE');
  const invalid = (): never => {
    throw new FotoError('PHOTO_INVALID');
  };
  if (
    bytes.length < 20 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    return invalid();
  const seen = new Set<string>();
  let pos = 12,
    width = 0,
    height = 0,
    image = false;
  while (pos + 8 <= bytes.length) {
    if (seen.size >= 256) return invalid();
    const type = bytes.toString('ascii', pos, pos + 4),
      length = bytes.readUInt32LE(pos + 4);
    if (length > bytes.length - pos - 8 || seen.has(type)) return invalid();
    seen.add(type);
    const start = pos + 8;
    if (type === 'ANIM' || type === 'ANMF') throw new FotoError('PHOTO_FORMAT');
    if (type === 'VP8X') {
      if (pos !== 12 || length !== 10) return invalid();
      if (bytes[start] & 2) throw new FotoError('PHOTO_FORMAT');
      width = bytes.readUIntLE(start + 4, 3) + 1;
      height = bytes.readUIntLE(start + 7, 3) + 1;
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (image) return invalid();
      image = true;
      let w: number, h: number;
      if (type === 'VP8 ') {
        if (
          length < 10 ||
          !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 1, 0x2a]))
        )
          return invalid();
        w = bytes.readUInt16LE(start + 6) & 0x3fff;
        h = bytes.readUInt16LE(start + 8) & 0x3fff;
      } else {
        if (length < 5 || bytes[start] !== 0x2f) return invalid();
        const bits = bytes.readUInt32LE(start + 1);
        w = (bits & 0x3fff) + 1;
        h = ((bits >>> 14) & 0x3fff) + 1;
      }
      if (width && (width !== w || height !== h)) return invalid();
      width = w;
      height = h;
    }
    pos = start + length + (length & 1);
    if (length & 1 && bytes[pos - 1] !== 0) return invalid();
  }
  if (!image || !width || !height || pos !== bytes.length) return invalid();
  if (width > 8192 || height > 8192 || width * height > 24_000_000)
    throw new FotoError('PHOTO_DIMENSIONS');
  return { width, height };
}

export async function normalizeWebp(
  bytes: Buffer,
  diagnostic: (event: FotoDiagnostic) => void,
): Promise<FotoNormalizada> {
  const started = performance.now();
  let phase = 'webp-header';
  try {
    const source = webpHeader(bytes);
    phase = 'webp-decode';
    const input = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: 24_000_000,
      limitInputChannels: 4,
      sequentialRead: true,
    });
    const metadata = await input.metadata();
    if (
      metadata.format !== 'webp' ||
      metadata.width !== source.width ||
      metadata.height !== source.height
    )
      throw new FotoError('PHOTO_INVALID');
    if ((metadata.pages ?? 1) !== 1) throw new FotoError('PHOTO_FORMAT');
    const mime = metadata.hasAlpha ? 'image/png' : 'image/jpeg';
    phase = 'webp-normalize';
    let image: Buffer = Buffer.alloc(0),
      reductions = 0;
    // All outputs are sRGB, metadata-free JPEG/PNG. Auto orientation is applied
    // once by libvips, never again by the legacy input orientation path.
    for (let max = 2048; reductions <= 4; reductions++, max = Math.floor(max * 0.9)) {
      const pipeline = input
        .clone()
        .autoOrient()
        .toColourspace('srgb')
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .timeout({ seconds: 15 });
      image = await (
        mime === 'image/png' ? pipeline.png() : pipeline.jpeg({ quality: 90 })
      ).toBuffer();
      if (image.length <= 8 * 1024 * 1024) break;
    }
    if (!image.length || image.length > 8 * 1024 * 1024) throw new FotoError('PHOTO_PROCESSING');
    const header = imageHeader(image),
      decoded = nativeImage.createFromBuffer(image);
    if (decoded.isEmpty() || header.mime !== mime) throw new FotoError('PHOTO_PROCESSING');
    const size = decoded.getSize();
    const thumbnail =
      Math.max(size.width, size.height) <= 160
        ? decoded
        : decoded.resize(size.width >= size.height ? { width: 160 } : { height: 160 });
    const thumb = mime === 'image/png' ? thumbnail.toPNG() : thumbnail.toJPEG(90);
    if (!thumb.length || thumb.length > 256 * 1024) throw new FotoError('PHOTO_PROCESSING');
    diagnostic({
      phase: 'normalized',
      format: 'image/webp',
      bytes: bytes.length,
      width: source.width,
      height: source.height,
      outputWidth: size.width,
      outputHeight: size.height,
      orientation: metadata.orientation ?? 1,
      reductions,
      ms: Math.round(performance.now() - started),
    });
    return { mime, image, thumb, size, thumbSize: thumbnail.getSize() };
  } catch (error) {
    const code =
      error instanceof FotoError
        ? error.code
        : phase === 'webp-decode'
          ? 'PHOTO_INVALID'
          : 'PHOTO_PROCESSING';
    diagnostic({ phase, code, format: 'image/webp', bytes: bytes.length });
    throw new FotoError(code);
  }
}
