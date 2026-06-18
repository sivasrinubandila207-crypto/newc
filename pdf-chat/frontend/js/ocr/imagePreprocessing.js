/**
 * @module imagePreprocessing
 * @description Canvas-based image preprocessing for OCR quality improvement.
 * Includes deskewing, grayscale conversion, contrast stretching, and binarization.
 */
import { diagnostic } from '../utils/logger.js';

/**
 * Analyses a canvas to detect the skew angle of text lines.
 * Uses projection profile variance maximisation over ±5 degrees.
 * @param {HTMLCanvasElement} canvas
 * @returns {number} Best skew angle in degrees
 */
export function detectSkewAngle(canvas) {
  const w = canvas.width, h = canvas.height;
  const sampleW = 300;
  const sampleH = Math.round(h * (sampleW / w));
  const tmp = document.createElement('canvas');
  tmp.width = sampleW; tmp.height = sampleH;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.drawImage(canvas, 0, 0, w, h, 0, 0, sampleW, sampleH);

  const imgData = tmpCtx.getImageData(0, 0, sampleW, sampleH).data;
  const binary = new Uint8Array(sampleW * sampleH);
  for (let i = 0; i < imgData.length; i += 4) {
    const gray = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
    binary[i / 4] = gray < 180 ? 0 : 1;
  }

  const cx = sampleW / 2, cy = sampleH / 2;
  let bestAngle = 0, maxVariance = -1;

  for (let angle = -5; angle <= 5; angle += 0.5) {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rowSums = new Int32Array(sampleH);

    for (let y = 0; y < sampleH; y += 2) {
      for (let x = 0; x < sampleW; x += 2) {
        if (binary[y * sampleW + x] === 0) {
          const rotY = Math.round((x - cx) * sin + (y - cy) * cos + cy);
          if (rotY >= 0 && rotY < sampleH) rowSums[rotY]++;
        }
      }
    }

    let sum = 0, sumSq = 0;
    for (let i = 0; i < sampleH; i++) { sum += rowSums[i]; sumSq += rowSums[i] * rowSums[i]; }
    const mean = sum / sampleH;
    const variance = (sumSq / sampleH) - (mean * mean);
    if (variance > maxVariance) { maxVariance = variance; bestAngle = angle; }
  }

  diagnostic(`Deskew detected skew angle: ${bestAngle}°`);
  return bestAngle;
}

/**
 * Rotates a canvas by the given angle, returning a new canvas.
 * Fills the background with white.
 * @param {HTMLCanvasElement} canvas
 * @param {number} angle - Degrees
 * @returns {HTMLCanvasElement}
 */
export function rotateCanvas(canvas, angle) {
  const rad = (angle * Math.PI) / 180;
  const w = canvas.width, h = canvas.height;
  const absCos = Math.abs(Math.cos(rad)), absSin = Math.abs(Math.sin(rad));
  const newW = Math.round(w * absCos + h * absSin);
  const newH = Math.round(w * absSin + h * absCos);

  const rot = document.createElement('canvas');
  rot.width = newW; rot.height = newH;
  const ctx = rot.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, newW, newH);
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return rot;
}

/**
 * Preprocesses a canvas for OCR: deskew → grayscale → contrast stretch → binarize.
 * @param {HTMLCanvasElement} canvas
 * @param {'binarize'|'grayscale'|'none'} mode
 * @returns {HTMLCanvasElement} The processed canvas (may be a new object if deskewed)
 */
export function preprocessCanvas(canvas, mode) {
  if (mode === 'none') return canvas;

  const angle = detectSkewAngle(canvas);
  let processed = canvas;
  if (Math.abs(angle) > 0.5) {
    processed = rotateCanvas(canvas, angle);
    diagnostic(`Preprocessing: rotated ${angle}° to deskew`);
  }

  const ctx = processed.getContext('2d');
  const imgData = ctx.getImageData(0, 0, processed.width, processed.height);
  const data = imgData.data;

  // Grayscale + contrast stretching
  let min = 255, max = 0;
  const grays = new Uint8Array(data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grays[i / 4] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  const range = max - min;
  const contrastFactor = 1.5;

  for (let i = 0; i < data.length; i += 4) {
    let gray = grays[i / 4];
    if (range > 0) gray = ((gray - min) / range) * 255;
    gray = Math.min(255, Math.max(0, (gray - 128) * contrastFactor + 128));

    if (mode === 'binarize') {
      const bin = gray < 180 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = bin;
    } else {
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  diagnostic(`Preprocessing (${mode}) done. Deskew: ${angle}°, Range: ${min}–${max}`);
  return processed;
}
