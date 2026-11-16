"""Owned synthetic photographs, no private/product images. Test tooling only.
Requires Pillow; output is confined by the Node harness to .cache/pre52b-fotos.
"""
import json
import struct
import sys
import zlib
import random
from pathlib import Path
from PIL import Image, ImageCms, ImageOps

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
im = Image.new('RGB', (120, 80))
for x in range(120):
    for y in range(80):
        im.putpixel((x, y), ((240, 20, 20) if x < 60 else (20, 20, 240))
                    if y < 40 else ((20, 220, 20) if x < 60 else (240, 220, 20)))
cases = []


def save(name, image, **kwargs):
    image.save(root / name, **kwargs)
    cases.append({'name': name, 'width': image.width, 'height': image.height})


save('JPEG comum.jpg', im, quality=95)
save('progressivo.JPEG', im, quality=95, progressive=True)
save('cmyk.jpeg', im.convert('CMYK'), quality=95)
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
save('perfil-icc.JPG', im, quality=95, icc_profile=icc)
for orientation in range(1, 9):
    exif = Image.Exif()
    exif[274] = orientation
    exif[34853] = {1: 'N', 2: (1, 2, 3)}  # Must disappear from normalized output.
    name = f'orientacao-{orientation}.JPG'
    im.save(root / name, quality=95, exif=exif)
    expected = ImageOps.exif_transpose(Image.open(root / name))
    expected.save(root / f'expected-{orientation}.png')
    cases.append({'name': name, 'width': expected.width, 'height': expected.height,
                  'reference': f'expected-{orientation}.png'})
save('rgb.PNG', im, icc_profile=icc)
save('rgba.png', im.convert('RGBA'))
png_exif = Image.Exif()
png_exif[274] = 6
im.save(root / 'png-exif.png', exif=png_exif)
ImageOps.exif_transpose(Image.open(root / 'png-exif.png')).save(root / 'expected-png-exif.png')
cases.append({'name': 'png-exif.png', 'width': 80, 'height': 120,
              'reference': 'expected-png-exif.png'})
alpha = im.convert('RGBA')
alpha.putpixel((0, 0), (0, 0, 0, 0))
save('transparência com espaço.png', alpha)
save('paleta.png', im.quantize(16))
save('16bits.png', Image.new('I;16', (120, 80), 32000))
save('pequena.png', Image.new('RGBA', (1, 2), (240, 20, 30, 100)))

# True Adam7 PNG (Pillow's interlace option does not encode Adam7).
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


raw = bytearray()
for x0, y0, dx, dy in [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8),
                       (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]:
    for y in range(y0, 80, dy):
        raw.append(0)
        for x in range(x0, 120, dx):
            raw.extend(im.getpixel((x, y)))
(root / 'adam7.png').write_bytes(b'\x89PNG\r\n\x1a\n' +
    chunk(b'IHDR', struct.pack('>IIBBBBB', 120, 80, 8, 2, 0, 0, 1)) +
    chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
cases.append({'name': 'adam7.png', 'width': 120, 'height': 80})

save('24mp.jpg', Image.new('RGB', (6000, 4000), (20, 180, 40)), quality=95)
noise = Image.effect_noise((4096, 3072), 75).convert('RGB')
save('grande-detalhada.jpg', noise, quality=85)
save('png-grande.png', noise.resize((2000, 1500)))
rgb_noise=Image.frombytes('RGB',(1800,1700),random.Random(73).randbytes(1800*1700*3))
rgb_noise.save(root / 'png-ruido-rgb.png')
cases.append({'name':'png-ruido-rgb.png','width':1620,'height':1530})
rgba_noise = Image.frombytes('RGBA', (1800, 1200), random.Random(74).randbytes(1800 * 1200 * 4))
rgba_noise.save(root / 'rgba-detalhada.png')
cases.append({'name': 'rgba-detalhada.png', 'width': 1620, 'height': 1080})
long = root / ('pasta com acentuação ' + 'x' * 70) / ('subpasta ' + 'y' * 70)
long.mkdir(parents=True, exist_ok=True)
im.save(long / 'fotografia acentuada.PNG')
cases.append({'name': str((long / 'fotografia acentuada.PNG').relative_to(root)),
              'width': 120, 'height': 80})
(root / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False), encoding='utf8')
print(json.dumps({'cases': len(cases), 'root': str(root)}))
