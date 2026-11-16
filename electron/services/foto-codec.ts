import { nativeImage } from 'electron';
import { FotoError, imageHeader } from './foto-validation';
import { exifOrientation, orientBitmap } from './foto-orientation';
import { crc32 } from 'node:zlib';
import { consoleFotoDiagnostic, type FotoDiagnostic } from './foto-diagnostics';
export function normalizeFoto(
  bytes: Buffer,
  diagnostic: (event: FotoDiagnostic) => void = consoleFotoDiagnostic,
) {
  // WebP is an input format only. Legacy JPEG/PNG processing and immutable reads
  // retain their established representation and validation contract.
  if (bytes.toString('ascii', 8, 12) === 'WEBP')
    return import('./foto-webp.js').then(({ normalizeWebp }) => normalizeWebp(bytes, diagnostic));
  let phase = 'header';
  let source: ReturnType<typeof imageHeader> | undefined;
  const started = performance.now();
  try {
    const header = imageHeader(bytes);
    source = header;
    if (header.mime === 'image/png') {
      // Source CRC verification is deliberately separate from legacy object reads.
      // Existing immutable files/backups retain their established hash contract.
      for (let pos = 8; pos + 12 <= bytes.length; ) {
        const length = bytes.readUInt32BE(pos);
        if (
          crc32(bytes.subarray(pos + 4, pos + 8 + length)) !== bytes.readUInt32BE(pos + 8 + length)
        )
          throw new FotoError('PHOTO_INVALID');
        pos += length + 12;
      }
    }
    const orientation = exifOrientation(bytes, header.mime);
    const validationMs = performance.now() - started;
    phase = 'decode';
    const decodeStart = performance.now();
    const original = nativeImage.createFromBuffer(bytes);
    if (original.isEmpty()) throw new FotoError('PHOTO_INVALID');
    const size = original.getSize();
    // Orientation can exchange the axes, but cannot increase the pixel count.
    if (size.width * size.height !== header.width * header.height)
      throw new FotoError('PHOTO_INVALID');
    const decodeMs = performance.now() - decodeStart;
    const scaled = (max: number) =>
      Math.max(size.width, size.height) <= max
        ? original
        : original.resize(size.width >= size.height ? { width: max } : { height: max });
    phase = 'normalize';
    const normalizeStart = performance.now();
    const normalized = scaled(2048);
    const sizeBeforeOrientation = normalized.getSize();
    // Electron 43 exposes sRGB pixels. Rebuild to strip EXIF/GPS/ICC and normalize
    // colour before encoding; createFromBuffer does not apply EXIF orientation.
    const bitmap = normalized.toBitmap();
    const rotated = orientBitmap(
      bitmap,
      sizeBeforeOrientation.width,
      sizeBeforeOrientation.height,
      orientation,
    );
    let image = nativeImage.createFromBitmap(rotated.bytes, {
      width: rotated.width,
      height: rotated.height,
    });
    const normalizeMs = performance.now() - normalizeStart;
    phase = 'encode';
    const encodeStart = performance.now();
    const encode = (value: Electron.NativeImage) =>
      header.mime === 'image/png' ? value.toPNG() : value.toJPEG(90);
    let imageBytes = encode(image),
      reductions = 0;
    // A valid PNG below the 10 MiB source limit may exceed the immutable schema's
    // 8 MiB output limit. Fit proportionally instead of misclassifying it as invalid.
    // Four 10% reductions bound work and reduce worst-case RGBA output below 8 MiB.
    while (imageBytes.length > 8 * 1024 * 1024 && reductions < 4) {
      image = image.resize({
        width: Math.max(1, Math.floor(image.getSize().width * 0.9)),
        quality: 'best',
      });
      imageBytes = encode(image);
      reductions++;
    }
    const finalSize = image.getSize(),
      thumbnailStart = performance.now();
    const thumb =
      Math.max(finalSize.width, finalSize.height) <= 160
        ? image
        : image.resize(finalSize.width >= finalSize.height ? { width: 160 } : { height: 160 });
    const thumbnailMs = performance.now() - thumbnailStart,
      thumbBytes = encode(thumb);
    if (
      !imageBytes.length ||
      imageBytes.length > 8 * 1024 * 1024 ||
      !thumbBytes.length ||
      thumbBytes.length > 256 * 1024
    )
      throw new FotoError('PHOTO_PROCESSING');
    const result = {
      mime: header.mime,
      image: imageBytes,
      thumb: thumbBytes,
      size: image.getSize(),
      thumbSize: thumb.getSize(),
    };
    diagnostic({
      phase: 'normalized',
      format: header.mime,
      bytes: bytes.length,
      width: header.width,
      height: header.height,
      orientation,
      reductions,
      outputWidth: finalSize.width,
      outputHeight: finalSize.height,
      ms: Math.round(performance.now() - started),
      validationMs,
      decodeMs,
      normalizeMs,
      thumbnailMs,
      encodeMs: performance.now() - encodeStart - thumbnailMs,
    });
    return result;
  } catch (error) {
    const code = error instanceof FotoError ? error.code : 'PHOTO_PROCESSING';
    diagnostic({
      phase,
      code,
      bytes: bytes.length,
      ...(source ? { format: source.mime, width: source.width, height: source.height } : {}),
    });
    throw new FotoError(code);
  }
}
