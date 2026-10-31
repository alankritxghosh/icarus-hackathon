import sys
from pathlib import Path

filled = '--filled' in sys.argv
editable = '--editable' in sys.argv
path = Path('/tmp/icarus-editable-demo.pdf' if editable else '/tmp/icarus-qa-filled.pdf' if filled else '/tmp/icarus-qa-plan.pdf')
walls = b'''0 0 0 rg
100 120 170 6 re f
100 227 170 6 re f
100 120 6 113 re f
264 120 6 113 re f
182 126 6 29 re f
182 183 6 44 re f
''' if editable else b'''0 0 0 rg
100 120 400 8 re f
100 392 400 8 re f
100 120 8 280 re f
492 120 8 280 re f
296 120 8 280 re f
100 256 200 8 re f
''' if filled else b'''0.8 w
100 120 400 280 re S
300 120 m 300 400 l S
100 260 m 300 260 l S
'''
labels = b'''
BT /F1 11 Tf 122 174 Td (KITCHEN) Tj ET
BT /F1 11 Tf 213 174 Td (OFFICE) Tj ET
''' if editable else b'''
BT /F1 13 Tf 145 325 Td (OFFICE) Tj ET
BT /F1 13 Tf 145 195 Td (KITCHEN) Tj ET
BT /F1 13 Tf 355 260 Td (MEETING ROOM) Tj ET
'''
draw = walls + labels
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    b'<< /Length ' + str(len(draw)).encode() + b' >>\nstream\n' + draw + b'endstream',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
out = bytearray(b'%PDF-1.4\n')
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(out))
    out.extend(f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n')
xref = len(out)
out.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]:
    out.extend(f'{offset:010d} 00000 n \n'.encode())
out.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
path.write_bytes(out)
print(path, len(out), 'bytes')
