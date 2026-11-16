// Generates the extension's PNG icons without any image dependency.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

function icon(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // rounded-square mask
      const dx = Math.max(r - x - 0.5, x + 0.5 - (size - r), 0);
      const dy = Math.max(r - y - 0.5, y + 0.5 - (size - r), 0);
      const inside = dx * dx + dy * dy <= r * r;
      // three "text lines"; the middle one is highlighted
      const u = x / size, v = y / size;
      const line = (top) => v >= top && v < top + 0.12 && u >= 0.2 && u < 0.8;
      let c = [31, 41, 55, 255];
      if (v >= 0.4 && v < 0.6 && u >= 0.14 && u < 0.86) c = [253, 224, 71, 255];
      if (line(0.2) || line(0.68)) c = [156, 163, 175, 255];
      if (line(0.44)) c = [31, 41, 55, 255];
      if (!inside) c = [0, 0, 0, 0];
      px.set(c, i);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(px)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`public/icons/icon${s}.png`, icon(s));
console.log("icons written");
