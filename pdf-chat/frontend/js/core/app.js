/**
 * @module app
 * @description Application bootstrap. Configures libraries, runs the auth guard,
 *              registers global event listeners, binds shortcuts, and restores documents.
 */
import { authGuard, logout } from '../auth/auth.js';
import { 
  docs, 
  messages, 
  recognition, 
  isListening, 
  setRecognition, 
  setIsListening 
} from './state.js';
import { docApi } from '../utils/storage.js';
import { 
  updateDocsList, 
  updateStats, 
  renderHistory, 
  renderFavs,
  toggleDocSelection,
  toggleAllDocs,
  deleteAllDocs,
  removeDoc,
  reprocessDoc,
  saveSession,
  loadSession,
  deleteSession,
  toggleFav,
  removeFav,
  toggleDebugPage,
  toggleFullOcrText,
  renderDebugPanel
} from '../ui/sidebar.js';
import { 
  openShortcuts, 
  closeShortcuts, 
  openPageModal, 
  closePageModal, 
  navigatePageModal,
  viewPage, 
  openAboutModal, 
  closeAboutModal, 
  openFavModal, 
  closeFavModal, 
  copyFavModal,
  showGeminiContext,
  closeContextModal,
  copyContextModal,
  ensurePdfDocLoaded
} from '../ui/modals.js';

import { handleFiles, handleDrop } from '../documents/upload.js';
import { buildVectorIndex } from '../documents/chunking.js';
import { mobileTab, toggleToolbar, initMobileToolbar } from '../ui/mobile.js';
import { toggleSearch, searchChat, navigateSearch } from '../ui/search.js';
import { syncForceOcr, syncTableOcrMode, syncVisionOcr, runOcrBenchmark } from '../ocr/tableOCR.js';
import { chipClick, handleKey, autoResize } from '../utils/helpers.js';
import { initConnStatus, showToast } from '../ui/notifications.js';
import { 
  toggleMenuDropdown, 
  closeAllDropdowns, 
  setFontSize, 
  setStyle, 
  updateTemp, 
  manualSetUsage, 
  updateModelBadge, 
  runMinimalProviderTest,
  switchSidebarTab,
  initScrollBtn,
  initUsage
} from '../ui/controls.js';
import { toggleTheme, restoreTheme } from '../ui/theme.js';
import { sendMessage, clearChat, exportChat, printChat } from '../chat/chat.js';

// Configure external libraries loaded globally via script tags
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}
if (window.marked) {
  window.marked.setOptions({ breaks: true, gfm: true });
}

// Expose all UI and action handlers on window so inline HTML attributes work
window.logout = logout;
window.toggleMenuDropdown = toggleMenuDropdown;
window.setFontSize = setFontSize;
window.setStyle = setStyle;
window.updateTemp = updateTemp;
window.manualSetUsage = manualSetUsage;
window.updateModelBadge = updateModelBadge;
window.runMinimalProviderTest = runMinimalProviderTest;
window.switchSidebarTab = switchSidebarTab;

window.toggleDocSelection = toggleDocSelection;
window.toggleAllDocs = toggleAllDocs;
window.deleteAllDocs = deleteAllDocs;
window.removeDoc = removeDoc;
window.reprocessDoc = reprocessDoc;
window.saveSession = saveSession;
window.loadSession = loadSession;
window.deleteSession = deleteSession;
window.toggleFav = toggleFav;
window.removeFav = removeFav;
window.toggleDebugPage = toggleDebugPage;
window.toggleFullOcrText = toggleFullOcrText;
window.renderDebugPanel = renderDebugPanel;
window.updateDocsList = updateDocsList;
window.updateStats = updateStats;
window.renderHistory = renderHistory;
window.renderFavs = renderFavs;

window.openShortcuts = openShortcuts;
window.closeShortcuts = closeShortcuts;
window.openPageModal = openPageModal;
window.closePageModal = closePageModal;
window.navigatePageModal = navigatePageModal;
window.viewPage = viewPage;

window.openAboutModal = openAboutModal;
window.closeAboutModal = closeAboutModal;
window.openFavModal = openFavModal;
window.closeFavModal = closeFavModal;
window.copyFavModal = copyFavModal;
window.showGeminiContext = showGeminiContext;
window.closeContextModal = closeContextModal;
window.copyContextModal = copyContextModal;

window.handleFiles = handleFiles;
window.handleDrop = handleDrop;
window.mobileTab = mobileTab;
window.toggleToolbar = toggleToolbar;
window.toggleSearch = toggleSearch;
window.searchChat = searchChat;
window.navigateSearch = navigateSearch;
window.syncForceOcr = syncForceOcr;
window.syncTableOcrMode = syncTableOcrMode;
window.syncVisionOcr = syncVisionOcr;
window.runOcrBenchmark = runOcrBenchmark;
window.chipClick = chipClick;
window.handleKey = handleKey;
window.autoResize = autoResize;

window.toggleTheme = toggleTheme;
window.sendMessage = sendMessage;
window.clearChat = clearChat;
window.exportChat = exportChat;
window.printChat = printChat;

// Delegated helper for setStyle state management (bypasses controls-state circular dep)
import { setResponseStyle } from './state.js';
window._setResponseStyle = setResponseStyle;

// Delegated helper for controls usage metric incrementation
import { incrementUsage } from '../ui/controls.js';
window._incrementUsage = incrementUsage;

// Exposes currently-selected documents so helpers.js chipClick can auto-pluralize prompts
window._getActiveDocs = () => docs.filter(d => d.selected !== false && !d.error);


/**
 * Toggles voice recording using SpeechRecognition API.
 */
export function toggleVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('🎙 Voice not supported.');
    return;
  }
  if (isListening) {
    if (recognition) recognition.stop();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();

  // Map selected UI language to standard speech locale codes
  const langMap = {
    'Telugu': 'te-IN',
    'Hindi': 'hi-IN',
    'Tamil': 'ta-IN',
    'French': 'fr-FR',
    'Spanish': 'es-ES',
    'German': 'de-DE',
    'Arabic': 'ar-AE',
    'Japanese': 'ja-JP'
  };
  const langVal = document.getElementById('lang-select')?.value || '';
  rec.lang = langMap[langVal] || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;

  let finalTranscript = '';
  rec.onstart = () => {
    setIsListening(true);
    const mic = document.getElementById('mic-btn');
    if (mic) mic.classList.add('listening');
    showToast('🎙 Listening…');
    const inp = document.getElementById('input');
    if (inp) rec._baseText = inp.value;
  };
  rec.onresult = e => {
    let interimTranscript = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
      } else {
        interimTranscript += e.results[i][0].transcript;
      }
    }
    const inp = document.getElementById('input');
    if (inp) {
      const base = rec._baseText || '';
      inp.value = (base + ' ' + finalTranscript + ' ' + interimTranscript).trim().replace(/\s+/g, ' ');
      autoResize(inp);
    }
  };
  rec.onend = () => {
    setIsListening(false);
    const mic = document.getElementById('mic-btn');
    if (mic) mic.classList.remove('listening');
  };
  rec.onerror = e => {
    setIsListening(false);
    const mic = document.getElementById('mic-btn');
    if (mic) mic.classList.remove('listening');
    console.error('Speech recognition error:', e.error, e);
    const errorMsg = e.error === 'not-allowed' 
      ? 'Microphone permission denied.' 
      : (e.error || 'Unknown error');
    showToast(`🎙 Voice error: ${errorMsg}`);
  };
  setRecognition(rec);
  rec.start();
}

window.toggleVoice = toggleVoice;

/**
 * Restores documents stored in MongoDB for the current user.
 */
async function loadPersistedDocs() {
  const listEl = document.getElementById('docs-list');
  if (listEl) {
    listEl.innerHTML = '<div class="no-docs docs-loading">☁️ Loading your documents…</div>';
  }
  try {
    const stored = await docApi.listDocs();
    if (!stored || stored.length === 0) {
      if (listEl) listEl.innerHTML = '<div class="no-docs">No documents loaded yet</div>';
      return;
    }

    const restorationPromises = stored.map(async (record) => {
      try {
        let pdfDoc = null;
        if (record.fileBase64 && window.pdfjsLib) {
          const binaryStr = atob(record.fileBase64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          pdfDoc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
        }

        const docObj = {
          _id: record._id,
          _fileBase64: record.fileBase64,
          name: record.name,
          pages: record.pages || [],
          text: record.text || '',
          pdfDoc,
          selected: true,
          ocrExtracted: record.ocrExtracted || false,
          pageConfidences: record.pageConfidences || {},
          vectorIndex: record.vectorIndex || [],
          nativeRollsCount: record.nativeRollsCount || 0,
          processedRollsCount: record.processedRollsCount || 0,
        };

        if (docObj.vectorIndex.length === 0 && docObj.pages.length > 0) {
          console.log(`[Persist] Document "${docObj.name}" has no vector index. Rebuilding in background...`);
          buildVectorIndex(docObj).then(() => {
            const slimRecord = {
              name: docObj.name,
              pageCount: docObj.pages.length,
              ocrExtracted: docObj.ocrExtracted,
              text: docObj.text,
              pages: docObj.pages,
              pageConfidences: docObj.pageConfidences || {},
              vectorIndex: docObj.vectorIndex || [],
              nativeRollsCount: docObj.nativeRollsCount || 0,
              processedRollsCount: docObj.processedRollsCount || 0,
            };
            docApi.saveDoc(slimRecord)
              .then(() => console.log(`[Persist] Saved rebuilt vector index for "${docObj.name}"`))
              .catch(err => console.error(`[Persist] Failed to save rebuilt vector index:`, err));
          }).catch(err => {
            console.error(`[Persist] Failed to rebuild vector index for "${docObj.name}":`, err);
          });
        }

        return docObj;
      } catch (docErr) {
        console.warn(`[Persist] Failed to restore "${record.name}":`, docErr.message);
        return {
          _id: record._id,
          _fileBase64: record.fileBase64,
          name: record.name,
          pages: record.pages || [],
          text: record.text || '',
          pdfDoc: null,
          selected: false,
          error: docErr.message || 'Restoration failed',
          ocrExtracted: record.ocrExtracted || false,
          pageConfidences: record.pageConfidences || {},
          vectorIndex: record.vectorIndex || [],
          nativeRollsCount: record.nativeRollsCount || 0,
          processedRollsCount: record.processedRollsCount || 0,
        };
      }
    });

    const restoredDocs = await Promise.all(restorationPromises);
    docs.push(...restoredDocs);

    updateDocsList();
    updateStats();

    const count = docs.length;
    showToast(`☁️ ${count} document${count > 1 ? 's' : ''} restored from cloud.`);

    // Preload active PDF documents in the background for instant citation viewing
    restoredDocs.forEach(d => {
      if (d.selected !== false && !d.error) {
        ensurePdfDocLoaded(d).catch(() => {});
      }
    });
  } catch (err) {
    console.error('[Persist] loadPersistedDocs failed:', err.message);
    if (listEl) {
      listEl.innerHTML = `<div class="no-docs">No documents loaded yet</div><div class="persist-warn">⚠ Could not connect to cloud storage: ${err.message}<br>Your documents are safe — try refreshing the page.</div>`;
    }
  }
}

// ── KEYBOARD SHORTCUTS ──
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && !e.shiftKey) return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { 
    e.preventDefault(); 
    toggleSearch(); 
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { 
    e.preventDefault(); 
    toggleTheme(); 
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'l') { 
    e.preventDefault(); 
    clearChat(); 
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'e') { 
    e.preventDefault(); 
    exportChat(); 
  } else if ((e.ctrlKey || e.metaKey) && e.key === 's') { 
    e.preventDefault(); 
    saveSession(); 
  } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    openShortcuts();
  } else if (e.key === 'Escape') { 
    closeShortcuts(); 
    closeFavModal(); 
    closeAboutModal(); 
    closePageModal(); 
    if (document.getElementById('search-bar')?.classList.contains('open')) toggleSearch(); 
  }
});

// Close all user dropdowns when clicking outside
document.addEventListener('click', closeAllDropdowns);

// ── BOOTSTRAP INITIALIZATION ──
authGuard();
initConnStatus();
initUsage();
initScrollBtn();
initMobileToolbar();
restoreTheme();
loadPersistedDocs();
updateModelBadge();

// Bind dynamic sign out click listener
const logoutBtn = document.querySelector('.logout-btn-item');
if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    logout();
  });
}
