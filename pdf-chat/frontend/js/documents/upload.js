/**
 * @module upload
 * @description File upload entry point: validates files, invokes PDF processing,
 *              builds the vector index, and persists documents to MongoDB.
 */
import { MAX_PDF_SIZE_BYTES } from '../utils/constants.js';
import { docs } from '../core/state.js';
import { showToast } from '../ui/notifications.js';
import { fileToBase64 } from '../utils/helpers.js';
import { processPdf } from './pdfProcessor.js';
import { buildVectorIndex } from './chunking.js';
import { saveDocumentRecord } from '../utils/storage.js';
import { mobileTab } from '../ui/mobile.js';

/**
 * Handles drag-and-drop events onto the upload zone.
 * @param {DragEvent} e
 */
export function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone')?.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
}

/**
 * Processes a FileList of PDFs: validates size, extracts text/OCR, builds vector index,
 * persists to MongoDB, and updates the document list.
 * @param {FileList|File[]} files
 */
export async function handleFiles(files) {
  const iconEl = document.getElementById('upload-icon-wrap');
  const statusEl = document.getElementById('upload-status');

  for (const file of Array.from(files)) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;

    // ── Size guard ──
    if (file.size > MAX_PDF_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      showToast(`⚠ "${file.name}" is ${sizeMB} MB — max is 10 MB.`, 5000);
      if (iconEl) iconEl.textContent = '❌';
      if (statusEl) statusEl.innerHTML = `<div style="color:var(--danger);font-size:12px">⚠ File too large (${sizeMB} MB). Max is 10 MB.<br><span style="font-size:10px;color:var(--text3)">Tip: Split large PDFs into smaller parts.</span></div>`;
      continue;
    }

    if (iconEl) iconEl.textContent = '⏳';
    if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">Reading ${file.name}…</div>`;

    try {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: fileBytes.slice().buffer }).promise;

      // ── Extract text / OCR ──
      const { pages, needsOCR, nativePagesBackup, pageConfidences } =
        await processPdf(pdf, statusEl, file.name);

      // ── Roll number diagnostics ──
      const rollRegex = /\b\d{2}[A-Za-z\d]{3}[A-Za-z\d]{2}\d{3}\b/g;
      const nativeRollsSet = new Set();
      Object.values(nativePagesBackup).forEach(text => {
        (text.match(rollRegex) || []).forEach(r => nativeRollsSet.add(r.toUpperCase()));
      });
      const processedRollsSet = new Set();
      pages.forEach(text => {
        ((text || '').match(rollRegex) || []).forEach(r => processedRollsSet.add(r.toUpperCase()));
      });

      const doc = {
        name: file.name,
        pages,
        text: pages.join('\n'),
        pdfDoc: pdf,
        selected: true,
        ocrExtracted: needsOCR,
        pageConfidences,
        nativeRollsCount: nativeRollsSet.size,
        processedRollsCount: processedRollsSet.size,
      };

      // ── Build vector index ──
      // Note: buildVectorIndex skips the API call if doc.vectorIndex already has entries
      if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">🧮 Building vector index…</div>`;
      try {
        await buildVectorIndex(doc);
        showToast(`✅ "${file.name}" — ${needsOCR ? 'OCR + ' : ''}index ready (${pdf.numPages} pages)`);
      } catch (embedErr) {
        doc.vectorIndex = [];
        const rawEmbedMsg = (embedErr.message || '').toLowerCase();
        const isQuota = rawEmbedMsg.includes('quota') || rawEmbedMsg.includes('exceeded') || rawEmbedMsg.includes('429') || rawEmbedMsg.includes('quota_exceeded');
        const isCancelled = rawEmbedMsg.includes('user_cancelled');
        let msg;
        if (isCancelled) {
          msg = `❌ Embedding cancelled for "${file.name}". Using Full Context mode.`;
        } else if (isQuota) {
          msg = `⚠️ Embedding quota reached for "${file.name}". Using Full Context mode.\n• Try again later or switch to a different API key.`;
        } else {
          msg = `⚠️ Embedding failed for "${file.name}". Using Full Context mode.`;
        }
        console.error('[Upload] Embed error:', embedErr.message);
        showToast(msg, isQuota ? 7000 : 5000);
      }

      docs.push(doc);
      if (window.updateDocsList) window.updateDocsList();
      if (window.updateStats) window.updateStats();
      mobileTab('chat');

      // ── Persist to MongoDB ──
      if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:var(--accent2)">💾 Saving to cloud…</div>`;
      try {
        const fileBase64 = await fileToBase64(fileBytes);
        await saveDocumentRecord({
          name: doc.name,
          pageCount: doc.pages.length,
          ocrExtracted: doc.ocrExtracted,
          text: doc.text,
          pages: doc.pages,
          pageConfidences: doc.pageConfidences || {},
          vectorIndex: doc.vectorIndex || [],
          fileBase64,
          nativeRollsCount: doc.nativeRollsCount || 0,
          processedRollsCount: doc.processedRollsCount || 0,
        });
        showToast(`☁️ "${doc.name}" saved to cloud!`);
      } catch (saveErr) {
        showToast(`⚠ Cloud save failed: ${saveErr.message}`, 4000);
      }

      // Reset upload zone
      if (iconEl) iconEl.textContent = '📄';
      if (statusEl) statusEl.innerHTML = '<div class="upload-title">Upload your PDFs</div><div class="upload-sub">Drag &amp; drop or click below</div>';
    } catch (err) {
      if (iconEl) iconEl.textContent = '❌';
      if (statusEl) statusEl.innerHTML = `<div style="color:var(--danger);font-size:12px">⚠ ${err.message}</div>`;
      showToast(`⚠ Upload failed: ${err.message}`, 5000);
    }
  }

  if (window.updateStats) window.updateStats();
}
