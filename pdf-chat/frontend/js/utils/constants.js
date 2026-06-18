/**
 * @module constants
 * @description Single source of truth for all application-wide constants.
 */

// ── FILE / SIZE ──
export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (Base64 ≈ 13.3 MB → under 16 MB MongoDB cap)

// ── USAGE ──
export const DAILY_LIMIT = 14400;

// ── RETRIEVAL / RAG ──
export const MAX_RAG_CHUNKS = 6;
export const RAG_SIMILARITY_THRESHOLD = 0.35; // Minimum cosine similarity to include a chunk (lowered from 0.50 to improve scanned/OCR retrieval)
export const OVERLAP_DEDUP_THRESHOLD = 0.80;  // 80% text overlap → treat as duplicate chunk
export const SMALL_DOC_CHAR_LIMIT = 15000;    // Docs below this with no vector index → full-context fallback

// ── EMBEDDING CACHE ──
export const EMBED_QUERY_CACHE_SIZE = 20;     // Max number of unique query vectors to cache in LRU

// ── CHUNKING ──
export const CHUNK_SIZE_NORMAL = 1200;
export const CHUNK_OVERLAP_NORMAL = 200;
export const CHUNK_SIZE_LARGE = 2500;
export const CHUNK_OVERLAP_LARGE = 100;
export const LARGE_DOC_PAGE_THRESHOLD = 40;
export const MIN_CONTENT_LENGTH = 30;         // Below this → page is considered empty/skipped

// ── CITATIONS ──
export const MAX_CITATION_PAGES = 3;

// ── OCR ──
export const OCR_LOW_DENSITY_THRESHOLD = 1200; // chars/page below which OCR is triggered
export const OCR_CONCURRENCY = 3;              // Parallel Tesseract workers

// ── AI MODELS ──
export const MODEL_LABELS = {
  'auto-fallback': '🚀 Auto Fallback',
  'llama-3.3-70b-versatile': 'Llama 3.3 70B',
  'llama-3.1-8b-instant': 'Llama 3.1 8B (Fast)',
  'gemini-2.5-flash': 'Gemini 2.5 Flash ⭐️',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3-flash-preview': 'Gemini 3 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
  'gemma-4-26b-a4b-it': 'Gemma 4 26B',
  'gemma-4-31b-it': 'Gemma 4 31B',
  'gemini-2.5-flash-preview-tts': 'Gemini 2.5 Flash TTS',
  'gemini-3.1-flash-tts-preview': 'Gemini 3.1 Flash TTS',
  'gemini-3-flash-live': 'Gemini 3 Flash Live',
  'gemini-2.5-flash-native-audio-dialog': 'Gemini 2.5 Flash Native Audio Dialog',
  'gemini-3.5-live-translate': 'Gemini 3.5 Live Translate',
};

export const LIVE_MODELS = new Set([
  'gemini-3-flash-live',
  'gemini-2.5-flash-native-audio-dialog',
  'gemini-3.5-live-translate',
]);

/** Response style instructions appended to the LLM system prompt. */
export const RESPONSE_STYLE_HINTS = {
  short: 'Respond in 2-3 sentences only.',
  detailed: 'Respond with a thorough, detailed explanation.',
  bullets: 'Respond using clear bullet points.',
  normal: '',
};

/**
 * Core LLM behaviour rules injected into every system prompt.
 * Eliminates unnecessary greetings, closings, and filler phrases.
 */
export const SYSTEM_RULES = [
  'RESPONSE RULES:',
  '- Answer directly. Do NOT start with greetings like "Great question!", "Sure!", or "Of course!".',
  '- Do NOT end with filler like "Hope that helps!", "Feel free to ask more questions!", or "I\'m glad I could help.".',
  '- Maintain a professional, factual tone throughout.',
  '- Be concise for general questions, but provide a complete and thorough summary/section for each active document when summarizing is requested.',
  '- Use citations only when available (do not cite anything if not using document excerpts).',
  '- When citing document content, use the format [DocName — Page N].',
  '- Never fabricate information not present in the provided document excerpts.',
].join('\n');
