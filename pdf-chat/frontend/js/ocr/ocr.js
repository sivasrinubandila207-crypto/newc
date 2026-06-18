/**
 * @module ocr
 * @description Tesseract.js OCR runner with parallel workers for multi-page documents.
 * Skips OCR entirely for pages with sufficient native text (smart detection).
 */
import { OCR_CONCURRENCY } from '../utils/constants.js';
import { diagnostic, warn } from '../utils/logger.js';
import { preprocessCanvas } from './imagePreprocessing.js';

/**
 * Reads the current OCR render scale from the UI selector.
 * @returns {number}
 */
function getOcrScale() {
  return parseFloat(document.getElementById('ocr-scale-select')?.value || '3.0');
}

/**
 * Reads the current Tesseract PSM mode from the UI selector.
 * @returns {string}
 */
function getPsmMode() {
  return document.getElementById('ocr-psm-select')?.value || '11';
}

/**
 * Reads the current preprocess mode from the UI selector.
 * @returns {'binarize'|'grayscale'|'none'}
 */
function getPreprocessMode() {
  return document.getElementById('ocr-preprocess-select')?.value || 'binarize';
}

/**
 * Creates and configures a Tesseract worker with dictionary loading disabled for speed.
 * @param {string} [psm] - Optional pageseg_mode override
 * @returns {Promise<import('tesseract.js').Worker>}
 */
export async function createTesseractWorker(psm) {
  const mode = psm || getPsmMode();
  const worker = await Tesseract.createWorker('eng');
  await worker.setParameters({
    tessedit_pageseg_mode: mode,
    load_system_dawg: '0',
    load_freq_dawg: '0',
    load_punc_dawg: '0',
    load_number_dawg: '0',
    load_unambig_dawg: '0',
    load_bigram_dawg: '0',
    load_fixed_length_dawgs: '0',
  });
  return worker;
}

/**
 * Renders a PDF page to a canvas at the configured scale.
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {number} pageIdx - 0-based page index
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderPageCanvas(pdf, pageIdx) {
  const pg = await pdf.getPage(pageIdx + 1);
  const vp = pg.getViewport({ scale: getOcrScale() });
  let canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return preprocessCanvas(canvas, getPreprocessMode());
}

/**
 * Runs Tesseract OCR on all pages that need it, using a parallel worker scheduler.
 * Falls back to native text if OCR produces shorter output.
 *
 * @param {number[]} ocrPageIndices - 0-based page indices to OCR
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {HTMLElement} statusEl - Status display element
 * @param {Object} nativePagesBackup - Map of pageIdx → native text
 * @param {Object} pageConfidences - Map of pageIdx → confidence (mutated in place)
 * @param {string[]} pages - Output array (mutated in place)
 * @returns {Promise<void>}
 */
export async function runTesseractOcr(ocrPageIndices, pdf, statusEl, nativePagesBackup, pageConfidences, pages) {
  const concurrency = Math.min(OCR_CONCURRENCY, ocrPageIndices.length);

  statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">⚙️ Initialising Tesseract OCR…</div>`;

  const scheduler = Tesseract.createScheduler();
  await Promise.all(
    Array.from({ length: concurrency }).map(async () => {
      const worker = await createTesseractWorker();
      scheduler.addWorker(worker);
    })
  );

  let done = 0;

  async function ocrOnePage(pageIdx) {
    const canvas = await renderPageCanvas(pdf, pageIdx);
    try {
      const result = await scheduler.addJob('recognize', canvas);
      const text = result.data.text || '';
      const confidence = result.data.confidence || 0;
      pageConfidences[pageIdx] = confidence;

      const textLen = text.trim().length;
      const nativeLen = (nativePagesBackup[pageIdx] || '').length;

      if (nativeLen > textLen) {
        pages[pageIdx] = nativePagesBackup[pageIdx];
        diagnostic(`Page ${pageIdx + 1}: using native text (${nativeLen} chars > OCR ${textLen} chars)`);
      } else {
        pages[pageIdx] = textLen > 30 ? text : (nativePagesBackup[pageIdx] || '');
        diagnostic(`Page ${pageIdx + 1}: Tesseract OCR done — ${pages[pageIdx].length} chars, conf ${confidence}%`);
      }
    } catch (e) {
      pages[pageIdx] = nativePagesBackup[pageIdx] || `[OCR error p.${pageIdx + 1}: ${e.message}]`;
      pageConfidences[pageIdx] = 0;
      warn('OCR', `Page ${pageIdx + 1} OCR failed, using native fallback: ${e.message}`);
    }

    done++;
    statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">🔍 OCR Progress: ${done}/${ocrPageIndices.length} pages…</div>`;
  }

  await Promise.all(ocrPageIndices.map(idx => ocrOnePage(idx)));
  await scheduler.terminate();
}
