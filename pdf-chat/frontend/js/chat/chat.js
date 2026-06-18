/**
 * @module chat
 * @description Orchestrates the chat flow: intercepts questions, retrieves context (or bypasses RAG),
 *              submits queries to the Gemini/Groq APIs, and manages history auto-saving.
 *
 * Optimizations applied:
 *  - Response cache: same question + same document fingerprint → cached reply (0 API calls)
 *  - RESPONSE_STYLE_HINTS imported from constants (removed local duplicate)
 *  - closeMenu() helper replaces 3 identical menu-close snippets
 */
import {
  docs,
  messages,
  streaming,
  setStreaming,
  responseStyle,
  startChatRequestMetrics,
  recordApiCall,
  finishChatRequestMetrics,
  debugState
} from '../core/state.js';
import {
  appendMsg,
  appendMsgDirect,
  copyMsg
} from './messageRenderer.js';
import { retrieveContext, computeConfidence } from '../documents/retrieval.js';
import { getProviderLabel } from '../ui/controls.js';
import { showToast } from '../ui/notifications.js';
import { dbApi } from '../utils/storage.js';
import { esc, autoResize } from '../utils/helpers.js';
import { extractCitationsFromText, buildCitationLine, buildSourceCardsHtml } from './citations.js';
import { SYSTEM_RULES, SMALL_DOC_CHAR_LIMIT, RESPONSE_STYLE_HINTS } from '../utils/constants.js';

const msgsEl = () => document.getElementById('messages');

// ── RESPONSE CACHE ────────────────────────────────────────────────────────────
// Key: `${docFingerprint}||${normalizedQuery}` → cached reply string
// Cleared on page refresh (module scope). Invalidated when doc set changes.
const _responseCache = new Map();
const RESPONSE_CACHE_MAX = 30;

/**
 * Computes a lightweight fingerprint of the current active document set.
 * Changes when documents are added/removed/swapped.
 * @param {Object[]} activeDocs
 * @returns {string}
 */
function activeDocFingerprint(activeDocs) {
  return activeDocs.map(d => `${d.name}||${d.pages.length}`).join('::');
}

/**
 * Returns a cached reply if available for this question + doc set + model, or null.
 * @param {string} msg
 * @param {Object[]} activeDocs
 * @param {string} modelName
 * @returns {string|null}
 */
function getCachedResponse(msg, activeDocs, modelName) {
  const key = `${activeDocFingerprint(activeDocs)}||${modelName || 'auto-fallback'}||${msg.trim().toLowerCase()}`;
  return _responseCache.get(key) || null;
}

/**
 * Stores a reply in the response cache.
 * Evicts oldest entry when cache is full.
 * @param {string} msg
 * @param {Object[]} activeDocs
 * @param {string} modelName
 * @param {string} reply
 */
function setCachedResponse(msg, activeDocs, modelName, reply) {
  const key = `${activeDocFingerprint(activeDocs)}||${modelName || 'auto-fallback'}||${msg.trim().toLowerCase()}`;
  if (_responseCache.size >= RESPONSE_CACHE_MAX) {
    _responseCache.delete(_responseCache.keys().next().value);
  }
  _responseCache.set(key, reply);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

/** Closes the user menu dropdown. Called at the start of clearChat/exportChat/printChat. */
function closeMenu() {
  document.getElementById('menu-dropdown')?.classList.remove('open');
}

// ── SESSION AUTO-SAVE ─────────────────────────────────────────────────────────

/**
 * Automatically saves the current session under a special 'auto' ID.
 */
export async function autoSaveSession() {
  if (!messages.length) return;
  const firstUserMsg = messages.find(m => m.role === 'user')?.content || 'Chat';
  const session = {
    id: 'auto',
    title: '[Auto] ' + firstUserMsg.slice(0, 35),
    date: new Date().toLocaleString(),
    messages: [...messages]
  };
  await dbApi.saveSession(session);
  const local = JSON.parse(localStorage.getItem('ragSessions') || '[]');
  const idx = local.findIndex(s => s.id === 'auto');
  if (idx >= 0) local[idx] = session; else local.unshift(session);
  localStorage.setItem('ragSessions', JSON.stringify(local));
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────

/**
 * Handles sending a new message. Orchestrates RAG context, LLM prompt generation, API calling,
 * and rendering of the streaming response.
 */
export async function sendMessage() {
  const inputEl = document.getElementById('input');
  if (!inputEl) return;
  const msg = inputEl.value.trim();
  if (!msg || streaming) return;

  // ── IDENTITY INTERCEPTION ──
  const identityRegex = /who\s*(built|made|created|developed)\s*(you|this)|about\s*(this\s*app|insightdocs)|tell\s*me\s*about\s*(yourself|this)|what\s*is\s*insightdocs/i;
  if (identityRegex.test(msg)) {
    inputEl.value = '';
    autoResize(inputEl);
    messages.push({ role: 'user', content: msg });
    appendMsg('user', msg, false);

    const identityReply = 'I am InsightDocs AI, an AI-powered document assistant developed by BSS. I help users analyze, search, summarize, and interact with PDF documents using OCR, Retrieval-Augmented Generation (RAG), semantic search, and Gemini AI.';
    const replyBubble = appendMsg('ai', identityReply, false);

    const wrap = replyBubble.parentElement;
    const actDiv = document.createElement('div');
    actDiv.className = 'msg-actions';
    const cb = document.createElement('button');
    cb.className = 'msg-copy';
    cb.textContent = '📋 Copy';
    cb.dataset.text = encodeURIComponent(identityReply);
    cb.onclick = function() { copyMsg(this); };
    const sb = document.createElement('button');
    sb.className = 'msg-star';
    sb.textContent = '⭐ Star';
    sb.dataset.encoded = encodeURIComponent(identityReply);
    sb.onclick = function() { window.toggleFav(this); };
    actDiv.appendChild(cb);
    actDiv.appendChild(sb);
    wrap.appendChild(actDiv);

    messages.push({
      role: 'assistant',
      content: identityReply,
      question: msg,
      timestamp: new Date().toISOString(),
      sources: [],
      pages: [],
      confidence: 'High',
      citations: []
    });

    if (window._incrementUsage) window._incrementUsage();
    if (window.updateStats) window.updateStats();
    autoSaveSession();
    const el = msgsEl();
    if (el) el.scrollTop = 99999;
    return;
  }

  inputEl.value = '';
  autoResize(inputEl);
  setStreaming(true);

  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = true;

  messages.push({ role: 'user', content: msg });
  appendMsg('user', msg, false);
  const bubble = appendMsg('ai', '', true);

  let contextText = '';
  let citations = [];
  let noMatchFallback = false;
  let chunksSent = 0;
  let retrievedChunks = [];

  const activeDocs = docs.filter(d => d.selected !== false);
  const totalDocChars = activeDocs.reduce((sum, d) => sum + (d.text || '').length, 0);

  // Check if any active document is a marksheet
  const hasMarksheet = activeDocs.some(d => 
    /marksheet|grade\s*card|certificate|statement\s*of\s*marks|passing\s*certificate/i.test(d.name) || 
    /marksheet|grade\s*card|certificate|statement\s*of\s*marks|passing\s*certificate/i.test(d.text || '')
  );

  // Bypasses RAG globally ONLY if the total character count of all active documents combined
  // is extremely small (below SMALL_DOC_CHAR_LIMIT), making it secure and efficient to send everything,
  // AND there is no active marksheet document. This prevents leaking sensitive marksheet data
  // when queries are actually about other documents. Instead, the retrieval pipeline dynamically pulls full marksheet
  // context only when the query is relevant to it.
  const bypassRag = totalDocChars < SMALL_DOC_CHAR_LIMIT && !hasMarksheet;

  const selectedModel = document.getElementById('model-select')?.value || 'auto-fallback';

  // ── RESPONSE CACHE CHECK (only when docs are active) ──
  if (activeDocs.length > 0) {
    const cached = getCachedResponse(msg, activeDocs, selectedModel);
    if (cached) {
      console.log(`[Chat] Cache hit for: "${msg.slice(0, 50)}…" [Model: ${selectedModel}]`);
      bubble.innerHTML = typeof window.marked !== 'undefined'
        ? window.marked.parse(cached)
        : esc(cached);

      messages.push({
        role: 'assistant',
        content: cached,
        question: msg,
        timestamp: new Date().toISOString(),
        sources: [],
        pages: [],
        confidence: 'High',
        citations: [],
        fromCache: true
      });

      if (window._incrementUsage) window._incrementUsage();
      if (window.updateStats) window.updateStats();
      autoSaveSession();
      setStreaming(false);
      if (sendBtn) sendBtn.disabled = !inputEl.value.trim();
      const msgRow = bubble.closest('.msg-row');
      if (msgRow) {
        msgRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const el = msgsEl();
        if (el) el.scrollTop = 99999;
      }
      return;
    }
  }

  if (bypassRag) {
    if (activeDocs.length > 0) {
      contextText = activeDocs.map(d => {
        return d.pages.map((pText, pi) => `[Document: ${d.name} — Page ${pi + 1}]\n${pText}`).join('\n\n---\n\n');
      }).join('\n\n---\n\n');

      activeDocs.forEach(d => {
        d.pages.forEach((_, pi) => {
          retrievedChunks.push({
            documentName: d.name,
            pageNumber: pi + 1,
            similarityScore: 'Full Context'
          });
          citations.push(`${d.name} p.${pi + 1}`);
        });
      });
      chunksSent = retrievedChunks.length;
    }
  } else {
    const retrieved = await retrieveContext(msg);
    contextText = retrieved.text;
    citations = retrieved.citations;
    noMatchFallback = retrieved.noMatchFallback;
    retrievedChunks = retrieved.retrievedChunks || [];
    chunksSent = retrievedChunks.length;
  }

  // Calculate confidence score
  const confidence = computeConfidence(retrievedChunks, bypassRag);

  const langSel = document.getElementById('lang-select')?.value || '';
  const langInstr = langSel ? `\nIMPORTANT: Respond in ${langSel} language.` : '';

  const matchMode = document.getElementById('temp-select')?.value || '0.3';
  let strictnessInstr = '';
  if (contextText) {
    if (noMatchFallback) {
      if (matchMode === '0.05' || matchMode === '0.3') {
        strictnessInstr = '\nSTRICTNESS RULE: No direct keyword matches were found in the document for the query. You are given the first part of the document above for reference. If the user\'s query is a greeting, follow-up, general question, or meta-question, reply normally. If the user is asking for specific facts not in the document, state that the information was not found in the active documents.';
      }
    } else {
      if (matchMode === '0.05') {
        strictnessInstr = '\nSTRICTNESS RULE: You are in EXACT MODE (100%). You must answer strictly using ONLY the provided document excerpts. Do not use any external or general knowledge. If the exact answer cannot be found in the excerpts, you MUST reply: "I cannot find the answer in the provided documents." Do not speculate, suggest, or extrapolate.';
      } else if (matchMode === '0.3') {
        strictnessInstr = '\nSTRICTNESS RULE: You are in PRECISE MODE (90%). Answer using the provided document excerpts. You may clarify terms using general knowledge, but do not introduce external facts. If the answer is not mentioned in the text, clearly state that.';
      } else if (matchMode === '0.6') {
        strictnessInstr = '\nSTRICTNESS RULE: You are in BALANCED MODE. Answer using the document excerpts, but you may supplement with general knowledge to provide a helpful response.';
      } else if (matchMode === '0.9') {
        strictnessInstr = '\nSTRICTNESS RULE: You are in CREATIVE MODE. Use the document excerpts as a starting reference, but feel free to expand and add external ideas.';
      }
    }
  } else {
    if (matchMode === '0.05' || matchMode === '0.3') {
      const activeDocsCount = docs.filter(d => d.selected !== false).length;
      if (activeDocsCount > 0) {
        strictnessInstr = '\nSTRICTNESS RULE: No matching excerpts were found for the query in the active documents. Since you are in Exact/Precise mode, you must state that the information was not found in the active documents. (Exception: If the user is asking about your identity, creator, builder, developer, or greeting you, answer directly and mention you were developed by BSS).';
      } else {
        strictnessInstr = '\nSTRICTNESS RULE: No document is currently uploaded and selected. Since you are in Exact/Precise mode, you must state that you require a document to be uploaded and selected to answer questions. (Exception: If the user is asking about your identity, creator, builder, developer, or greeting you, answer directly and mention you were developed by BSS).';
      }
    }
  }

  const isAskingForDeveloper = /developer|creator|builder|who\s*made\s*you|who\s*built\s*you/i.test(msg.toLowerCase());
  const developerInstruction = isAskingForDeveloper ? '\nDeveloper Identity: You were developed and built by BSS. You are InsightDocs AI. If the user asks about your developer, builder, creator, or who made you, you must state that you were developed and built by BSS (InsightDocs AI). You must NOT mention that you are a language model trained by Google or anything about Google. State only that you were developed by BSS.' : '';

  // Build scope header
  const activeDocNames = activeDocs.map(d => d.name);
  let scopeHeader = '';
  if (activeDocNames.length > 1) {
    scopeHeader =
      `MULTI-DOCUMENT MODE: You have been provided with ${activeDocNames.length} documents:\n` +
      activeDocNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n') +
      `\n\nCRITICAL RULE: If the user is asking to summarize, analyze, or explain the documents, you MUST write a separate summary/section for EACH of the ${activeDocNames.length} active documents listed above. Do NOT skip any document or combine them into a single summary of just one document. If the user is asking a specific question (e.g. about a specific name, fact, roll number, score, or room allocation), answer it directly using only the relevant document(s) without referencing or summarizing the others. Any previous conversation references to documents NOT in this list must be ignored.\n\n`;
  } else if (activeDocNames.length === 1) {
    scopeHeader =
      `ACTIVE DOCUMENT: "${activeDocNames[0]}". Answer only from this document. ` +
      `Ignore any previous conversation references to other documents.\n\n`;
  }

  const multiDocInstruction = activeDocNames.length > 1
    ? `\n\nMULTI-DOC REQUIREMENT: When summarizing, explaining, or listing details for the documents, cover ALL active documents. You must provide a summary for each of them individually.`
    : '';

  // Use RESPONSE_STYLE_HINTS from constants (no longer a local duplicate)
  const styleHint = RESPONSE_STYLE_HINTS[responseStyle] || '';

  let system = scopeHeader + (contextText
    ? `You are a helpful assistant. Answer using these document excerpts:\n\n${contextText}\n\nIMPORTANT: For every fact, statement, or answer you provide, cite the document name and page (e.g., "[${activeDocNames[0] || 'Doc'} p.4]" or "[${activeDocNames[1] || 'Doc'} p.2]") where it was found. If the answer isn't in the excerpts, say so.`
    : 'You are a helpful assistant. Answer from your knowledge.') + multiDocInstruction + developerInstruction + (styleHint ? '\n' + styleHint : '') + langInstr + strictnessInstr;

  system += '\n\n' + SYSTEM_RULES;

  const selectedProvider = getProviderLabel(selectedModel);
  const temperature = parseFloat(document.getElementById('temp-select')?.value || '0.3');
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const contextCharCount = contextText ? contextText.length : 0;
  const contextWordCount = contextText ? contextText.split(/\s+/).filter(Boolean).length : 0;
  const retrievalMode = bypassRag ? 'FULL CONTEXT' : 'RAG';

  startChatRequestMetrics(requestId, bypassRag ? 'full-context' : 'rag');

  console.log(`[AI-REQ] id=${requestId} provider=${selectedProvider} model=${selectedModel} bypass=${bypassRag ? 'yes' : 'no'} chunks=${chunksSent} ctxChars=${contextCharCount}`);

  debugState.lastSentContext = {
    requestId,
    system,
    messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
    contextText,
    contextCharCount,
    contextWordCount,
    chunksSent,
    fullContextBypass: bypassRag,
    retrievalMode,
    retrievedChunks,
    confidence
  };

  if (window.renderDebugPanel) {
    window.renderDebugPanel();
  }

  try {
    const payload = {
      system,
      messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
      model: selectedModel,
      selectedModel,
      provider: selectedProvider,
      requestId,
      bypassRag,
      retrievalMode,
      temperature
    };

    recordApiCall('chat');

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.error) {
      const rawApiErr = (data.error || '').toLowerCase();
      let friendlyApiErr;
      if (rawApiErr.includes('quota') || rawApiErr.includes('429') || rawApiErr.includes('rate limit') || rawApiErr.includes('exceeded')) {
        friendlyApiErr = `⚠️ AI quota reached.\n\nPlease:\n• Try another model from the selector\n• Use Auto Fallback mode\n• Retry in a few minutes`;
      } else if (rawApiErr.includes('invalid_api_key') || rawApiErr.includes('authentication') || rawApiErr.includes('401')) {
        friendlyApiErr = '🔑 Invalid API key. Please check your configuration.';
      } else if (rawApiErr.includes('model') && (rawApiErr.includes('not found') || rawApiErr.includes('unavailable'))) {
        friendlyApiErr = '🤖 Selected model is temporarily unavailable. Try switching to Auto Fallback.';
      } else {
        friendlyApiErr = '⚠️ Something went wrong. Please try again or switch models.';
      }
      console.error('[Chat] API error:', data.error);
      bubble.innerHTML = `<div style="color:var(--danger);white-space:pre-line;line-height:1.6">${esc(friendlyApiErr)}</div>`;
    } else {
      const reply = data.content?.[0]?.text || 'No response received.';

      let citedSources = extractCitationsFromText(reply, activeDocs, citations);

      if (citations.length > 0) {
        const retrievedSet = new Set(citations);
        citedSources = citedSources.filter(s => retrievedSet.has(`${s.docName} p.${s.pageNum}`));
      }

      // Fallback: If no citations are explicitly mentioned in the text, use all retrieved pages from RAG
      if (citedSources.length === 0 && citations.length > 0) {
        citations.forEach(cStr => {
          const parts = cStr.split(' p.');
          const docName = parts[0];
          const pageNum = parts[1] ? parseInt(parts[1]) : null;
          if (docName && pageNum !== null && !isNaN(pageNum)) {
            citedSources.push({ docName, pageNum });
          }
        });
      }

      if (citedSources.length === 0 && activeDocs.length === 1 && activeDocs[0].pages.length === 1) {
        citedSources.push({ docName: activeDocs[0].name, pageNum: 1 });
      }

      let citationLine = buildCitationLine(citedSources);

      let processedReply = reply;
      if (citationLine && !reply.includes('📄 Source')) {
        processedReply = reply.trim() + '\n\n' + citationLine;
      }

      const parsedReply = typeof window.marked !== 'undefined'
        ? window.marked.parse(processedReply)
        : esc(processedReply);

      const sourcesHtml = buildSourceCardsHtml(citedSources, confidence);
      bubble.innerHTML = parsedReply + sourcesHtml;

      const wrap = bubble.parentElement;
      const actDiv = document.createElement('div');
      actDiv.className = 'msg-actions';

      const cb = document.createElement('button');
      cb.className = 'msg-copy';
      cb.textContent = '📋 Copy';
      cb.dataset.text = encodeURIComponent(processedReply);
      cb.onclick = function() { copyMsg(this); };

      const sb = document.createElement('button');
      sb.className = 'msg-star';
      sb.textContent = '⭐ Star';
      sb.dataset.encoded = encodeURIComponent(processedReply);
      sb.onclick = function() { window.toggleFav(this); };

      actDiv.appendChild(cb);
      actDiv.appendChild(sb);
      wrap.appendChild(actDiv);

      // Store in response cache (doc fingerprint scoped)
      if (activeDocs.length > 0) {
        setCachedResponse(msg, activeDocs, selectedModel, processedReply);
      }

      messages.push({
        role: 'assistant',
        content: processedReply,
        question: msg,
        timestamp: new Date().toISOString(),
        sources: citedSources.map(s => s.docName),
        pages: citedSources.map(s => s.pageNum),
        confidence: confidence,
        citations: citedSources.map(s => `${s.docName} p.${s.pageNum}`)
      });

      if (window._incrementUsage) window._incrementUsage();
      if (window.updateStats) window.updateStats();
      autoSaveSession();
    }
  } catch (e) {
    console.error('[Chat] Request failed:', e.message);

    const rawMsg = (e.message || '').toLowerCase();
    let friendlyMsg;

    if (rawMsg.includes('quota') || rawMsg.includes('429') || rawMsg.includes('rate limit') || rawMsg.includes('quota_exceeded') || rawMsg.includes('quotafailure') || rawMsg.includes('exceeded')) {
      friendlyMsg = `⚠️ AI quota reached.\n\nPlease:\n• Try another model from the selector\n• Use Auto Fallback mode\n• Retry in a few minutes`;
    } else if (rawMsg.includes('invalid_api_key') || rawMsg.includes('authentication') || rawMsg.includes('401') || rawMsg.includes('api key')) {
      friendlyMsg = '🔑 Invalid API key. Please check your configuration.';
    } else if (rawMsg.includes('failed to fetch') || rawMsg.includes('networkerror') || rawMsg.includes('load failed') || rawMsg.includes('enotfound')) {
      friendlyMsg = '📡 No internet connection. Please check your network and try again.';
    } else if (rawMsg.includes('timeout') || rawMsg.includes('etimedout') || rawMsg.includes('timed out')) {
      friendlyMsg = '⏱ Request timed out. Please try again.';
    } else if (rawMsg.includes('model') && (rawMsg.includes('not found') || rawMsg.includes('unavailable'))) {
      friendlyMsg = '🤖 Selected model is temporarily unavailable. Try switching to Auto Fallback.';
    } else {
      friendlyMsg = '⚠️ Something went wrong. Please try again or switch models.';
    }

    bubble.innerHTML = `<div style="color:var(--danger);white-space:pre-line;line-height:1.6">${esc(friendlyMsg)}</div>`;
  }

  const metrics = finishChatRequestMetrics();
  if (metrics) {
    console.log(`[AI-REQ] id=${requestId} status=done totalCalls=${metrics.total} chat=${metrics.chat} embed=${metrics.embed} ocr=${metrics.ocr}`);
  }

  setStreaming(false);
  const sendBtnAfter = document.getElementById('send-btn');
  if (sendBtnAfter) {
    sendBtnAfter.disabled = !document.getElementById('input')?.value.trim();
  }
  const msgRow = bubble.closest('.msg-row');
  if (msgRow) {
    msgRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    const el = msgsEl();
    if (el) el.scrollTop = 99999;
  }
}

// ── CLEAR / EXPORT / PRINT ────────────────────────────────────────────────────

/**
 * Resets the chat interface, clearing the in-memory array and updating stats.
 */
export function clearChat() {
  closeMenu();
  if (!messages.length) {
    showToast('💬 Chat is already empty.');
    return;
  }
  messages.length = 0;
  const el = msgsEl();
  const activeDocs = docs.filter(d => d.selected !== false);
  const summarizeText = activeDocs.length > 1
    ? `Summarize all ${activeDocs.length} documents and give a separate summary for each one`
    : 'Summarize this document';
  if (el) {
    el.innerHTML = `
      <div class="welcome" id="welcome">
        <div class="welcome-glow">✦</div>
        <div class="welcome-title">InsightDocs AI</div>
        <div class="welcome-sub" id="welcome-desc">${docs.length ? docs.length + ' document' + (docs.length > 1 ? 's' : '') + ' ready. Ask me anything!' : ''}</div>
        <div class="welcome-chips">
          <div class="chip" onclick="window.chipClick('${summarizeText}')">📋 Summarize</div>
          <div class="chip" onclick="window.chipClick('What are the key points?')">🔑 Key Points</div>
          <div class="chip" onclick="window.chipClick('Explain the main topic')">💡 Explain</div>
          <div class="chip" onclick="window.chipClick('List all important dates')">📅 Dates &amp; Facts</div>
        </div>
      </div>`;
  }
  if (window.updateStats) window.updateStats();
  showToast('🗑 Chat cleared!');
}

/**
 * Exports the chat history to a downloaded text file.
 */
export function exportChat() {
  closeMenu();
  if (!messages.length) {
    showToast('📭 No chat to export.');
    return;
  }
  const lines = [
    `InsightDocs AI Export`,
    `Date: ${new Date().toLocaleString()}`,
    `Documents: ${docs.map(d => d.name).join(', ') || 'None'}`,
    '─'.repeat(50)
  ];
  messages.forEach(m => {
    lines.push(`\n[${m.role === 'user' ? 'YOU' : 'AI'}]`);
    lines.push(m.content);
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  a.download = `rag-chat-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  showToast('💾 Chat exported!');
}

/**
 * Prints the chat interface.
 */
export function printChat() {
  closeMenu();
  if (!messages.length) {
    showToast('🖨 No chat to print.');
    return;
  }
  window.print();
}

// Expose functions globally for onclick and console debugging
window.sendMessage = sendMessage;
window.clearChat = clearChat;
window.exportChat = exportChat;
window.printChat = printChat;
