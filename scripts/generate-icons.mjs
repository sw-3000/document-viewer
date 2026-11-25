import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, '..', 'src-tauri', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// CRC32 implementation for valid PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function blendPixel(buf, idx, r, g, b, a) {
  const srcA = clamp(a, 0, 1);
  if (srcA <= 0) return;
  const dstR = buf[idx];
  const dstG = buf[idx + 1];
  const dstB = buf[idx + 2];
  const dstA = buf[idx + 3] / 255;

  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;

  buf[idx] = Math.round((r * srcA + dstR * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((g * srcA + dstG * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((b * srcA + dstB * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function renderIconRgba(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.35 / size;

  for (let y = 0; y < size; y++) {
    const ny = (y + 0.5) / size - 0.5;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size - 0.5;
      const idx = (y * size + x) * 4;

      // Windows 11 style rounded squircle container
      const bgDist = sdRoundedBox(nx, ny, 0.44, 0.44, 0.11);
      const bgAlpha = 1 - smoothstep(-aa, aa, bgDist);
      if (bgAlpha > 0) {
        const grad = clamp((ny + 0.44) / 0.88 * 0.65 + (nx + 0.44) / 0.88 * 0.35, 0, 1);
        const r = 37 + grad * (29 - 37);
        const g = 99 + grad * (78 - 99);
        const b = 235 + grad * (216 - 235);
        blendPixel(rgba, idx, r, g, b, bgAlpha);
      }

      // Subtle drop shadow under the document sheet
      const shDist = sdRoundedBox(nx, ny - 0.015, 0.25, 0.31, 0.035);
      const shAlpha = (1 - smoothstep(-aa * 3, aa * 3, shDist)) * 0.24;
      if (shAlpha > 0 && bgAlpha > 0) {
        blendPixel(rgba, idx, 10, 20, 50, shAlpha * bgAlpha);
      }

      // Crisp document sheet with folded top-right corner
      const docDist = sdRoundedBox(nx, ny, 0.24, 0.30, 0.03);
      const cutDiag = nx + ny - (0.24 - 0.30 + 0.045); // top-right corner diagonal cut
      const sheetDist = Math.max(docDist, cutDiag > 0.11 ? cutDiag - 0.11 : -1);
      // Use clean geometric cut: x > 0.11 && y < -0.17
      const cornerFold = nx - ny > 0.28 ? (nx - ny - 0.28) * 0.7071 : -1;
      const finalSheetDist = Math.max(docDist, cornerFold);
      const sheetAlpha = 1 - smoothstep(-aa, aa, finalSheetDist);

      if (sheetAlpha > 0) {
        const paperGrad = clamp((ny + 0.30) / 0.60, 0, 1);
        const pr = 255 - paperGrad * 8;
        const pg = 255 - paperGrad * 7;
        const pb = 255 - paperGrad * 4;
        blendPixel(rgba, idx, pr, pg, pb, sheetAlpha);
      }

      // Folded corner triangle
      if (nx >= 0.105 && nx <= 0.245 && ny >= -0.305 && ny <= -0.165) {
        const foldInner = Math.max(nx - 0.24, -0.30 - ny, -(nx - ny - 0.28) * 0.7071);
        // Triangle bounded by x <= 0.24, y >= -0.30, and x - y <= 0.28? Wait: the flap sits at x >= 0.11, y <= -0.17
        const flap = Math.max(0.11 - nx, ny + 0.17, (nx - ny - 0.28) * 0.7071);
        const flapAlpha = 1 - smoothstep(-aa, aa, flap);
        if (flapAlpha > 0) {
          blendPixel(rgba, idx, 203, 213, 225, flapAlpha);
        }
      }

      // Clean reading lines inside document
      const lineDefs = [
        { cx: -0.055, cy: -0.08, w: 0.105, h: 0.022, accent: true },
        { cx: 0.0, cy: 0.005, w: 0.16, h: 0.018, accent: false },
        { cx: 0.0, cy: 0.075, w: 0.16, h: 0.018, accent: false },
        { cx: -0.035, cy: 0.145, w: 0.125, h: 0.018, accent: false },
      ];
      for (const l of lineDefs) {
        const ld = sdRoundedBox(nx - l.cx, ny - l.cy, l.w, l.h, l.h * 0.9);
        const la = 1 - smoothstep(-aa, aa, ld);
        if (la > 0) {
          if (l.accent) {
            blendPixel(rgba, idx, 37, 99, 235, la * 0.9);
          } else {
            blendPixel(rgba, idx, 148, 163, 184, la * 0.75);
          }
        }
      }
    }
  }
  return rgba;
}

function encodeIco(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;
  for (const { size, png } of pngEntries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.png)]);
}

const sizes = [16, 32, 48, 128, 256];
const pngBySize = new Map();
for (const size of sizes) {
  pngBySize.set(size, encodePng(size, size, renderIconRgba(size)));
}

fs.writeFileSync(path.join(iconsDir, '32x32.png'), pngBySize.get(32));
fs.writeFileSync(path.join(iconsDir, '128x128.png'), pngBySize.get(128));
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), pngBySize.get(256));
fs.writeFileSync(path.join(iconsDir, 'icon.png'), pngBySize.get(256));

const icoBuffer = encodeIco([
  { size: 16, png: pngBySize.get(16) },
  { size: 32, png: pngBySize.get(32) },
  { size: 48, png: pngBySize.get(48) },
  { size: 256, png: pngBySize.get(256) },
]);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);

console.log('[generate-icons] Generated Windows icons in src-tauri/icons/.');
