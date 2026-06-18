/**
 * @module tableOCR
 * @description Synchronisation helpers for OCR control checkboxes
 *              and the OCR benchmark runner.
 */
import { diagnostic } from '../utils/logger.js';
import { showToast } from '../ui/notifications.js';
import { docs } from '../core/state.js';
import { preprocessCanvas } from './imagePreprocessing.js';
import { createTesseractWorker } from './ocr.js';

/**
 * Synchronises the Force OCR checkbox between the Docs panel and Debug panel.
 * @param {boolean} checked
 */
export function syncForceOcr(checked) {
  const a = document.getElementById('force-ocr-checkbox');
  const b = document.getElementById('force-ocr-debug');
  if (a) a.checked = checked;
  if (b) b.checked = checked;
  diagnostic(`Force OCR setting changed: ${checked}`);
}

/**
 * Synchronises the Vision OCR checkbox between the Docs panel and Debug panel.
 * @param {boolean} checked
 */
export function syncVisionOcr(checked) {
  const a = document.getElementById('vision-ocr-checkbox');
  const b = document.getElementById('vision-ocr-debug');
  if (a) a.checked = checked;
  if (b) b.checked = checked;
  diagnostic(`Vision OCR setting changed: ${checked}`);
}

/**
 * Synchronises Table OCR Mode between panels and sets optimal preprocess/PSM/scale.
 * @param {boolean} checked
 */
export function syncTableOcrMode(checked) {
  const a = document.getElementById('table-ocr-checkbox');
  const b = document.getElementById('table-ocr-debug');
  if (a) a.checked = checked;
  if (b) b.checked = checked;

  if (checked) {
    const preprocess = document.getElementById('ocr-preprocess-select');
    const psm = document.getElementById('ocr-psm-select');
    const scale = document.getElementById('ocr-scale-select');
    const forceDocs = document.getElementById('force-ocr-checkbox');
    const forceDebug = document.getElementById('force-ocr-debug');
    if (preprocess) preprocess.value = 'binarize';
    if (psm) psm.value = '11';
    if (scale) scale.value = '3.0';
    if (forceDocs) forceDocs.checked = true;
    if (forceDebug) forceDebug.checked = true;
  }
  diagnostic(`Table OCR Mode changed: ${checked}`);
}

/**
 * Runs an OCR benchmark across scale/PSM combinations on page 2 of the active document.
 * Results are printed to console.table and shown in an alert.
 */
export async function runOcrBenchmark() {
  const activeDocs = docs.filter(d => d.selected !== false);
  if (!activeDocs.length) { showToast('⚠ No active document. Please upload a PDF first.'); return; }
  const doc = activeDocs[0];
  if (!doc.pdfDoc) { showToast('⚠ Active document does not contain PDF data.'); return; }

  showToast('⏳ Running OCR Benchmark (Page 2)... this may take 30–60 seconds.');
  const pg = await doc.pdfDoc.getPage(2);
  const rollRegex = /\b\d{2}[A-Za-z\d]{3}[A-Za-z\d]{2}\d{3}\b/g;

  const combinations = [
    { scale: 3.0, psm: '11', name: 'Scale 3.0 + PSM 11' },
    { scale: 3.0, psm: '6',  name: 'Scale 3.0 + PSM 6' },
    { scale: 4.0, psm: '11', name: 'Scale 4.0 + PSM 11' },
    { scale: 4.0, psm: '6',  name: 'Scale 4.0 + PSM 6' },
  ];

  const results = [];
  for (const combo of combinations) {
    const vp = pg.getViewport({ scale: combo.scale });
    let canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    canvas = preprocessCanvas(canvas, 'binarize');

    const worker = await createTesseractWorker(combo.psm);
    try {
      const result = await worker.recognize(canvas);
      const text = result.data.text || '';
      const confidence = result.data.confidence || 0;
      const uniqueCount = [...new Set((text.match(rollRegex) || []).map(r => r.toUpperCase()))].length;
      results.push({ combo: combo.name, rolls: uniqueCount, chars: text.length, confidence: confidence + '%' });
    } catch (err) {
      results.push({ combo: combo.name, rolls: 'Error', chars: 0, confidence: '0%' });
    } finally {
      await worker.terminate();
    }
  }

  console.table(results);
  let msg = '📊 OCR Benchmark Results (Page 2):\n\n';
  results.forEach(r => { msg += `• ${r.combo}: ${r.rolls} rolls (Conf: ${r.confidence})\n`; });
  alert(msg);
}
