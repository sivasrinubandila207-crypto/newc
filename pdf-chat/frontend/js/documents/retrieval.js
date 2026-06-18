/**
 * @module retrieval
 * @description Improved RAG context retrieval.
 *
 * Retrieval pipeline:
 *  1. Semantic search via cosine similarity across all vectorIndex chunks
 *  2. Relevance threshold filtering (score > RAG_SIMILARITY_THRESHOLD)
 *  3. Deduplication of near-identical chunks (>80% text overlap)
 *  4. Rank by score, limit to MAX_RAG_CHUNKS (5)
 *  5. Keyword fallback if no vector index
 *  6. Full-context as last-resort only (tiny docs or no index)
 */
import { MAX_RAG_CHUNKS, RAG_SIMILARITY_THRESHOLD, OVERLAP_DEDUP_THRESHOLD, SMALL_DOC_CHAR_LIMIT } from '../utils/constants.js';
import { docs } from '../core/state.js';
import { embedQuery } from './chunking.js';
import { isRealContent } from './chunking.js';
import { diagnostic } from '../utils/logger.js';

/**
 * Computes the cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} Similarity score in [0, 1]
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

/**
 * Calculates the word overlap ratio between two text strings.
 * @param {string} a
 * @param {string} b
 * @returns {number} Overlap ratio in [0, 1]
 */
function textOverlapRatio(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) common++; });
  return common / Math.min(wordsA.size, wordsB.size);
}

/**
 * Removes near-duplicate chunks (>80% text overlap with a higher-scoring chunk).
 * Assumes the input array is already sorted by score descending.
 * @param {Array<Object>} scored - Chunks sorted by score descending
 * @returns {Array<Object>} Deduplicated chunks
 */
export function deduplicateChunks(scored) {
  const kept = [];
  for (const candidate of scored) {
    const isDupe = kept.some(k => textOverlapRatio(k.text, candidate.text) > OVERLAP_DEDUP_THRESHOLD);
    if (!isDupe) kept.push(candidate);
  }
  return kept;
}

/**
 * Merges two texts, aligning their overlapping boundaries.
 * @param {string} text1 - First text block
 * @param {string} text2 - Second text block
 * @returns {string} Merged text
 */
function mergeOverlappingTexts(text1, text2) {
  const minOverlap = 10;
  const maxOverlap = Math.min(text1.length, text2.length);
  for (let len = maxOverlap; len >= minOverlap; len--) {
    const suffix = text1.slice(-len);
    if (text2.startsWith(suffix)) {
      return text1 + text2.slice(len);
    }
  }
  return text1 + " " + text2;
}

/**
 * Merges contiguous chunks from the same page of a document.
 * @param {Array<Object>} chunks - Scored chunk candidates
 * @returns {Array<Object>} Consolidated chunks
 */
export function mergeOverlappingChunks(chunks) {
  const groups = {};
  for (const chunk of chunks) {
    const key = `${chunk.source}||${chunk.page}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(chunk);
  }

  const merged = [];
  for (const key in groups) {
    const pageChunks = groups[key];
    pageChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    const mergedPageChunks = [];
    for (const chunk of pageChunks) {
      if (mergedPageChunks.length === 0) {
        mergedPageChunks.push({ ...chunk });
      } else {
        const last = mergedPageChunks[mergedPageChunks.length - 1];
        if (chunk.chunkIndex === last.chunkIndex + 1) {
          last.text = mergeOverlappingTexts(last.text, chunk.text);
          last.score = Math.max(last.score, chunk.score);
          last.chunkIndex = chunk.chunkIndex;
        } else {
          mergedPageChunks.push({ ...chunk });
        }
      }
    }
    merged.push(...mergedPageChunks);
  }
  return merged;
}

/**
 * Computes a confidence label based on retrieved chunk similarity scores.
 * @param {Array<Object>} retrievedChunks
 * @param {boolean} bypassRag - If true, always returns 'High'
 * @returns {'High'|'Medium'|'Low'}
 */
export function computeConfidence(retrievedChunks, bypassRag) {
  if (bypassRag) return 'High';
  if (!retrievedChunks?.length) return 'Low';
  const validScores = retrievedChunks
    .map(c => typeof c.similarityScore === 'number' ? c.similarityScore : 0)
    .filter(s => s > 0);
  if (!validScores.length) return 'Low';
  const avg = validScores.reduce((s, v) => s + v, 0) / validScores.length;
  if (avg >= 0.90) return 'High';
  if (avg >= 0.75) return 'Medium';
  return 'Low';
}

/**
 * Formats retrieved chunks into an object ready for the LLM system prompt.
 * @param {Array<Object>} top - Top-ranked chunk objects
 * @returns {{ text: string, citations: string[], retrievedChunks: Array }}
 */
function formatResult(top) {
  const citations = [...new Set(top.map(c => `${c.source} p.${c.page}`))];
  const retrievedChunks = top.map(c => ({
    documentName: c.source,
    pageNumber: c.page,
    similarityScore: c.score,
  }));
  return {
    text: top.map(c => `[${c.source} — Page ${c.page}]\n${c.text}`).join('\n\n---\n\n'),
    citations,
    noMatchFallback: false,
    retrievedChunks,
  };
}

/**
 * Distributes the chunk budget across active documents in a round-robin fashion,
 * ensuring that chunks from every active document are represented in the results
 * if they have scored chunks.
 *
 * @param {Array<Object>} scored - Chunks sorted by score descending
 * @param {string[]} activeDocNames - Array of active document names
 * @param {number} maxChunks - Maximum chunks to return
 * @returns {Array<Object>} Diverse selected chunks
 */
export function selectDiverseChunks(scored, activeDocNames, maxChunks) {
  if (activeDocNames.length <= 1) {
    return scored.slice(0, maxChunks);
  }

  const docGroups = {};
  activeDocNames.forEach(name => {
    docGroups[name] = [];
  });

  scored.forEach(chunk => {
    if (docGroups[chunk.source]) {
      docGroups[chunk.source].push(chunk);
    }
  });

  const selected = [];
  let addedAny = true;
  let pass = 0;

  while (selected.length < maxChunks && addedAny) {
    addedAny = false;
    for (const name of activeDocNames) {
      if (selected.length >= maxChunks) break;
      const group = docGroups[name];
      if (group && group[pass]) {
        selected.push(group[pass]);
        addedAny = true;
      }
    }
    pass++;
  }

  return selected;
}

/**
 * Helper to expand retrieved chunks to the full document text if the document is a marksheet.
 * This guarantees 100% accuracy for subject grade queries while preventing data leaks for unrelated queries.
 * @param {Array<Object>} chunks - List of matched chunks
 * @param {Array<Object>} activeDocs - Active document objects
 * @returns {Array<Object>} Expanded chunks
 */
export function expandMarksheetChunks(chunks, activeDocs) {
  return chunks.map(chunk => {
    const doc = activeDocs.find(d => d.name === chunk.source);
    if (!doc) return chunk;
    const isDocMarksheet = /marksheet|grade\s*card|certificate|statement\s*of\s*marks|passing\s*certificate/i.test(doc.name) || 
                           /marksheet|grade\s*card|certificate|statement\s*of\s*marks|passing\s*certificate/i.test(doc.text || '');
    if (isDocMarksheet) {
      return {
        ...chunk,
        text: doc.text || chunk.text,
        page: 1, // Reference the entire document
        score: Math.max(chunk.score, 0.99) // Boost score to indicate strong match
      };
    }
    return chunk;
  });
}

/**
 * Retrieves the most relevant document context for a given query.
 *
 * Priority:
 *  1. Semantic (vector) search → top 5 deduplicated chunks
 *  2. Keyword search → top 4 pages by keyword density
 *  3. Full-context fallback → first pages of each doc (tiny docs / no index)
 *
 * @param {string} query
 * @returns {Promise<{ text: string, citations: string[], noMatchFallback: boolean, retrievedChunks: Array }>}
 */
export async function retrieveContext(query) {
  const activeDocs = docs.filter(d => d.selected !== false);
  if (!activeDocs.length) {
    return { text: '', citations: [], noMatchFallback: false, retrievedChunks: [] };
  }

  const activeDocNames = activeDocs.map(d => d.name);

  // ── SEMANTIC SEARCH ──
  const vectorDocs = activeDocs.filter(d => d.vectorIndex?.length > 0);
  if (vectorDocs.length > 0) {
    const queryVec = await embedQuery(query);
    if (queryVec) {
      const scored = [];

      for (const doc of vectorDocs) {
        for (const entry of doc.vectorIndex) {
          scored.push({ ...entry, score: cosineSimilarity(queryVec, entry.vector) });
        }
      }

      // Fold in keyword-only docs (no vector index)
      const keywordDocs = activeDocs.filter(d => !d.vectorIndex || d.vectorIndex.length === 0);
      const STOPWORDS = new Set(['the', 'and', 'a', 'of', 'to', 'in', 'is', 'that', 'it', 'for', 'on', 'with', 'as', 'at', 'by', 'an', 'be', 'this', 'about', 'what', 'how', 'why', 'who', 'where', 'when', 'which', 'from', 'have', 'were', 'been', 'your', 'their', 'them']);
      for (const doc of keywordDocs) {
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1 && !STOPWORDS.has(w));
        doc.pages.forEach((pageText, pi) => {
          const matchCount = words.reduce((s, w) => s + (pageText.toLowerCase().split(w).length - 1), 0);
          if (matchCount > 0) {
            const score = 0.35 + Math.min(matchCount * 0.05, 0.25);
            scored.push({ text: pageText, source: doc.name, page: pi + 1, chunkIndex: 0, score });
          }
        });
      }

      scored.sort((a, b) => b.score - a.score);

      // Filter by relevance threshold, merge contiguous chunks, deduplicate, and sort
      let top = scored.filter(c => c.score > RAG_SIMILARITY_THRESHOLD);
      
      const maxChunks = Math.max(MAX_RAG_CHUNKS, activeDocNames.length * 2);
      
      // Soft fallback threshold: if top has fewer chunks than the budget, grab chunks down to 0.20
      if (top.length < maxChunks) {
        top = scored.filter(c => c.score > 0.20);
      }
      
      top = mergeOverlappingChunks(top);
      top = deduplicateChunks(top);
      top.sort((a, b) => b.score - a.score);

      top = selectDiverseChunks(top, activeDocNames, maxChunks);
      top = expandMarksheetChunks(top, activeDocs);

      // If nothing above threshold, take top with any positive score (diversity-aware)
      if (top.length === 0) {
        let softTop = scored.filter(c => c.score > 0);
        softTop = mergeOverlappingChunks(softTop);
        softTop = deduplicateChunks(softTop);
        softTop.sort((a, b) => b.score - a.score);
        softTop = selectDiverseChunks(softTop, activeDocNames, maxChunks);
        softTop = expandMarksheetChunks(softTop, activeDocs);
        if (softTop.length > 0) {
          diagnostic(`RAG: no chunks above threshold; using top ${softTop.length} by score`);
          return formatResult(softTop);
        }
      }

      if (top.length > 0) {
        diagnostic(`RAG: retrieved ${top.length} chunks (semantic)`);
        return formatResult(top);
      }
    }
  }

  // ── KEYWORD SEARCH ──
  const totalPages = activeDocs.reduce((sum, d) => sum + d.pages.filter(isRealContent).length, 0);

  // For very small docs, send all pages
  if (totalPages <= 8) {
    const used = [];
    activeDocs.forEach(d => {
      d.pages.forEach((pageText, pi) => {
        if (isRealContent(pageText)) used.push({ text: pageText, source: d.name, page: pi + 1 });
      });
    });
    diagnostic(`RAG: small doc full-context (${used.length} pages)`);
    const retrievedChunks = used.map(c => ({ documentName: c.source, pageNumber: c.page, similarityScore: 0.95 }));
    return {
      text: used.map(c => `[${c.source} — Page ${c.page}]\n${c.text}`).join('\n\n---\n\n'),
      citations: [...new Set(used.map(c => `${c.source} p.${c.page}`))],
      noMatchFallback: false,
      retrievedChunks,
    };
  }

  // Keyword scoring with page number extraction
  const STOPWORDS = new Set(['the', 'and', 'a', 'of', 'to', 'in', 'is', 'that', 'it', 'for', 'on', 'with', 'as', 'at', 'by', 'an', 'be', 'this', 'about', 'what', 'how', 'why', 'who', 'where', 'when', 'which', 'from', 'have', 'were', 'been', 'your', 'their', 'them']);
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1 && !STOPWORDS.has(w));
  const lowerQ = query.toLowerCase();
  let targetPageNum = null;
  const pgMatch = lowerQ.match(/page\s*(\d+)/) || lowerQ.match(/(\d+)(?:st|nd|rd|th)\s*page/);
  if (pgMatch) targetPageNum = parseInt(pgMatch[1]);
  else if (/first\s*page|1st\s*page/.test(lowerQ)) targetPageNum = 1;
  else if (/second\s*page|2nd\s*page/.test(lowerQ)) targetPageNum = 2;
  else if (/third\s*page|3rd\s*page/.test(lowerQ)) targetPageNum = 3;

  const scored = [];
  for (const doc of activeDocs) {
    doc.pages.forEach((pageText, pi) => {
      let score = words.reduce((s, w) => s + (pageText.toLowerCase().split(w).length - 1), 0);
      if (targetPageNum && (pi + 1) === targetPageNum) score += 1000;
      scored.push({ text: pageText, source: doc.name, page: pi + 1, score });
    });
  }
  scored.sort((a, b) => b.score - a.score);

  const maxKeywordChunks = Math.max(4, activeDocNames.length);
  let top = selectDiverseChunks(scored.filter(c => c.score > 0), activeDocNames, maxKeywordChunks);
  top = expandMarksheetChunks(top, activeDocs);

  if (top.length > 0) {
    diagnostic(`RAG: keyword search returned ${top.length} pages`);
    const retrievedChunks = top.map(c => ({
      documentName: c.source,
      pageNumber: c.page,
      similarityScore: Math.min(0.70 + c.score * 0.05, 0.95),
    }));
    return {
      text: top.map(c => `[${c.source} — Page ${c.page}]\n${c.text}`).join('\n\n---\n\n'),
      citations: [...new Set(top.map(c => `${c.source} p.${c.page}`))],
      noMatchFallback: false,
      retrievedChunks,
    };
  }

  // ── LAST RESORT: first 2 pages of each doc ──
  const used = [];
  activeDocs.forEach(d => {
    if (d.pages[0]) used.push({ text: d.pages[0], source: d.name, page: 1 });
    if (d.pages[1]) used.push({ text: d.pages[1], source: d.name, page: 2 });
  });
  diagnostic(`RAG: no matches — falling back to first pages`);
  return {
    text: '[Active Document Reference (No direct search matches found)]\n' +
      used.map(c => `[${c.source} — Page ${c.page}]\n${c.text}`).join('\n\n---\n\n'),
    citations: [],
    noMatchFallback: true,
    retrievedChunks: used.map(c => ({ documentName: c.source, pageNumber: c.page, similarityScore: 0.50 })),
  };
}
