import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve('public/icon');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function insideRoundedSquare(x, y, size, radius) {
  const left = x < radius;
  const right = x >= size - radius;
  const top = y < radius;
  const bottom = y >= size - radius;
  if (!(left || right) || !(top || bottom)) return true;
  const centerX = left ? radius : size - radius - 1;
  const centerY = top ? radius : size - radius - 1;
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.23;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const inside = insideRoundedSquare(x, y, size, radius);
      rgba[index] = inside ? 41 : 0;
      rgba[index + 1] = inside ? 40 : 0;
      rgba[index + 2] = inside ? 37 : 0;
      rgba[index + 3] = inside ? 255 : 0;
      if (!inside) continue;

      const nx = x / size;
      const ny = y / size;
      const ringDistance = Math.abs(Math.hypot(nx - 0.53, ny - 0.52) - 0.27);
      if (ringDistance < 0.045 && !(nx < 0.31 && ny < 0.5)) {
        rgba[index] = 217; rgba[index + 1] = 119; rgba[index + 2] = 87;
      }
      const stem = distanceToSegment(nx, ny, 0.29, 0.27, 0.29, 0.72) < 0.045;
      const hook = distanceToSegment(nx, ny, 0.29, 0.28, 0.47, 0.43) < 0.045;
      if (stem || hook) {
        rgba[index] = 245; rgba[index + 1] = 237; rgba[index + 2] = 223;
      }
      const play = nx >= 0.45 && nx <= 0.66 && ny >= 0.4 && ny <= 0.64 && nx <= 0.45 + (0.64 - ny) * 1.65 && nx <= 0.45 + (ny - 0.4) * 1.65;
      if (play) {
        rgba[index] = 199; rgba[index + 1] = 201; rgba[index + 2] = 239;
      }
    }
  }

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const offset = y * (size * 4 + 1);
    raw[offset] = 0;
    rgba.copy(raw, offset + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

await mkdir(outputDirectory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(path.join(outputDirectory, `${size}.png`), render(size));
}
