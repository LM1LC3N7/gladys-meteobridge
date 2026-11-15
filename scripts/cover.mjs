// Generates cover.png (800x534) for gladys-meteobridge: plain Node, no dependency.
// A weather station mast (anemometer cups, wind vane, rain gauge) on a meadow
// under a sun and a cloud, wired to a small gateway box and a screen of
// readings, on a gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
const skyAt = (x, y) => {
  const t = (x / W) * 0.7 + (y / H) * 0.3;
  return [70 + 60 * t, 140 + 50 * t, 220 - 20 * t];
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, skyAt(x, y));
  }
}
const white = [255, 255, 255];
const dark = [28, 38, 64];
const sun = [255, 200, 50];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

disc(400, 270, 260, white, 0.06);

// Sun and cloud.
disc(130, 110, 55, sun, 0.95);
for (const [x, y, r] of [
  [170, 95, 32],
  [210, 80, 42],
  [252, 95, 34],
  [212, 108, 30],
]) {
  disc(x, y, r, white, 0.95);
}
// A meadow.
for (let x = 0; x < W; x += 1) {
  const top = 420 + 10 * Math.sin((x / W) * Math.PI * 3);
  for (let y = Math.floor(top); y < H; y += 1) set(x, y, [90, 160, 80]);
}
// The mast, the anemometer (three cups) and the wind vane.
const steel = [235, 238, 245];
line(300, 190, 300, 440, 10, steel);
line(250, 200, 350, 200, 6, steel);
for (const angle of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
  const x = 250 + 34 * Math.cos(angle);
  const y = 190 + 12 * Math.sin(angle);
  line(250, 190, x, y, 4, steel);
  disc(x, y, 10, dark);
}
line(350, 200, 350, 180, 4, steel);
line(325, 180, 385, 180, 5, steel);
line(385, 180, 372, 170, 5, steel);
line(385, 180, 372, 190, 5, steel);
// The radiation shield (temperature, humidity) and the rain gauge.
for (let k = 0; k < 5; k += 1) box(270, 250 + k * 14, 330, 260 + k * 14, 4, white);
box(330, 330, 370, 380, 6, white);
disc(350, 330, 20, dark, 0.8);
// The gateway box, wired to the screen.
box(420, 380, 500, 420, 8, dark);
disc(440, 400, 5, [120, 230, 120]);
line(300, 420, 420, 400, 3, dark);
line(500, 400, 560, 330, 3, dark);
// The screen: a temperature curve and the rain bars.
box(480, 80, 750, 340, 18, white);
box(500, 100, 730, 320, 10, dark);
const temps = [8, 7, 7, 9, 12, 15, 17, 18, 18, 16, 13, 11, 10, 9];
const rain = [0, 0, 2, 5, 3, 0, 0, 0, 1, 4, 7, 3, 0, 0];
const xs = temps.map((_, i) => 520 + i * 15);
rain.forEach((r, i) => {
  if (r > 0)
    box(Math.round(xs[i] - 4), 305 - r * 10, Math.round(xs[i] + 5), 305, 2, [90, 170, 240]);
});
for (let i = 1; i < temps.length; i += 1) {
  line(xs[i - 1], 280 - temps[i - 1] * 9, xs[i], 280 - temps[i] * 9, 4, sun);
}
// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
