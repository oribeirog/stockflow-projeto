import { nativeImage } from 'electron';
import { FotoError, imageHeader } from './foto-validation';
export function normalizeFoto(bytes: Buffer) {
  const header = imageHeader(bytes);
  const original = nativeImage.createFromBuffer(bytes);
  if (original.isEmpty()) throw new FotoError('PHOTO_INVALID');
  const size = original.getSize();
  // Orientation can exchange the axes, but cannot increase the pixel count.
  if (size.width * size.height !== header.width * header.height)
    throw new FotoError('PHOTO_INVALID');
  const scaled = (max: number) =>
    Math.max(size.width, size.height) <= max
      ? original
      : original.resize(size.width >= size.height ? { width: max } : { height: max });
  const image = scaled(2048),
    thumb = scaled(160);
  const encode = (value: Electron.NativeImage) =>
    header.mime === 'image/png' ? value.toPNG() : value.toJPEG(90);
  const imageBytes = encode(image),
    thumbBytes = encode(thumb);
  if (
    !imageBytes.length ||
    imageBytes.length > 8 * 1024 * 1024 ||
    !thumbBytes.length ||
    thumbBytes.length > 256 * 1024
  )
    throw new FotoError('PHOTO_INVALID');
  return {
    mime: header.mime,
    image: imageBytes,
    thumb: thumbBytes,
    size: image.getSize(),
    thumbSize: thumb.getSize(),
  };
}
