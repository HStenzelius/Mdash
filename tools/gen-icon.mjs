/* Ritar appikonen: ett gråblått, rundat glasfält med ett M.
 *
 * Vi skriver PNG:en för hand med Nodes inbyggda zlib istället för att dra in
 * ett bildbibliotek -- ikonen ändras nästan aldrig och behöver inga beroenden.
 * Kör: node tools/gen-icon.mjs && npx tauri icon icons/source.png
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const SIZE = 1024;
const RADIUS = 224;

/** Avstånd från punkt till linjesegment -- används för att rita M:ets streck. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Avstånd till kanten av en rundad kvadrat. Negativt = innanför. */
function roundedRect(px, py, size, radius) {
  const qx = Math.abs(px - size / 2) - (size / 2 - radius);
  const qy = Math.abs(py - size / 2) - (size / 2 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Mjuk övergång över en pixel, så kanterna inte blir taggiga. */
function coverage(distance) {
  return Math.max(0, Math.min(1, 0.5 - distance));
}

function mix(a, b, t) {
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
}

const TOP = [58, 74, 96];
const BOTTOM = [30, 41, 55];
const STROKE = [206, 224, 242];

// M:et som fyra streck, tecknade i en kvadrat från 300 till 724.
const STROKES = [
  [318, 700, 318, 324],
  [318, 324, 512, 560],
  [512, 560, 706, 324],
  [706, 324, 706, 700],
];
const THICKNESS = 46;

const pixels = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5;
    const py = y + 0.5;

    const plateAlpha = coverage(roundedRect(px, py, SIZE, RADIUS));
    let color = mix(TOP, BOTTOM, py / SIZE);

    let inkAlpha = 0;
    for (const [ax, ay, bx, by] of STROKES) {
      inkAlpha = Math.max(inkAlpha, coverage(distToSegment(px, py, ax, ay, bx, by) - THICKNESS / 2));
    }
    if (inkAlpha > 0) color = mix(color, STROKE, inkAlpha);

    const at = (y * SIZE + x) * 4;
    pixels[at] = color[0];
    pixels[at + 1] = color[1];
    pixels[at + 2] = color[2];
    pixels[at + 3] = Math.round(plateAlpha * 255);
  }
}

// ---- PNG-inpackning -------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bitdjup
ihdr[9] = 6; // RGBA
// resten (komprimering, filter, interlace) är noll = standard

// Varje rad föregås av en filterbyte; 0 betyder "ingen filtrering".
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("icons", { recursive: true });
writeFileSync("icons/source.png", png);
console.log(`icons/source.png skriven (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} kB)`);
