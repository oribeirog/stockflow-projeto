"""Independent Pillow reader for the real Electron-normalized synthetic corpus."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

root = Path(sys.argv[1])
cases = json.loads((root / (sys.argv[2] if len(sys.argv)>2 else 'cases.json')).read_text(encoding='utf8'))
for case in cases:
    path = root / ('normalized-' + Path(case['name']).name)
    with Image.open(path) as check:
        check.verify()
    with Image.open(path) as image:
        image.load()
        assert image.format in ['PNG', 'JPEG']
        assert max(image.size) <= 2048
        assert not image.getexif(), str(path)
        if len(sys.argv)>2 and sys.argv[2]=='internet-cases.json':
            with Image.open(root / case['name']) as original:
                expected=ImageOps.exif_transpose(original).convert('RGBA').resize(image.size)
                actual=image.convert('RGBA')
                a=actual.get_flattened_data() if hasattr(actual,'get_flattened_data') else actual.getdata()
                b=expected.get_flattened_data() if hasattr(expected,'get_flattened_data') else expected.getdata()
                error=sum(abs(x-y) for p,q in zip(a,b) for x,y in zip(p,q))/(image.width*image.height*4)
                assert error<5,(case['name'],error)
        if case.get('reference'):
            with Image.open(root / case['reference']) as reference:
                assert image.size == reference.size
                actual, expected = image.convert('RGBA'), reference.convert('RGBA')
                actual_pixels = actual.get_flattened_data() if hasattr(actual, 'get_flattened_data') else actual.getdata()
                expected_pixels = expected.get_flattened_data() if hasattr(expected, 'get_flattened_data') else expected.getdata()
                error = sum(abs(a-b) for p, q in zip(actual_pixels, expected_pixels)
                            for a, b in zip(p, q)) / (actual.width * actual.height * 4)
                assert error < 5, (case['name'], error)
        if case['name'] == 'pequena.png':
            assert image.size == (1, 2)
            pixel = image.convert('RGBA').getpixel((0, 0))
            assert pixel[3] == 100 and abs(pixel[0]-240) <= 1
        if case['name'] == '16bits.png':
            assert image.convert('RGB').getpixel((0, 0)) == (125, 125, 125)
        if case['name'] == 'rgba-detalhada.png':
            assert image.convert('RGBA').getextrema()[3][0] < 255
print('FOTOS_INDEPENDENT_READER_OK', len(cases))
