// Draws the app icon (the favicon's two book columns on a rounded square) and
// writes it as PNGs, a Windows .ico and a macOS .icns into assets/icon/.
// No image tools needed: the shapes are drawn with 4x4 supersampling and the
// PNGs encoded directly; .ico and .icns both hold PNG data.
//
//   bun run scripts/make-icons.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const OUT = join(import.meta.dir, "..", "assets", "icon");
const BG = [0x8a, 0x4b, 0x2e];
const FG = [0xf5, 0xf0, 0xe6];
const FG_ALPHA = 0.92;

// Geometry in the favicon's 32-unit box.
const inRoundedRect = (x: number, y: number) => {
  const r = 4;
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return x >= 0 && x <= 32 && y >= 0 && y <= 32 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
// An open book: two pages tilting up from the spine, with lines of text.
// Each page is a quadrilateral (corners in order); x mirrors for the right page.
const LEFT_PAGE: [number, number][] = [[5.5, 9], [15.4, 10.6], [15.4, 25], [5.5, 23.4]];
function inQuad(x: number, y: number, q: [number, number][]) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
  }
  return true;
}
const onPage = (x: number, y: number) => (x < 16 ? inQuad(x, y, LEFT_PAGE) : inQuad(32 - x, y, LEFT_PAGE));
// Text lines follow the page's tilt: on the left page y rises 1.6 over 9.9 units of x.
function onTextLine(x: number, y: number) {
  const px = x < 16 ? x : 32 - x;
  if (px < 7.3 || px > 13.9) return false;
  const tilt = ((px - 5.5) / 9.9) * 1.6;
  for (const base of [13, 15.6, 18.2, 20.8]) {
    const line = base + tilt;
    if (y >= line && y <= line + 0.9) return true;
  }
  return false;
}
const inBook = (x: number, y: number) => onPage(x, y) && !onTextLine(x, y);

function render(size: number): Buffer {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 32;
          const y = ((py + (sy + 0.5) / SS) / size) * 32;
          if (inRoundedRect(x, y)) {
            bg++;
            if (inBook(x, y)) fg++;
          }
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const f = (fg / n) * FG_ALPHA;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        // Book colour over the background, both inside the square's coverage.
        const mixed = a ? (BG[c] * (a - f) + FG[c] * f) / a : 0;
        rgba[i + c] = Math.round(mixed);
      }
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, rgba);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(pngs: Map<number, Buffer>): Buffer {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(sizes.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * sizes.length;
  for (const s of sizes) {
    const data = pngs.get(s)!;
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;
    e[1] = s === 256 ? 0 : s;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...sizes.map((s) => pngs.get(s)!)]);
}

function encodeIcns(pngs: Map<number, Buffer>): Buffer {
  // PNG-backed icon types.
  const types: [string, number][] = [
    ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024],
    ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512],
  ];
  const blocks = types.map(([type, s]) => {
    const data = pngs.get(s)!;
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(blocks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

mkdirSync(OUT, { recursive: true });
const pngs = new Map<number, Buffer>();
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) pngs.set(s, render(s));
for (const s of [32, 128, 256, 512]) writeFileSync(join(OUT, `icon-${s}.png`), pngs.get(s)!);
writeFileSync(join(OUT, "icon.ico"), encodeIco(pngs));
writeFileSync(join(OUT, "icon.icns"), encodeIcns(pngs));
console.log(`Wrote icons to ${OUT}`);
