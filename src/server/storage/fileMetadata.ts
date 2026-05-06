export interface ImageDimensions {
  width: number | null;
  height: number | null;
}

export function detectImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions {
  if (mimeType === "image/png") return detectPngDimensions(buffer);
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return detectJpegDimensions(buffer);
  return { width: null, height: null };
}

function detectPngDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 24) return { width: null, height: null };
  if (buffer.toString("ascii", 1, 4) !== "PNG") return { width: null, height: null };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function detectJpegDimensions(buffer: Buffer): ImageDimensions {
  let offset = 2;
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return { width: null, height: null };

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return { width: null, height: null };
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }

  return { width: null, height: null };
}
