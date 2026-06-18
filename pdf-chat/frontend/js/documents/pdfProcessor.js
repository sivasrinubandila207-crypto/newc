/**
 * @module pdfProcessor
 * @description Orchestrates PDF text extraction and OCR.
 *
 * Processing flow:
 *   Pass 1: Extract native text from every page.
 *     → Pages with charCount >= 1200 → skip OCR (text PDF)
 *     → Pages with charCount < 1200  → mark for OCR (scanned/image page)
 *
 *   Pass 2: Run OCR only on pages that need it.
 *     → Vision OCR for single-page PDFs (when enabled)
 *     → Tesseract for multi-page or when Vision OCR is not selected
 *
 * Processing statistics are displayed after completion.
 */
import { OCR_LOW_DENSITY_THRESHOLD } from '../utils/constants.js';
import { diagnostic } from '../utils/logger.js';
import { runTesseractOcr } from '../ocr/ocr.js';
import { runVisionOcr } from '../ocr/visionOCR.js';
import { preprocessCanvas } from '../ocr/imagePreprocessing.js';

/**
 * Extracts native text from a PDF page using coordinate-aware row detection.
 * Returns an empty string if the page has no selectable text.
 * @param {import('pdfjs-dist').PDFPageProxy} pg
 * @returns {Promise<string>}
 */
async function extractNativePageText(pg) {
  const ct = await pg.getTextContent();
  const allItems = ct.items.filter(item => item.str && item.str.trim().length > 0);
  if (!allItems.length) return '';

  const rowTolerance = 5;
  const rows = [];
  for (const item of allItems) {
    const y = item.transform[5], x = item.transform[4];
    let row = rows.find(r => Math.abs(r.y - y) <= rowTolerance);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, str: item.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(row => {
    row.items.sort((a, b) => a.x - b.x);
    return row.items.map(it => it.str).join('  ');
  }).join('\n');
}

/**
 * Processes a PDF file:
 * - Extracts native text from all pages
 * - Identifies pages needing OCR (low-density or force-OCR enabled)
 * - Runs OCR only on pages that need it
 * - Returns processing statistics
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {HTMLElement} statusEl - Status display element
 * @param {string} fileName - Document name (for display)
 * @returns {Promise<{
 *   pages: string[],
 *   needsOCR: boolean,
 *   nativePagesBackup: Object,
 *   pageConfidences: Object,
 *   stats: { method: string, processingTimeMs: number, pageCount: number }
 * }>}
 */
export async function processPdf(pdf, statusEl, fileName) {
  const startTime = Date.now();
  const pages = new Array(pdf.numPages).fill('');
  const nativePagesBackup = {};
  const pageConfidences = {};
  const ocrPageIndices = [];
  let needsOCR = false;

  const forceOcr = document.getElementById('force-ocr-checkbox')?.checked || false;

  // ── PASS 1: Extract native text ──
  statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">📖 Extracting text… (${pdf.numPages} pages)</div>`;

  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const pageText = await extractNativePageText(pg);
    const charCount = pageText.length;
    const isLowDensity = charCount < OCR_LOW_DENSITY_THRESHOLD;

    if (forceOcr || !pageText || isLowDensity) {
      needsOCR = true;
      ocrPageIndices.push(i - 1);
      if (pageText) nativePagesBackup[i - 1] = pageText;
      diagnostic(`Page ${i} → OCR (forceOcr=${forceOcr}, chars=${charCount}, lowDensity=${isLowDensity})`);
    } else {
      pages[i - 1] = pageText;
      pageConfidences[i - 1] = 100;
      diagnostic(`Page ${i} → native text (${charCount} chars)`);
    }
  }

  let extractionMethod = 'Direct Text Extraction';

  // ── PASS 2: OCR (only pages that need it) ──
  if (needsOCR && ocrPageIndices.length > 0) {
    const visionOcrEnabled = document.getElementById('vision-ocr-checkbox')?.checked || false;

    if (visionOcrEnabled) {
      // Vision OCR path (Gemini)
      extractionMethod = ocrPageIndices.length === pdf.numPages ? 'Vision OCR (Gemini)' : 'Mixed (Text + Vision OCR)';
      statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">👁 Initialising Vision OCR (Gemini)…</div>`;
      
      const scaleVal = parseFloat(document.getElementById('ocr-scale-select')?.value || '3.0');
      const preprocessMode = document.getElementById('ocr-preprocess-select')?.value || 'binarize';
      
      for (let idx = 0; idx < ocrPageIndices.length; idx++) {
        const pageIdx = ocrPageIndices[idx];
        statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">👁 Performing Vision OCR: page ${idx + 1}/${ocrPageIndices.length}…</div>`;
        
        const pg = await pdf.getPage(pageIdx + 1);
        const vp = pg.getViewport({ scale: scaleVal });
        let canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        canvas = preprocessCanvas(canvas, preprocessMode);
        
        try {
          const text = await runVisionOcr(canvas.toDataURL('image/png').split(',')[1]);
          pages[pageIdx] = text;
          pageConfidences[pageIdx] = 100;
          diagnostic(`Vision OCR done for page ${pageIdx + 1}: ${text.length} chars`);
        } catch (e) {
          pages[pageIdx] = nativePagesBackup[pageIdx] || `[OCR error p.${pageIdx + 1}: ${e.message}]`;
          pageConfidences[pageIdx] = 0;
          throw e;
        }
      }
    } else {
      // Tesseract path
      extractionMethod = ocrPageIndices.length === pdf.numPages ? 'Tesseract OCR' : 'Mixed (Text + Tesseract OCR)';
      await runTesseractOcr(ocrPageIndices, pdf, statusEl, nativePagesBackup, pageConfidences, pages);
    }

    // Throw if any page has an OCR error placeholder
    const errPage = pages.find(p => p?.startsWith('[OCR error'));
    if (errPage) throw new Error(errPage);
  }

  const processingTimeMs = Date.now() - startTime;

  // ── Processing stats display ──
  const textPages = pdf.numPages - ocrPageIndices.length;
  const ocrPages = ocrPageIndices.length;
  statusEl.innerHTML = `
    <div style="font-size:11px;color:var(--accent2);line-height:1.8">
      ✅ <strong>${fileName}</strong><br>
      📋 Method: <strong>${extractionMethod}</strong><br>
      ⏱ Time: <strong>${(processingTimeMs / 1000).toFixed(1)}s</strong> &nbsp;
      📄 Pages: <strong>${pdf.numPages}</strong>
      ${ocrPages > 0 ? `(${textPages} text + ${ocrPages} OCR)` : ''}
    </div>`;

  return { pages, needsOCR, nativePagesBackup, pageConfidences, stats: { method: extractionMethod, processingTimeMs, pageCount: pdf.numPages } };
}
