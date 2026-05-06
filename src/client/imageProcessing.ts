import type { ImageQualityReport } from "../shared/receiptTypes";

export interface Point {
  x: number;
  y: number;
}

export interface DetectionResult {
  corners: Point[];
  confidence: number;
  imageWidth: number;
  imageHeight: number;
  quality: ImageQualityReport;
}

export async function fileToObjectUrl(file: Blob): Promise<string> {
  return URL.createObjectURL(file);
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Kameru neizdevās nolasīt.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  return new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" });
}

export async function detectReceipt(file: Blob): Promise<DetectionResult> {
  const bitmap = await createImageBitmap(file);
  const maxSize = 900;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Attēlu neizdevās apstrādāt.");
  context.drawImage(bitmap, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const { bounds, edgeRatio } = detectDocumentBounds(imageData);
  const quality = analyzeQuality(imageData, bitmap.width, bitmap.height, edgeRatio);
  const padding = 10;
  const left = clamp(bounds.left - padding, 0, width - 1) / scale;
  const top = clamp(bounds.top - padding, 0, height - 1) / scale;
  const right = clamp(bounds.right + padding, 0, width - 1) / scale;
  const bottom = clamp(bounds.bottom + padding, 0, height - 1) / scale;
  const areaRatio = ((right - left) * (bottom - top)) / (bitmap.width * bitmap.height);
  const confidence = clamp01(edgeRatio * 3 + Math.min(areaRatio, 0.8) * 0.45);
  return {
    imageWidth: bitmap.width,
    imageHeight: bitmap.height,
    confidence,
    corners: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ],
    quality: {
      ...quality,
      edgeConfidence: confidence,
      cutOffSuspected: quality.cutOffSuspected || left <= 5 || top <= 5 || right >= bitmap.width - 5 || bottom >= bitmap.height - 5,
      warnings: [
        ...quality.warnings,
        ...(confidence < 0.45 ? ["Automātiskā malu noteikšana nav droša; pārbaudi stūrus manuāli."] : [])
      ]
    }
  };
}

export async function processReceiptImage(file: Blob, corners: Point[]): Promise<{ blob: Blob; dataUrl: string; quality: ImageQualityReport }> {
  const bitmap = await createImageBitmap(file);
  const [tl, tr, br, bl] = corners;
  const targetWidth = Math.min(1800, Math.max(distance(tl, tr), distance(bl, br)));
  const targetHeight = Math.min(2600, Math.max(distance(tl, bl), distance(tr, br)));
  const width = Math.max(500, Math.round(targetWidth));
  const height = Math.max(800, Math.round(targetHeight));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = bitmap.width;
  sourceCanvas.height = bitmap.height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const destCanvas = document.createElement("canvas");
  destCanvas.width = width;
  destCanvas.height = height;
  const destContext = destCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || !destContext) throw new Error("Attēlu neizdevās apstrādāt.");
  sourceContext.drawImage(bitmap, 0, 0);
  const source = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height);
  const dest = destContext.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      const top = lerpPoint(tl, tr, u);
      const bottom = lerpPoint(bl, br, u);
      const src = lerpPoint(top, bottom, v);
      sampleBilinear(source, src.x, src.y, dest, x, y);
    }
  }

  enhanceImageData(dest);
  destContext.putImageData(dest, 0, 0);
  const quality = analyzeQuality(dest, width, height, 1);
  const blob = await canvasToBlob(destCanvas, "image/png");
  return { blob, dataUrl: destCanvas.toDataURL("image/png"), quality };
}

export function pointToPercent(point: Point, width: number, height: number): Point {
  return { x: (point.x / width) * 100, y: (point.y / height) * 100 };
}

export function percentToPoint(point: Point, width: number, height: number): Point {
  return { x: (point.x / 100) * width, y: (point.y / 100) * height };
}

function detectDocumentBounds(imageData: ImageData) {
  const { data, width, height } = imageData;
  const luminance = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  };
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  let edgePixels = 0;
  const threshold = 28;

  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const gx = Math.abs(luminance(x + 1, y) - luminance(x - 1, y));
      const gy = Math.abs(luminance(x, y + 1) - luminance(x, y - 1));
      if (gx + gy > threshold) {
        edgePixels += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (edgePixels < 60) {
    return {
      bounds: { left: width * 0.08, top: height * 0.08, right: width * 0.92, bottom: height * 0.92 },
      edgeRatio: 0
    };
  }

  return {
    bounds: { left, top, right, bottom },
    edgeRatio: edgePixels / ((width * height) / 4)
  };
}

function analyzeQuality(imageData: ImageData, width: number, height: number, edgeRatio: number): ImageQualityReport {
  const { data } = imageData;
  let brightnessSum = 0;
  let over = 0;
  let dark = 0;
  const luminances: number[] = [];
  for (let i = 0; i < data.length; i += 16) {
    const y = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    luminances.push(y);
    brightnessSum += y;
    if (y > 245) over += 1;
    if (y < 35) dark += 1;
  }
  const brightness = brightnessSum / luminances.length;
  const overexposureRatio = over / luminances.length;
  const darknessRatio = dark / luminances.length;
  const blurScore = estimateBlur(imageData);
  const lowResolution = width < 900 || height < 1200;
  const tooDark = brightness < 72 || darknessRatio > 0.42;
  const overexposed = brightness > 236 || overexposureRatio > 0.5;
  const blurry = blurScore < 65;
  const cutOffSuspected = edgeRatio < 0.01;
  const warnings = [
    ...(lowResolution ? ["Attēla izšķirtspēja ir zema."] : []),
    ...(tooDark ? ["Attēls ir pārāk tumšs."] : []),
    ...(overexposed ? ["Attēlā ir pārgaismotas zonas."] : []),
    ...(blurry ? ["Attēls var būt izplūdis."] : []),
    ...(cutOffSuspected ? ["Čeka malas nav droši redzamas."] : [])
  ];

  return {
    blurScore,
    brightness,
    overexposureRatio,
    edgeConfidence: null,
    lowResolution,
    tooDark,
    overexposed,
    blurry,
    cutOffSuspected,
    warnings
  };
}

function estimateBlur(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const gray = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  };
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const step = Math.max(2, Math.round(Math.max(width, height) / 600));
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const laplacian = gray(x - 1, y) + gray(x + 1, y) + gray(x, y - 1) + gray(x, y + 1) - 4 * gray(x, y);
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function enhanceImageData(imageData: ImageData): void {
  const { data } = imageData;
  const contrast = 1.18;
  const brightness = 8;
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      data[i + channel] = clamp((data[i + channel] - 128) * contrast + 128 + brightness, 0, 255);
    }
  }
}

function sampleBilinear(source: ImageData, x: number, y: number, dest: ImageData, dx: number, dy: number): void {
  const x0 = clamp(Math.floor(x), 0, source.width - 1);
  const y0 = clamp(Math.floor(y), 0, source.height - 1);
  const x1 = clamp(x0 + 1, 0, source.width - 1);
  const y1 = clamp(y0 + 1, 0, source.height - 1);
  const wx = x - x0;
  const wy = y - y0;
  const destIndex = (dy * dest.width + dx) * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    const p00 = source.data[(y0 * source.width + x0) * 4 + channel];
    const p10 = source.data[(y0 * source.width + x1) * 4 + channel];
    const p01 = source.data[(y1 * source.width + x0) * 4 + channel];
    const p11 = source.data[(y1 * source.width + x1) * 4 + channel];
    dest.data[destIndex + channel] = p00 * (1 - wx) * (1 - wy) + p10 * wx * (1 - wy) + p01 * (1 - wx) * wy + p11 * wx * wy;
  }
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Attēlu neizdevās saglabāt."));
      else resolve(blob);
    }, mimeType, quality);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
