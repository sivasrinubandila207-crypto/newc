/**
 * @module helpers
 * @description Reusable utility functions with no external dependencies.
 */

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {*} t - Value to escape
 * @returns {string}
 */
export function esc(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Auto-resizes a textarea to fit its content (max 120 px).
 * Also enables/disables the send button based on content.
 * @param {HTMLTextAreaElement} el
 */
export function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = !el.value.trim();
}

/**
 * Handles Enter key on the chat input to send (Shift+Enter = new line).
 * @param {KeyboardEvent} e
 */
export function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // sendMessage is called from app.js via window reference
    if (typeof window.sendMessage === 'function') window.sendMessage();
  }
}

/**
 * Fills the chat input with `text` and triggers a send.
 * If the text refers to 'this document' (singular) but multiple docs are active,
 * upgrades the prompt to explicitly ask about all documents.
 * @param {string} text
 */
export function chipClick(text) {
  const inp = document.getElementById('input');
  if (!inp) return;
  
  // Auto-pluralize summarize/explain/key-points prompts when multiple docs are active
  let finalText = text;
  if (text.includes('this document') || text.includes('the document')) {
    // Count selected docs via the global docs array if accessible
    const activeDocs = window._getActiveDocs ? window._getActiveDocs() : [];
    if (activeDocs.length > 1) {
      finalText = text
        .replace('this document', `all ${activeDocs.length} documents and give a separate summary for each one`)
        .replace('the document', `all ${activeDocs.length} documents`);
    }
  }
  
  inp.value = finalText;
  autoResize(inp);
  if (typeof window.sendMessage === 'function') window.sendMessage();
}

/**
 * Renders a low-res thumbnail of the first page of a PDF into a container element.
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {HTMLElement} container
 */
export async function renderThumb(pdfDoc, container) {
  try {
    const page = await pdfDoc.getPage(1);
    const vp = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    container.innerHTML = '';
    container.appendChild(canvas);
  } catch (_) { /* silent — thumbnail is non-critical */ }
}

/**
 * Copies text to clipboard using the Clipboard API with a textarea fallback.
 * @param {string} text
 * @param {Function} onSuccess - Callback after successful copy
 */
export function copyToClipboard(text, onSuccess) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => fallbackCopy(text, onSuccess));
  } else {
    fallbackCopy(text, onSuccess);
  }
}

/**
 * Fallback clipboard copy using a temporary textarea (for older browsers).
 * @param {string} text
 * @param {Function} cb
 */
export function fallbackCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  if (cb) cb();
}

/**
 * Converts a Uint8Array or ArrayBuffer to a Base64 string.
 * @param {Uint8Array|ArrayBuffer} source
 * @returns {Promise<string>}
 */
export function fileToBase64(source) {
  return new Promise((resolve, reject) => {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Creates a debounced version of a function.
 * @param {Function} fn
 * @param {number} delay - Milliseconds
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
