export const MAX_SOURCE = 10 * 1024 * 1024;
export class FotoError extends Error {
  constructor(public readonly code: 'PHOTO_INVALID' | 'PHOTO_EXPIRED' | 'PHOTO_UNAVAILABLE') {
    super(code);
  }
}
export function imageHeader(bytes: Buffer): {
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
} {
  const fail = (): never => {
    throw new FotoError('PHOTO_INVALID');
  };
  if (!bytes.length || bytes.length > MAX_SOURCE) return fail();
  let width = 0,
    height = 0;
  let mime: 'image/png' | 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = 'image/png';
    if (
      bytes.length < 33 ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(8) !== 13
    )
      return fail();
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    let pos = 8,
      ended = false;
    while (pos + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(pos),
        type = bytes.toString('ascii', pos + 4, pos + 8);
      if (size > bytes.length - pos - 12 || type === 'acTL') return fail();
      pos += size + 12;
      if (type === 'IEND') {
        ended = true;
        break;
      }
    }
    if (!ended || pos !== bytes.length) return fail();
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = 'image/jpeg';
    let pos = 2;
    while (pos < bytes.length) {
      if (bytes[pos++] !== 0xff) return fail();
      while (bytes[pos] === 0xff) pos++;
      const marker = bytes[pos++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (pos + 2 > bytes.length) return fail();
      const size = bytes.readUInt16BE(pos);
      if (size < 2 || pos + size > bytes.length) return fail();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) return fail();
        height = bytes.readUInt16BE(pos + 3);
        width = bytes.readUInt16BE(pos + 5);
      } else if (marker >= 0xc3 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return fail();
      pos += size;
    }
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return fail();
  } else return fail();
  if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000)
    return fail();
  return { mime, width, height };
}
