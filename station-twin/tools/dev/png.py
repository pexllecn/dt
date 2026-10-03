"""Minimal PNG reader for sampling and cropping screenshots (no dependencies)."""
import struct, zlib, sys
def read(path):
    data = open(path, 'rb').read()
    pos = 8; chunks = []; w = h = 0; ct = 0
    while pos < len(data):
        n, t = struct.unpack('>I4s', data[pos:pos+8]); body = data[pos+8:pos+8+n]; pos += 12 + n
        if t == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', body[:10])
        if t == b'IDAT': chunks.append(body)
    raw = zlib.decompress(b''.join(chunks)); bpp = 4 if ct == 6 else 3; stride = w * bpp
    rows = []; prev = bytearray(stride); i = 0
    for y in range(h):
        f = raw[i]; line = bytearray(raw[i+1:i+1+stride]); i += 1 + stride
        for x in range(stride):
            a = line[x-bpp] if x >= bpp else 0; b = prev[x]; c = prev[x-bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, h, bpp, rows
if __name__ == '__main__':
    w, h, bpp, rows = read(sys.argv[1])
    x0, y0, x1, y1 = map(int, sys.argv[2:6])
    for y in range(y0, y1):
        print(y, ' '.join('%02x%02x%02x' % tuple(rows[y][x*bpp:x*bpp+3]) for x in range(x0, x1)))
