#!/usr/bin/env node
/**
 * App icon codegen: `build/icon.png`, 1024x1024.
 *
 *   node scripts/build-icon.mjs
 *
 * electron-builder derives every platform variant (.icns, .ico, the AppImage
 * sizes) from this one PNG, so this is the only icon artwork in the repository.
 *
 * It is drawn here rather than committed as opaque binary art for the same
 * reason every other asset in EverRoad is procedural: the palette is the
 * loading screen's gradient from src/style.css, and if that gradient is ever
 * retuned this file is one edit and a rerun away from matching it again. The
 * subject matches the 🌄 favicon in index.html — a sunrise over hills, with the
 * road running into it.
 *
 * PNG encoding is done by hand against node:zlib so the build stays free of
 * image dependencies.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'build/icon.png';
const SIZE = 1024;
/** Supersampling factor — cheap antialiasing for the disc and the hills. */
const SS = 4;

/** The loading-screen gradient, src/style.css `#loading-screen`. */
const SKY = [
  { at: 0.0, rgb: [0x2b, 0x1e, 0x4e] },
  { at: 0.45, rgb: [0x7a, 0x3b, 0x6e] },
  { at: 0.8, rgb: [0xe8, 0x73, 0x5a] },
  { at: 1.0, rgb: [0xff, 0xb2, 0x6b] },
];
const SUN = [0xff, 0xe6, 0xb0];
const HILL_FAR = [0x4a, 0x2b, 0x5c];
const HILL_NEAR = [0x2f, 0x1c, 0x42];
const ROAD = [0xff, 0xf7, 0xec];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function skyAt(t) {
  for (let i = 1; i < SKY.length; i++) {
    if (t <= SKY[i].at || i === SKY.length - 1) {
      const a = SKY[i - 1];
      const b = SKY[i];
      const k = clamp01((t - a.at) / (b.at - a.at));
      return [
        lerp(a.rgb[0], b.rgb[0], k),
        lerp(a.rgb[1], b.rgb[1], k),
        lerp(a.rgb[2], b.rgb[2], k),
      ];
    }
  }
  return SKY[0].rgb;
}

/** Blend `src` over `dst` at coverage `a`, in place on `dst`. */
function over(dst, src, a) {
  dst[0] = lerp(dst[0], src[0], a);
  dst[1] = lerp(dst[1], src[1], a);
  dst[2] = lerp(dst[2], src[2], a);
}

/** Horizon line, in 0..1 of the image height. */
const HORIZON = 0.58;

/** Height of a hill ridge at normalised x, in 0..1 of image height. */
function ridge(x, phase, amp, base) {
  const w =
    Math.sin(x * Math.PI * 2.1 + phase) * 0.55 +
    Math.sin(x * Math.PI * 4.7 + phase * 1.9) * 0.3 +
    Math.sin(x * Math.PI * 1.3 + phase * 0.4) * 0.15;
  return base - w * amp;
}

/** Colour of one supersample, as [r,g,b] 0..255. */
function sample(x, y) {
  const px = x / SIZE;
  const py = y / SIZE;
  const c = skyAt(clamp01(py / HORIZON));

  // Sun disc, sitting just above the horizon slightly left of centre.
  const sx = 0.42;
  const sy = HORIZON - 0.1;
  const r = 0.155;
  const d = Math.hypot(px - sx, py - sy);
  if (d < r) over(c, SUN, 1);
  // Warm halo bleeding into the sky.
  else if (d < r * 1.9) over(c, SUN, Math.pow(1 - (d - r) / (r * 0.9), 2) * 0.35);

  // Far ridge, then near ridge, then flat ground.
  if (py > ridge(px, 0.6, 0.075, HORIZON)) over(c, HILL_FAR, 1);
  if (py > ridge(px, 2.7, 0.05, HORIZON + 0.055)) over(c, HILL_NEAR, 1);

  // The road: a ribbon widening out of the vanishing point at the horizon.
  const groundTop = HORIZON + 0.02;
  if (py > groundTop) {
    const t = (py - groundTop) / (1 - groundTop);
    const halfWidth = lerp(0.006, 0.15, t * t);
    const centre = lerp(sx, 0.5, t);
    if (Math.abs(px - centre) < halfWidth) over(c, ROAD, 0.92);
  }

  return c;
}

// Render supersampled, then box-downsample to SIZE.
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 3 + 1);
  raw[rowStart] = 0; // PNG filter type 0 (None)
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += c[0];
        g += c[1];
        b += c[2];
      }
    }
    const n = SS * SS;
    const o = rowStart + 1 + x * 3;
    raw[o] = Math.round(r / n);
    raw[o + 1] = Math.round(g / n);
    raw[o + 2] = Math.round(b / n);
  }
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour RGB
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`${OUT} written: ${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} kB.`);
