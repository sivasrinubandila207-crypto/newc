/**
 * @module chunking
 * @description Text chunking, vector index building, and query embedding.
 *
 * Quota optimizations:
 *  1. Session-level vector index cache  — skips re-embedding on page reload
 *  2. Skip-if-already-indexed guard     — docs restored from MongoDB skip embed entirely
 *  3. LRU query embedding cache         — repeated identical queries cost 0 API calls
 *  4. Structured [Embedding] logging    — shows Chunks / Batches / API Calls Saved
 */
import {
  CHUNK_SIZE_NORMAL, CHUNK_OVERLAP_NORMAL,
  CHUNK_SIZE_LARGE, CHUNK_OVERLAP_LARGE,
  LARGE_DOC_PAGE_THRESHOLD, MIN_CONTENT_LENGTH,
  EMBED_QUERY_CACHE_SIZE,
} from '../utils/constants.js';
import { apiFetch } from '../utils/api.js';
import { recordApiCall, debugState } from '../core/state.js';
import { diagnostic, warn, error, log } from '../utils/logger.js';


// ── SESSION-LEVEL VECTOR INDEX CACHE ──────────────────────────────────────────
// Key: doc fingerprint (name + pageCount + totalChars)
// Value: vectorIndex array
// Cleared on hard refresh automatically (module scope).
const _vectorCache = new Map();

/**
 * Computes a lightweight fingerprint for a document.
 * Used as cache key to detect whether a doc has already been embedded this session.
 * @param {Object} doc
 * @returns {string}
 */
function docFingerprint(doc) {
  const totalChars = (doc.text || '').length;
  return `${doc.name}||${doc.pages.length}||${totalChars}`;
}

// ── QUERY EMBEDDING LRU CACHE ─────────────────────────────────────────────────
// Avoids re-calling the embed API for repeated identical questions.
const _queryCache = new Map(); // query → vector

/**
 * Retrieves a cached query vector, or null if not cached.
 * Implements simple LRU eviction by size cap.
 * @param {string} query
 * @returns {number[]|null}
 */
function getCachedQuery(query) {
  const vec = _queryCache.get(query);
  if (vec) {
    // Refresh access order (move to end)
    _queryCache.delete(query);
    _queryCache.set(query, vec);
    return vec;
  }
  return null;
}

/**
 * Stores a query vector in the LRU cache, evicting oldest if full.
 * @param {string} query
 * @param {number[]} vec
 */
function setCachedQuery(query, vec) {
  if (_queryCache.size >= EMBED_QUERY_CACHE_SIZE) {
    // Delete the first (oldest) entry
    _queryCache.delete(_queryCache.keys().next().value);
  }
  _queryCache.set(query, vec);
}

// ── TEXT CHUNKING ─────────────────────────────────────────────────────────────

/**
 * Splits text into overlapping chunks for embedding.
 * @param {string} text
 * @param {number} [chunkSize=1200]
 * @param {number} [overlap=200]
 * @returns {string[]}
 */
export function chunkText(text, chunkSize = CHUNK_SIZE_NORMAL, overlap = CHUNK_OVERLAP_NORMAL) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

/**
 * Checks whether a page's extracted text has real content.
 * @param {string} t
 * @returns {boolean}
 */
export function isRealContent(t) {
  return Boolean(t && t.trim().length > MIN_CONTENT_LENGTH && !t.startsWith('[OCR') && !t.startsWith('[This page'));
}

/**
 * Detects known field types in extracted text (for diagnostic verification).
 * @param {string} text
 * @returns {Object}
 */
export function verifyExtractedFields(text) {
  const lower = (text || '').toLowerCase();
  return {
    candidateName: { label: 'Candidate Name', detected: /candidate|student|name|enroll/i.test(lower) },
    fatherName: { label: 'Father Name', detected: /father|parent|guardian|husband/i.test(lower) },
    seatNumber: { label: 'Seat Number', detected: /seat|roll|reg|symbol|enroll|hall\s*ticket/i.test(lower) },
    subjectMarks: { label: 'Subject Marks', detected: /marks|subject|obtained|grade|gpa|theory|practical/i.test(lower) },
    grandTotal: { label: 'Grand Total', detected: /total|aggregate|percentage|result/i.test(lower) },
  };
}

// ── VECTOR INDEX BUILDER ──────────────────────────────────────────────────────

/**
 * Builds a vector index for a document by:
 * 1. Checking session cache and existing vectorIndex (skip if already embedded)
 * 2. Chunking each page's text
 * 3. Sending all chunks in ONE batch to the embed API
 * 4. Attaching embedding vectors to each chunk
 *
 * Also populates `debugState.lastDocument` with diagnostic metadata.
 *
 * @param {Object} doc - Document object (mutated: doc.vectorIndex is set)
 * @returns {Promise<void>}
 * @throws {Error} If embedding fails
 */
export async function buildVectorIndex(doc) {
  const fp = docFingerprint(doc);

  // ── GUARD 1: already-indexed docs (restored from MongoDB) ──
  if (doc.vectorIndex && doc.vectorIndex.length > 0) {
    log('Embedding', `Skipped — vectorIndex already present (${doc.vectorIndex.length} chunks) for "${doc.name}"`);
    _vectorCache.set(fp, doc.vectorIndex); // Seed the session cache too
    _buildDebugMetadata(doc, {});
    return;
  }

  // ── GUARD 2: session cache hit ──
  if (_vectorCache.has(fp)) {
    const cached = _vectorCache.get(fp);
    doc.vectorIndex = cached;
    log('Embedding', `Session cache hit — restored ${cached.length} chunks for "${doc.name}" (0 API calls)`);
    _buildDebugMetadata(doc, {});
    return;
  }

  // ── BUILD CHUNKS ──
  const isLargeDoc = doc.pages.length > LARGE_DOC_PAGE_THRESHOLD;
  const chunkSize = isLargeDoc ? CHUNK_SIZE_LARGE : CHUNK_SIZE_NORMAL;
  const overlap = isLargeDoc ? CHUNK_OVERLAP_LARGE : CHUNK_OVERLAP_NORMAL;

  const chunks = [];
  const chunksPerPage = {};

  doc.pages.forEach((pageText, pi) => {
    chunksPerPage[pi + 1] = 0;
    if (!isRealContent(pageText)) {
      diagnostic(`Page ${pi + 1} skipped from chunking (not real content)`);
      return;
    }
    const pageChunks = chunkText(pageText, chunkSize, overlap);
    chunksPerPage[pi + 1] = pageChunks.length;
    diagnostic(`Page ${pi + 1}: ${pageChunks.length} chunks`);
    pageChunks.forEach((chunk, ci) => {
      chunks.push({ text: chunk, source: doc.name, page: pi + 1, chunkIndex: ci });
    });
  });

  _buildDebugMetadata(doc, chunksPerPage);

  if (!chunks.length) {
    log('Embedding', `No chunks generated for "${doc.name}" — skipping embed API call`);
    return;
  }

  // Backend batches 100 chunks per Gemini batchEmbedContents call.
  // Frontend makes exactly ONE fetch to /api/embed regardless of chunk count.
  const estimatedBatches = Math.ceil(chunks.length / 100);
  log('Embedding', `"${doc.name}" — Chunks: ${chunks.length}, Batches: ${estimatedBatches}, API Calls: 1`);

  try {
    recordApiCall('embed');
    const data = await apiFetch('/api/embed', {
      method: 'POST',
      body: JSON.stringify({ texts: chunks.map(c => c.text) }),
    });

    if (data.embeddings) {
      doc.vectorIndex = chunks.map((chunk, i) => ({ ...chunk, vector: data.embeddings[i] }));
      diagnostic(`VectorIndex: ${doc.vectorIndex.length} chunks for "${doc.name}"`);

      // Seed session cache so reprocessing the same doc costs 0 additional API calls
      _vectorCache.set(fp, doc.vectorIndex);
      log('Embedding', `Cached ${doc.vectorIndex.length} chunk vectors for "${doc.name}"`);
    } else {
      throw new Error(data.error || 'Embed API returned no embeddings');
    }
  } catch (err) {
    error('VectorIndex', `Failed to build index for "${doc.name}":`, err.message);
    const isQuota = /quota|exceeded|429/i.test(err.message);
    if (isQuota) throw new Error('QUOTA_EXCEEDED: Embedding quota exceeded. Try again later or switch to Full Context mode.');
    throw err;
  }
}


/**
 * Embeds a single query string via the embed API.
 * Uses an LRU cache to avoid re-calling the API for repeated identical questions.
 * @param {string} query
 * @returns {Promise<number[]|null>} Embedding vector or null on failure
 */
export async function embedQuery(query) {
  // ── CACHE HIT ──
  const cached = getCachedQuery(query);
  if (cached) {
    diagnostic(`[Embed] Query cache hit — 0 API calls for: "${query.slice(0, 40)}…"`);
    return cached;
  }

  try {
    recordApiCall('embed');
    const data = await apiFetch('/api/embed', {
      method: 'POST',
      body: JSON.stringify({ texts: [query] }),
    });
    const vec = data.embeddings?.[0] || null;
    if (vec) setCachedQuery(query, vec);
    return vec;
  } catch (err) {
    warn('embedQuery', err.message);
    return null;
  }
}


// ── PRIVATE: Build debug metadata ─────────────────────────────────────────────

function _buildDebugMetadata(doc, chunksPerPage) {
  const rollRegex = /\b\d{2}[A-Za-z\d]{3}[A-Za-z\d]{2}\d{3}\b/g;
  let totalChars = 0, totalWords = 0;
  const allRolls = [];
  const rollNumbersPerPage = {};

  doc.pages.forEach((pageText, pi) => {
    totalChars += pageText.length;
    totalWords += pageText.split(/\s+/).filter(Boolean).length;
    const rolls = [...new Set((pageText.match(rollRegex) || []))];
    rollNumbersPerPage[pi + 1] = rolls;
    allRolls.push(...rolls);
  });

  const fieldsVerification = verifyExtractedFields(doc.text);
  const missingFields = Object.values(fieldsVerification).filter(f => !f.detected).map(f => f.label);
  if (missingFields.length > 0) warn('Verification', `Missing fields: ${missingFields.join(', ')}`);

  // Merge chunksPerPage from this call or from existing vectorIndex
  const effectiveChunksPerPage = Object.keys(chunksPerPage).length
    ? chunksPerPage
    : (doc.vectorIndex || []).reduce((acc, c) => {
        acc[c.page] = (acc[c.page] || 0) + 1;
        return acc;
      }, {});

  debugState.lastDocument = {
    name: doc.name,
    pagesCount: doc.pages.length,
    totalChars,
    totalWords,
    allRolls: [...new Set(allRolls)],
    rollNumbersPerPage,
    chunksPerPage: effectiveChunksPerPage,
    totalChunks: doc.vectorIndex?.length || 0,
    embeddingModelUsed: 'gemini-embedding-2',
    nativeRollsCount: doc.nativeRollsCount || 0,
    processedRollsCount: doc.processedRollsCount || [...new Set(allRolls)].length,
    fieldsVerification,
    pages: doc.pages.map((text, pi) => ({
      pageNum: pi + 1,
      charCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      textPreview: text.slice(0, 1000),
      fullText: text,
      confidence: (doc.pageConfidences?.[pi] !== undefined) ? doc.pageConfidences[pi] : 100,
      skipped: !isRealContent(text),
      skippedReason: !text ? 'Empty' : text.trim().length <= 30 ? `Only ${text.trim().length} chars` : text.startsWith('[OCR') ? 'OCR error' : '',
    })),
  };

  if (typeof window.renderDebugPanel === 'function') window.renderDebugPanel();
}
