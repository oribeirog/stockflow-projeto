import { FotoError } from './foto-validation';

// Read only IFD0 orientation. No recursive EXIF/GPS traversal or metadata retention.
export function exifOrientation(bytes: Buffer, mime: string): number {
  let tiff: Buffer | undefined;
  if (mime === 'image/jpeg') {
    let pos = 2;
    while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
      while (bytes[pos] === 0xff) pos++;
      const marker = bytes[pos++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = bytes.readUInt16BE(pos);
      if (size < 2 || pos + size > bytes.length) throw new FotoError('PHOTO_INVALID');
      if (marker === 0xe1 && bytes.toString('ascii', pos + 2, pos + 8) === 'Exif\0\0') {
        tiff = bytes.subarray(pos + 8, pos + size);
        break;
      }
      pos += size;
    }
  } else {
    let pos = 8;
    while (pos + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(pos);
      if (bytes.toString('ascii', pos + 4, pos + 8) === 'eXIf') {
        tiff = bytes.subarray(pos + 8, pos + 8 + size);
        break;
      }
      pos += size + 12;
    }
  }
  if (!tiff) return 1;
  const invalid = (): never => {
    throw new FotoError('PHOTO_INVALID');
  };
  if (tiff.length < 8) return invalid();
  const order = tiff.toString('ascii', 0, 2);
  if (order !== 'II' && order !== 'MM') return invalid();
  const read = (pos: number, size: 2 | 4) => {
    if (pos < 0 || pos + size > tiff!.length) return invalid();
    return size === 2
      ? order === 'II'
        ? tiff!.readUInt16LE(pos)
        : tiff!.readUInt16BE(pos)
      : order === 'II'
        ? tiff!.readUInt32LE(pos)
        : tiff!.readUInt32BE(pos);
  };
  if (read(2, 2) !== 42) return invalid();
  const start = read(4, 4),
    count = read(start, 2);
  if (start < 8 || start + 2 + count * 12 + 4 > tiff.length) return invalid();
  let orientation = 1,
    found = false;
  for (let i = 0; i < count; i++) {
    const pos = start + 2 + i * 12;
    if (read(pos, 2) !== 0x112) continue;
    if (found || read(pos + 2, 2) !== 3 || read(pos + 4, 4) !== 1) return invalid();
    found = true;
    orientation = read(pos + 8, 2);
    if (orientation < 1 || orientation > 8) return invalid();
  }
  return orientation;
}

// Bounded, already resized BGRA bitmap. All eight EXIF transforms, exactly once.
export function orientBitmap(bytes: Buffer, width: number, height: number, orientation: number) {
  const swapped = orientation >= 5,
    w = swapped ? height : width,
    h = swapped ? width : height;
  const output = Buffer.alloc(bytes.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let dx = x,
        dy = y;
      switch (orientation) {
        case 2:
          dx = width - 1 - x;
          break;
        case 3:
          dx = width - 1 - x;
          dy = height - 1 - y;
          break;
        case 4:
          dy = height - 1 - y;
          break;
        case 5:
          dx = y;
          dy = x;
          break;
        case 6:
          dx = height - 1 - y;
          dy = x;
          break;
        case 7:
          dx = height - 1 - y;
          dy = width - 1 - x;
          break;
        case 8:
          dx = y;
          dy = width - 1 - x;
          break;
      }
      bytes.copy(output, (dy * w + dx) * 4, (y * width + x) * 4, (y * width + x + 1) * 4);
    }
  return { bytes: output, width: w, height: h };
}
