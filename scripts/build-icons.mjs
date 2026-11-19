import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, crc]);
}
function distance(x, y, ax, ay, bx, by) {
  const projection = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - projection * (bx - ax), y - ay - projection * (by - ay));
}
function icon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const x = (col + 0.5) * 512 / size;
    const y = (row + 0.5) * 512 / size;
    const mix = (x + y) / 1024;
    let rgb = [15 + mix * 5, 23 + mix * 60, 42 + mix * 3];
    const dx = Math.max(144 - x, 0, x - 368);
    const dy = Math.max(168 - y, 0, y - 344);
    if (Math.hypot(dx, dy) <= 24) rgb = [248, 250, 252];
    if (distance(x, y, 176, 208, 288, 208) <= 14 || distance(x, y, 176, 272, 336, 272) <= 14) rgb = [15, 23, 42];
    if (Math.hypot(x - 336, y - 208) <= 20) rgb = [22, 163, 74];
    if (distance(x, y, 324, 208, 332, 216) <= 5 || distance(x, y, 332, 216, 348, 196) <= 5) rgb = [248, 250, 252];
    const offset = row * (size * 4 + 1) + 1 + col * 4;
    pixels.set([...rgb.map(Math.round), 255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
for (const size of [180, 192, 512]) {
  writeFileSync(fileURLToPath(new URL(`../cbt-app/public/app-icon-${size}.png`, import.meta.url)), icon(size));
}
