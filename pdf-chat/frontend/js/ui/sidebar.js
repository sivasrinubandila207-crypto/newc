/**
 * @module sidebar
 * @description Manages all sidebar panels: Docs list (toggles, deletion, reprocessing),
 *              Saved sessions history, stats metrics, favorites lists, and the debug diagnostics panel.
 */
import { docs, messages, favs, setFavs, debugState } from '../core/state.js';
import { docApi, dbApi, saveDocumentRecord } from '../utils/storage.js';
import { buildVectorIndex } from '../documents/chunking.js';
import { apiFetch } from '../utils/api.js';
import { esc, renderThumb } from '../utils/helpers.js';
import { showToast } from './notifications.js';
import { mobileTab } from './mobile.js';
import { appendMsgDirect, renderChatHistory } from '../chat/messageRenderer.js';
import { switchSidebarTab } from './controls.js';
import { ensurePdfDocLoaded } from './modals.js';


const msgsEl = () => document.getElementById('messages');

// Expose a helper globally for modals.js to lazily retrieve the favs array
window._getFavs = () => favs;

/**
 * Updates the document list in the sidebar panel.
 */
export function updateDocsList() {
  const badge = document.getElementById('doc-badge');
  const selectedCount = docs.filter(d => d.selected !== false && !d.error).length;
  if (badge) {
    badge.textContent = `${selectedCount} / ${docs.length} doc${docs.length > 1 ? 's' : ''}`;
    badge.style.display = docs.length ? 'block' : 'none';
  }
  const sub = document.getElementById('header-sub');
  if (sub) {
    sub.textContent = docs.length 
      ? `${selectedCount} of ${docs.length} document${docs.length > 1 ? 's' : ''} active` 
      : 'Upload a PDF to get started';
  }
  const wd = document.getElementById('welcome-desc');
  if (wd) {
    wd.textContent = docs.length 
      ? `${selectedCount} of ${docs.length} document${docs.length > 1 ? 's' : ''} ready. Ask me anything!` 
      : 'RAG-Powered Multi-Document Knowledge Assistant. Upload documents and get instant AI-powered answers with page citations.';
  }
  
  // Show or hide the global toggle Select All / Deselect All button
  const toggleBtn = document.getElementById('toggle-all-docs');
  if (toggleBtn) {
    if (docs.length > 0) {
      toggleBtn.style.display = 'inline-flex';
      toggleBtn.textContent = selectedCount > 0 ? 'Deselect All' : 'Select All';
    } else {
      toggleBtn.style.display = 'none';
    }
  }

  // Show or hide the Delete All button
  const delAllBtn = document.getElementById('delete-all-docs-btn');
  if (delAllBtn) {
    delAllBtn.style.display = docs.length > 0 ? 'inline-flex' : 'none';
  }

  const list = document.getElementById('docs-list');
  if (!list) return;
  if (!docs.length) {
    list.innerHTML = '<div class="no-docs">No documents loaded yet</div>';
    return;
  }
  list.innerHTML = docs.map((d, i) => `<div class="doc-item">
    <input type="checkbox" class="doc-checkbox" ${d.selected !== false && !d.error ? 'checked' : ''} ${d.error ? 'disabled' : ''} onchange="toggleDocSelection(${i})" title="${d.error ? 'Cannot select: load failed' : 'Select/deselect document for chat'}"/>
    <div class="doc-thumb-ph" id="thumb-${i}">📄</div>
    <div class="doc-info">
      <div class="doc-name" title="${esc(d.name)}">${esc(d.name)}</div>
      <div class="doc-pages">${d.error ? `<span style="color:var(--danger)" title="${esc(d.error)}">⚠ Load failed</span>` : `${d.pages.length} pages`}${d._id ? ' · ☁️' : ''}</div>
    </div>
    <div class="doc-actions">
      <button class="doc-reprocess" onclick="reprocessDoc(${i})" title="Re-embed document">↺</button>
      <button class="doc-del" onclick="removeDoc(${i})" title="Remove document">✕</button>
    </div>
  </div>`).join('');
  
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const idx = parseInt(entry.target.dataset.index);
          const d = docs[idx];
          if (d && d.pdfDoc) {
            entry.target.className = 'doc-thumb';
            renderThumb(d.pdfDoc, entry.target);
          }
          obs.unobserve(entry.target);
        }
      });
    }, { root: document.getElementById('docs-list'), threshold: 0.1 });

    docs.forEach((d, i) => {
      if (d.pdfDoc) {
        const el = document.getElementById(`thumb-${i}`);
        if (el) {
          el.dataset.index = i;
          observer.observe(el);
        }
      }
    });
  } else {
    docs.forEach((d, i) => {
      if (d.pdfDoc) {
        const el = document.getElementById(`thumb-${i}`);
        if (el) {
          el.className = 'doc-thumb';
          renderThumb(d.pdfDoc, el);
        }
      }
    });
  }
}

/**
 * Toggles a document's selection state.
 * Also notifies the user that chat context has changed.
 */
export function toggleDocSelection(i) {
  if (docs[i]) {
    docs[i].selected = !docs[i].selected;
    updateDocsList();
    if (docs[i].selected && !docs[i].error) {
      ensurePdfDocLoaded(docs[i]).catch(() => {});
    }
    const activeDocs = docs.filter(d => d.selected !== false && !d.error);
    if (activeDocs.length === 0) {
      showToast('⚠️ No documents selected — queries will use general AI knowledge.', 4000);
    } else {
      const names = activeDocs.map(d => d.name).join(', ');
      showToast(`✅ Active: ${names.length > 60 ? activeDocs.length + ' document(s)' : names}. New questions will use only selected docs.`, 4000);
    }
  }
}

/**
 * Toggles selection state for all documents globally.
 */
export function toggleAllDocs() {
  const selectedCount = docs.filter(d => d.selected !== false).length;
  const targetState = selectedCount === 0;
  docs.forEach(d => { 
    d.selected = targetState; 
    if (targetState && !d.error) {
      ensurePdfDocLoaded(d).catch(() => {});
    }
  });
  updateDocsList();
  if (targetState) {
    showToast(`✅ All ${docs.length} document(s) selected.`, 3000);
  } else {
    showToast('⚠️ All documents deselected — new queries will use general AI knowledge.', 4000);
  }
}

/**
 * Deletes all documents from cloud.
 */
export async function deleteAllDocs() {
  if (!docs.length) {
    showToast('📭 No documents to delete.');
    return;
  }
  if (!confirm(`Delete all ${docs.length} document(s) from the cloud? This cannot be undone.`)) return;
  try {
    await docApi.deleteAllDocs();
    docs.length = 0; // Clear state
    updateDocsList();
    updateStats();
    showToast('🗑 All documents deleted from cloud.');
  } catch (err) {
    showToast(`⚠ Delete failed: ${err.message}`, 4000);
  }
}

/**
 * Removes a document.
 */
export function removeDoc(i) {
  const doc = docs[i];
  if (!doc) return;
  showToast(`🗑 "${doc.name}" removed`);
  if (doc._id) {
    docApi.deleteDoc(String(doc._id)).catch(e =>
      console.warn('[Persist] deleteDoc failed:', e.message)
    );
  }
  docs.splice(i, 1);
  updateDocsList();
  updateStats();
}

/**
 * Reprocesses (re-embeds) a document.
 */
export async function reprocessDoc(i) {
  const doc = docs[i];
  if (!doc) return;
  showToast(`⚙️ Re-embedding "${doc.name}"…`);
  try {
    if (doc._id) {
      const data = await apiFetch(`/api/documents?action=reprocess`, {
        method: 'POST',
        body: JSON.stringify({ docId: String(doc._id) }),
      });
      if (data.error) throw new Error(data.error || 'Reprocess failed');
      doc.text = data.text;
      doc.pages = data.pages;
    }
    // Clear vectorIndex so buildVectorIndex bypasses the skip-if-already-indexed guard
    doc.vectorIndex = [];
    try {
      await buildVectorIndex(doc);
    } catch (embedErr) {
      console.error(`[Reprocess] Embedding failed for "${doc.name}":`, embedErr.message);
      doc.vectorIndex = [];
      const rawMsg = (embedErr.message || '').toLowerCase();
      const isQuota = rawMsg.includes('quota') || rawMsg.includes('exceeded') || rawMsg.includes('429');
      const friendlyMsg = isQuota
        ? `⚠️ Embedding quota reached. Try again later or use Full Context mode.`
        : `⚠️ Re-embedding failed. Using Full Context mode.`;
      showToast(friendlyMsg, 6000);
    }
    updateDocsList();
    if (doc._id) {
      await saveDocumentRecord({
        name: doc.name,
        pageCount: doc.pages.length,
        ocrExtracted: doc.ocrExtracted,
        text: doc.text,
        pages: doc.pages,
        pageConfidences: doc.pageConfidences || {},
        vectorIndex: doc.vectorIndex || [],
        fileBase64: doc._fileBase64 || '',
        nativeRollsCount: doc.nativeRollsCount || 0,
        processedRollsCount: doc.processedRollsCount || 0,
      });
    }
    showToast(`✅ "${doc.name}" re-embedded successfully!`);
  } catch (err) {
    console.error('[Reprocess]', err.message);
    showToast(`⚠ Reprocess failed. Please try again.`, 4000);
  }
}

/**
 * Updates stats in the sidebar stats tab.
 */
export function updateStats() {
  const total = messages.length;
  const user = messages.filter(m => m.role === 'user').length;
  const words = messages.reduce((s, m) => s + m.content.split(/\s+/).filter(Boolean).length, 0);
  
  const msgsEl = document.getElementById('stat-msgs');
  const userEl = document.getElementById('stat-user');
  const aiEl = document.getElementById('stat-ai');
  const wordsEl = document.getElementById('stat-words');
  const tokensEl = document.getElementById('stat-tokens');
  const docsEl = document.getElementById('stat-docs');
  const pagesEl = document.getElementById('stat-pages');

  if (msgsEl) msgsEl.textContent = total;
  if (userEl) userEl.textContent = user;
  if (aiEl) aiEl.textContent = total - user;
  if (wordsEl) wordsEl.textContent = words.toLocaleString();
  if (tokensEl) tokensEl.textContent = Math.round(words * 1.3).toLocaleString();
  if (docsEl) docsEl.textContent = docs.length;
  if (pagesEl) pagesEl.textContent = docs.reduce((s, d) => s + d.pages.length, 0);
}

/**
 * Saves the current session to database and history.
 */
export async function saveSession() {
  const dropdown = document.getElementById('menu-dropdown');
  if (dropdown) dropdown.classList.remove('open');
  if (!messages.length) {
    showToast('💬 Nothing to save.');
    return;
  }
  const firstUserMsg = messages.find(m => m.role === 'user')?.content || 'Session';
  const session = {
    id: Date.now().toString(),
    title: firstUserMsg.slice(0, 40),
    date: new Date().toLocaleString(),
    messages: [...messages]
  };
  showToast('💾 Saving...');
  await dbApi.saveSession(session);
  const local = JSON.parse(localStorage.getItem('ragSessions') || '[]');
  local.unshift(session);
  if (local.length > 20) local.pop();
  localStorage.setItem('ragSessions', JSON.stringify(local));
  showToast('📌 Session saved to MongoDB!');
  renderHistory();
}

/**
 * Renders the saved sessions history.
 */
export async function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '<div class="no-docs">🔄 Loading sessions...</div>';
  const sessions = await dbApi.getSessions();
  localStorage.setItem('ragSessions', JSON.stringify(sessions));
  window._sessions = sessions;
  if (!sessions.length) {
    list.innerHTML = '<div class="no-docs">No saved sessions yet</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `<div class="history-item" onclick="loadSession('${s.id}')">
    <button class="history-del" onclick="event.stopPropagation();deleteSession('${s.id}')">✕</button>
    <div class="history-title">${esc(s.title)}…</div>
    <div class="history-meta">${s.date} • ${s.messages.length} messages</div></div>`).join('');
}

/**
 * Loads a saved session.
 */
export function loadSession(id) {
  const sessions = window._sessions || JSON.parse(localStorage.getItem('ragSessions') || '[]');
  const s = sessions.find(x => String(x.id) === String(id));
  if (!s) return;
  messages.length = 0;
  messages.push(...s.messages);
  
  renderChatHistory(messages);

  switchSidebarTab('docs');
  mobileTab('chat');
  updateStats();
  showToast('⏳ Session loaded!');
}

/**
 * Deletes a saved session.
 */
export async function deleteSession(id) {
  await dbApi.deleteSession(id);
  let local = JSON.parse(localStorage.getItem('ragSessions') || '[]').filter(x => String(x.id) !== String(id));
  localStorage.setItem('ragSessions', JSON.stringify(local));
  renderHistory();
  showToast('🗑 Session deleted.');
}



/**
 * Toggles a message's favourite/starred status.
 */
export async function toggleFav(btn) {
  const content = decodeURIComponent(btn.dataset.encoded || '');
  if (!content) return;
  const idx = favs.findIndex(f => f.content === content);
  if (idx >= 0) {
    favs.splice(idx, 1);
    await dbApi.removeFav(content);
    btn.textContent = '⭐ Star';
    btn.classList.remove('starred');
    showToast('⭐ Removed from favorites');
  } else {
    favs.push({ content, date: new Date().toLocaleString() });
    await dbApi.addFav(content);
    btn.textContent = '⭐ Starred!';
    btn.classList.add('starred');
    showToast('⭐ Saved to MongoDB!');
  }
  localStorage.setItem('ragFavs', JSON.stringify(favs));
  renderFavs();
}

/**
 * Renders the favourites list.
 */
export async function renderFavs() {
  const list = document.getElementById('favs-list');
  if (!list) return;
  list.innerHTML = '<div class="no-docs">🔄 Loading favorites...</div>';
  const loaded = await dbApi.getFavs();
  setFavs(loaded);
  localStorage.setItem('ragFavs', JSON.stringify(favs));
  if (!favs.length) {
    list.innerHTML = '<div class="no-docs">No starred messages yet.<br/>Click ⭐ on any AI response to save it.</div>';
    return;
  }
  list.innerHTML = favs.map((f, i) => `<div class="history-item" onclick="openFavModal(${i})" style="cursor:pointer">
    <button class="history-del" onclick="event.stopPropagation();removeFav(${i})">✕</button>
    <div class="history-title">${esc(f.content.slice(0, 80))}…</div>
    <div class="history-meta">${f.date} • tap to read full</div></div>`).join('');
}

/**
 * Removes a favourite by its index.
 */
export async function removeFav(i) {
  if (!favs[i]) return;
  const content = favs[i].content;
  await dbApi.removeFav(content);
  favs.splice(i, 1);
  localStorage.setItem('ragFavs', JSON.stringify(favs));
  renderFavs();
  showToast('🗑 Removed from favorites');
}

/**
 * Renders the Debug Diagnostics panel.
 */
export function renderDebugPanel() {
  const totalsEl = document.getElementById('debug-totals');
  const rollsEl = document.getElementById('debug-roll-numbers');
  const listEl = document.getElementById('debug-pages-list');
  const statsEl = document.getElementById('debug-retrieved-stats');
  const chunksEl = document.getElementById('debug-retrieved-chunks');

  if (!totalsEl) return;

  if (!debugState.lastDocument) {
    totalsEl.innerHTML = '<div class="no-docs">No active document metrics. Upload a PDF first.</div>';
    if (rollsEl) rollsEl.innerHTML = '';
    if (listEl) listEl.innerHTML = '';
    if (statsEl) statsEl.innerHTML = '<div style="font-size:11px;color:var(--text3);font-style:italic">No query stats available. Submit a question first.</div>';
    if (chunksEl) chunksEl.innerHTML = '<div style="font-size:11px;color:var(--text3);font-style:italic">No chunks retrieved yet.</div>';
    return;
  }

  const lastDoc = debugState.lastDocument;
  const lastContext = debugState.lastSentContext;

  // Render Fields Verification
  let verificationHtml = '';
  if (lastDoc.fieldsVerification) {
    verificationHtml = `
      <div style="margin-top:10px;padding:8px;border-top:1px dashed var(--border);background:var(--surface3);border-radius:6px">
        <div style="font-weight:600;font-size:10px;text-transform:uppercase;color:var(--accent3);margin-bottom:6px">📝 Fields Verification</div>
        ${Object.entries(lastDoc.fieldsVerification).map(([key, f]) => `
          <div class="debug-stat-row" style="margin-bottom:2px">
            <span>${f.label}</span>
            <span style="color:${f.detected ? 'var(--success)' : 'var(--danger)'};font-weight:700">${f.detected ? '✅ Found' : '❌ Missing'}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render Context Verification
  let contextVerificationHtml = '';
  if (lastContext && lastContext.contextText) {
    const textLower = lastContext.contextText.toLowerCase();
    const sections = {
      benefits: { label: "Employee Benefits", detected: /benefit|perk|insurance|leave/i.test(textLower) },
      training: { label: "Training Budget", detected: /training|budget|learning|course|reimburse/i.test(textLower) },
      remote: { label: "Remote Work", detected: /remote|work\s*from\s*home|wfh|telecommute/i.test(textLower) },
      availability: { label: "System Availability (99.9%)", detected: /99\.9%|availability/i.test(textLower) },
      backup: { label: "Backup Frequency (Daily)", detected: /daily|backup/i.test(textLower) }
    };
    
    contextVerificationHtml = `
      <div style="margin-top:10px;padding:8px;border-top:1px dashed var(--border);background:var(--surface3);border-radius:6px">
        <div style="font-weight:600;font-size:10px;text-transform:uppercase;color:var(--accent2);margin-bottom:6px">🔍 Context Verification (Last Sent)</div>
        ${Object.entries(sections).map(([key, s]) => `
          <div class="debug-stat-row" style="margin-bottom:2px">
            <span>${s.label}</span>
            <span style="color:${s.detected ? 'var(--success)' : 'var(--danger)'};font-weight:700">${s.detected ? '✅ Present' : '❌ Absent'}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  totalsEl.innerHTML = `
    <div class="debug-stat-row"><span>Document Name</span><span>${esc(lastDoc.name)}</span></div>
    <div class="debug-stat-row"><span>Total Pages</span><span>${lastDoc.pagesCount}</span></div>
    <div class="debug-stat-row"><span>Total Characters</span><span>${lastDoc.totalChars.toLocaleString()}</span></div>
    <div class="debug-stat-row"><span>Total Words</span><span>${lastDoc.totalWords.toLocaleString()}</span></div>
    <div class="debug-stat-row"><span>Total Chunks</span><span>${lastDoc.totalChunks}</span></div>
    <div class="debug-stat-row"><span>Roll Count (Native)</span><span>${lastDoc.nativeRollsCount}</span></div>
    <div class="debug-stat-row"><span>Roll Count (OCR Mode)</span><span style="color:var(--success);font-weight:700">${lastDoc.processedRollsCount}</span></div>
    <div class="debug-stat-row"><span>Embedding Model</span><span class="debug-badge">${lastDoc.embeddingModelUsed}</span></div>
    <div class="debug-stat-row"><span>Retrieval Mode</span><span class="debug-badge success">${lastContext && lastContext.retrievalMode === 'FULL CONTEXT' ? 'Mode: Full Context' : 'Mode: RAG'}</span></div>
    ${verificationHtml}
    ${contextVerificationHtml}
  `;

  if (lastContext) {
    const modeText = lastContext.retrievalMode === 'FULL CONTEXT' ? 'Mode: Full Context' : 'Mode: RAG';
    const chunksCount = lastContext.chunksSent;
    const contextLength = lastContext.contextCharCount;
    
    const uniqueDocsUsed = new Set();
    const uniquePagesUsed = new Set();
    const retrievedChunks = lastContext.retrievedChunks || [];
    
    retrievedChunks.forEach(c => {
      uniqueDocsUsed.add(c.documentName);
      uniquePagesUsed.add(`${c.documentName}||${c.pageNumber}`);
    });
    
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="debug-stat-row"><span>Retrieval Mode</span><span class="debug-badge ${lastContext.retrievalMode === 'FULL CONTEXT' ? 'danger' : 'success'}">${modeText}</span></div>
        <div class="debug-stat-row"><span>Retrieved Chunks</span><span>${chunksCount}</span></div>
        <div class="debug-stat-row"><span>Context Length</span><span>${contextLength.toLocaleString()} characters</span></div>
        <div class="debug-stat-row"><span>Documents Used</span><span>${uniqueDocsUsed.size}</span></div>
        <div class="debug-stat-row"><span>Pages Used</span><span>${uniquePagesUsed.size}</span></div>
      `;
    }
    
    if (chunksEl) {
      if (retrievedChunks.length > 0) {
        chunksEl.innerHTML = retrievedChunks.map(c => {
          const scoreVal = c.similarityScore;
          const scoreText = typeof scoreVal === 'number' ? scoreVal.toFixed(2) : scoreVal;
          return `
            <div class="debug-chunk-row">
              <span class="debug-chunk-name" title="${esc(c.documentName)}">${esc(c.documentName)}</span>
              <span class="debug-chunk-page">Page ${c.pageNumber}</span>
              <span class="debug-chunk-score">${scoreText}</span>
            </div>
          `;
        }).join('');
      } else {
        chunksEl.innerHTML = '<div style="font-size:11px;color:var(--text3);font-style:italic">No chunks retrieved.</div>';
      }
    }
  } else {
    if (statsEl) statsEl.innerHTML = '<div style="font-size:11px;color:var(--text3);font-style:italic">No query stats available. Submit a question first.</div>';
    if (chunksEl) chunksEl.innerHTML = '<div style="font-size:11px;color:var(--text3);font-style:italic">No chunks retrieved yet.</div>';
  }

  const rollDetailsHtml = lastDoc.pages.map(p => {
    const pageRolls = lastDoc.rollNumbersPerPage[p.pageNum] || [];
    return `Page ${p.pageNum}: <strong>${pageRolls.length}</strong> matches`;
  }).join(' &bull; ');

  if (rollsEl) {
    rollsEl.innerHTML = `
      <div class="debug-stat-row"><span>Roll Numbers Detected</span><span>${lastDoc.allRolls.length}</span></div>
      <div style="font-size:10px;color:var(--text2);margin-top:2px">${rollDetailsHtml}</div>
      <div class="debug-roll-list">
        ${lastDoc.allRolls.map(r => `<span class="debug-roll-item">${esc(r)}</span>`).join('') || '<div style="color:var(--text3);font-size:10px">No roll numbers detected</div>'}
      </div>
    `;
  }

  if (listEl) {
    listEl.innerHTML = lastDoc.pages.map(p => {
      const pageRolls = lastDoc.rollNumbersPerPage[p.pageNum] || [];
      const chunksCreated = lastDoc.chunksPerPage[p.pageNum] || 0;
      const isSkipped = p.skipped;
      const confClass = p.confidence < 70 ? 'danger' : p.confidence < 85 ? '' : 'success';
      
      return `
        <div class="debug-page-card" style="margin-bottom:8px">
          <div class="debug-page-header" onclick="window.toggleDebugPage(${p.pageNum})">
            <span>📄 Page ${p.pageNum}</span>
            <div style="display:flex;gap:4px;align-items:center">
              ${isSkipped ? `<span class="debug-badge danger">Skipped</span>` : `<span class="debug-badge">${chunksCreated} chunks</span>`}
              <span class="debug-badge ${confClass}">Conf: ${p.confidence}%</span>
              <span class="debug-badge success">${pageRolls.length} rolls</span>
              <span id="debug-arrow-${p.pageNum}">▼</span>
            </div>
          </div>
          <div class="debug-page-body" id="debug-body-${p.pageNum}">
            <div class="debug-stat-row"><span>Character Count</span><span>${p.charCount}</span></div>
            <div class="debug-stat-row"><span>Word Count</span><span>${p.wordCount}</span></div>
            <div class="debug-stat-row"><span>OCR Confidence</span><span>${p.confidence}%</span></div>
            ${isSkipped ? `<div class="debug-stat-row" style="color:var(--danger)"><span>Reason Skipped</span><span>${esc(p.skippedReason)}</span></div>` : ''}
            <div style="font-weight:600;margin-top:4px;color:var(--accent3)">OCR Text Preview:</div>
            <div class="debug-preview-box">${esc(p.textPreview || '[Empty Page]')}</div>
            
            <button class="msg-copy" style="align-self:flex-start;margin-top:4px" onclick="window.toggleFullOcrText(${p.pageNum})">📄 Toggle Full OCR Text</button>
            <div id="debug-fulltext-${p.pageNum}" class="debug-preview-box" style="display:none;margin-top:4px;max-height:200px">${esc(p.fullText || '[Empty Page]')}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

export function toggleDebugPage(pageNum) {
  const body = document.getElementById(`debug-body-${pageNum}`);
  const arrow = document.getElementById(`debug-arrow-${pageNum}`);
  if (body) {
    const isOpen = body.classList.toggle('open');
    if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
  }
}

export function toggleFullOcrText(pageNum) {
  const el = document.getElementById(`debug-fulltext-${pageNum}`);
  if (el) {
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
  }
}

// Expose functions globally for onclick and template generation
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
