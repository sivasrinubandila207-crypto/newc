/**
 * @module visionOCR
 * @description Calls the backend Vision OCR API (Gemini Vision) for single-page PDFs.
 */
import { apiFetch } from '../utils/api.js';
import { recordApiCall } from '../core/state.js';

/**
 * Sends a base64-encoded page image to the Vision OCR backend endpoint.
 * @param {string} base64Image - Base64-encoded PNG data (without data URL prefix)
 * @returns {Promise<string>} Extracted text
 */
export async function runVisionOcr(base64Image) {
  recordApiCall('ocr');
  const data = await apiFetch('/api/vision-ocr', {
    method: 'POST',
    body: JSON.stringify({ image: base64Image }),
  });
  return data.text;
}
