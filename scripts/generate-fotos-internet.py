"""Owned synthetic internet-format fixtures; Python is test tooling only."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageCms

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
im = Image.new('RGB', (120, 80), (240, 30, 40))
for x in range(60, 120):
    for y in range(80):
        im.putpixel((x, y), (30, 220, 40))
cases = []
def save(name, image, fmt, **options):
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    image.save(p, fmt, **options)
    cases.append({'name': name, 'width': image.width, 'height': image.height,
                  'alpha': image.mode == 'RGBA'})
save('produto lossy.webp', im, 'WEBP', quality=90)
save('produto lossless.webp', im, 'WEBP', lossless=True)
rgba = im.convert('RGBA')
rgba.putpixel((0, 0), (240, 30, 40, 0))
rgba.putpixel((1, 0), (240, 30, 40, 100))
save('pasta com acentos/fotografia çã.WEBP', rgba, 'WEBP', lossless=True)
save('transparente.webp', rgba, 'WEBP', lossless=True)
save('grande.webp', Image.new('RGB', (6000, 4000), (180, 30, 40)), 'WEBP', quality=90)
save('perfil-icc.webp', im, 'WEBP', icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
exif = Image.Exif()
exif[274] = 6
save('orientado.webp', im, 'WEBP', quality=95, exif=exif)
cases[-1].update(width=80, height=120)
save('produto.JFIF', im, 'JPEG', quality=95)
save('produto com acentuação.jfif', im, 'JPEG', quality=95, progressive=True)
save('orientado.JFIF', im, 'JPEG', quality=95, exif=exif)
cases[-1].update(width=80, height=120)
im.save(root / 'recusado.gif', 'GIF')
im.save(root / 'recusado.avif', 'AVIF')
im.save(root / 'animado.webp', 'WEBP', save_all=True, append_images=[Image.new('RGB', im.size, 'blue')], duration=100, loop=0)
Image.new('RGB', (8193, 1)).save(root / 'dimensoes.webp', 'WEBP')
(root / 'falso.webp').write_text('arquivo de texto', encoding='utf8')
(root / 'truncado.webp').write_bytes((root / 'produto lossy.webp').read_bytes()[:-5])
(root / 'internet-cases.json').write_text(json.dumps(cases, ensure_ascii=False), encoding='utf8')
print('INTERNET_FIXTURES', len(cases))
