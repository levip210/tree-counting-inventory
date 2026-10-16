#!/usr/bin/env python3
from pathlib import Path
import struct
import zlib

def png(size: int, path: Path) -> None:
    # Forest green square with a simple fir chevron drawn as raw RGBA.
    w = h = size
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            cx, cy = x / w, y / h
            # background
            r, g, b = 27, 58, 40
            # trunk
            if 0.45 < cx < 0.55 and cy > 0.72:
                r, g, b = 196, 163, 90
            # tree triangles
            elif cy > 0.12:
                width = (cy - 0.08) * 0.72
                if abs(cx - 0.5) < width * 0.55 and cy < 0.82:
                    r, g, b = 125, 206, 160
            row += bytes((r, g, b, 255))
        rows.append(b"\x00" + bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png_bytes = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png_bytes)

root = Path("/workspace/public/icons")
png(192, root / "icon-192.png")
png(512, root / "icon-512.png")
png(180, root / "apple-touch-icon.png")
print("icons written")
