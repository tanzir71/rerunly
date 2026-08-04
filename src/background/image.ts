import type { RedactionRect } from '../shared/types';

export interface ProcessedScreenshot {
  dataUrl: string;
  hash: string;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
  redactions: RedactionRect[];
}

export interface VisualDiff {
  changedRatio: number;
  changedRegion: { x: number; y: number; width: number; height: number } | null;
  meaningfullyChanged: boolean;
}

export function comparePixelData(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number
): VisualDiff {
  if (before.length !== after.length || before.length !== width * height * 4) {
    throw new Error('Visual comparison buffers must have matching RGBA dimensions.');
  }
  let changed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const delta =
      Math.abs((before[index] ?? 0) - (after[index] ?? 0)) +
      Math.abs((before[index + 1] ?? 0) - (after[index + 1] ?? 0)) +
      Math.abs((before[index + 2] ?? 0) - (after[index + 2] ?? 0));
    if (delta < 36) continue;
    changed += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const changedRatio = changed / (width * height);
  return {
    changedRatio,
    changedRegion:
      changed === 0
        ? null
        : {
            x: minX / width,
            y: minY / height,
            width: (maxX - minX + 1) / width,
            height: (maxY - minY + 1) / height
          },
    meaningfullyChanged: changedRatio >= 0.003
  };
}

function decodeDataUrl(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Invalid screenshot data URL.');
  const mimeType = match[1] ?? 'image/png';
  const bytes = Uint8Array.from(atob(match[2] ?? ''), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function hashPixels(data: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  const stride = Math.max(4, Math.floor(data.length / 4096 / 4) * 4);
  for (let index = 0; index < data.length; index += stride) {
    hash ^= data[index] ?? 0;
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[index + 1] ?? 0;
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[index + 2] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeRedactionRects(
  rectangles: RedactionRect[],
  viewportWidth: number,
  viewportHeight: number
): RedactionRect[] {
  return rectangles
    .map((rectangle) => ({
      ...rectangle,
      x: Math.max(0, rectangle.x - 3),
      y: Math.max(0, rectangle.y - 3),
      width: Math.min(viewportWidth, rectangle.width + 6),
      height: Math.min(viewportHeight, rectangle.height + 6)
    }))
    .filter(
      (rectangle) =>
        rectangle.width > 0 &&
        rectangle.height > 0 &&
        rectangle.x < viewportWidth &&
        rectangle.y < viewportHeight
    );
}

export async function processScreenshot(
  rawDataUrl: string,
  rectangles: RedactionRect[],
  viewport: { width: number; height: number },
  maxEdge = 1600
): Promise<ProcessedScreenshot> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('This Chrome version does not provide OffscreenCanvas for safe screenshot processing.');
  }
  const bitmap = await createImageBitmap(decodeDataUrl(rawDataUrl));
  try {
    const outputScale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * outputScale));
    const height = Math.max(1, Math.round(bitmap.height * outputScale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not initialize screenshot processing.');
    context.drawImage(bitmap, 0, 0, width, height);

    const normalized = normalizeRedactionRects(rectangles, viewport.width, viewport.height);
    const xScale = width / Math.max(1, viewport.width);
    const yScale = height / Math.max(1, viewport.height);
    context.fillStyle = '#05070d';
    for (const rectangle of normalized) {
      context.fillRect(
        Math.floor(rectangle.x * xScale),
        Math.floor(rectangle.y * yScale),
        Math.ceil(rectangle.width * xScale),
        Math.ceil(rectangle.height * yScale)
      );
    }

    const hash = hashPixels(context.getImageData(0, 0, width, height).data);
    let blob = await canvas.convertToBlob({ type: 'image/png' });
    let mimeType: ProcessedScreenshot['mimeType'] = 'image/png';
    if (blob.size > 2_000_000) {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      mimeType = 'image/jpeg';
    }
    return {
      dataUrl: await blobToDataUrl(blob),
      hash,
      width,
      height,
      mimeType,
      redactions: normalized
    };
  } finally {
    bitmap.close();
  }
}

async function thumbnailPixels(dataUrl: string): Promise<ImageData> {
  const bitmap = await createImageBitmap(decodeDataUrl(dataUrl));
  try {
    const canvas = new OffscreenCanvas(64, 64);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not compare screenshots.');
    context.drawImage(bitmap, 0, 0, 64, 64);
    return context.getImageData(0, 0, 64, 64);
  } finally {
    bitmap.close();
  }
}

export async function compareScreenshots(before: string, after: string): Promise<VisualDiff> {
  const [a, b] = await Promise.all([thumbnailPixels(before), thumbnailPixels(after)]);
  return comparePixelData(a.data, b.data, 64, 64);
}
