/**
 * @module citations
 * @description Improved source citation logic.
 *
 * Key improvements over the original:
 *  - Maximum 3 pages shown
 *  - Pages deduplicated and sorted ascending
 *  - Compact display: "Page 1" / "Pages 1, 3" / "Pages 1, 3, 5 (+2 more)"
 *  - Expandable "+N more" on click
 *  - Mobile chip format: small [Page N] badges
 */
import { MAX_CITATION_PAGES } from '../utils/constants.js';
import { esc } from '../utils/helpers.js';

/**
 * Parses a citation string of the form "DocName p.N" into its components.
 * @param {string} c - Citation string e.g. "report.pdf p.3"
 * @returns {{ docName: string, pageNum: number } | null}
 */
export function parseCitationString(c) {
  const parts = c.split(' p.');
  const docName = parts[0];
  const pageNum = parts[1] ? parseInt(parts[1]) : null;
  if (docName && pageNum !== null && !isNaN(pageNum)) return { docName, pageNum };
  return null;
}

/**
 * Extracts page citations from AI response text and active documents.
 * Looks for patterns like "[DocName — Page N]", "DocName p.N", etc.
 *
 * @param {string} text - AI response text
 * @param {Array<Object>} activeDocs - Currently active document objects
 * @returns {Array<{ docName: string, pageNum: number }>}
 */
export function extractCitationsFromText(text, activeDocs, retrievedCitations = []) {
  const cited = [];
  const seen = new Set();
  if (!activeDocs?.length) return cited;

  // Build a lookup map of retrieved pages for matching generic page numbers
  const retrievedMap = new Map();
  retrievedCitations.forEach(c => {
    const parsed = parseCitationString(c);
    if (parsed) {
      if (!retrievedMap.has(parsed.docName)) retrievedMap.set(parsed.docName, new Set());
      retrievedMap.get(parsed.docName).add(parsed.pageNum);
    }
  });


  activeDocs.forEach(d => {
    // We want to match:
    // 1. Full name: e.g. "Seating Plan.pdf"
    // 2. Name without extension: e.g. "Seating Plan"
    // 3. Name with PDF: e.g. "Seating Plan PDF"
    const nameWithoutExt = d.name.replace(/\.[^/.]+$/, "");
    const namesToTry = [d.name, nameWithoutExt, `${nameWithoutExt} PDF`].map(n => n.trim());
    const uniqueNames = [...new Set(namesToTry)];

    uniqueNames.forEach(name => {
      const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regexes = [
        new RegExp(`${escapedName}\\s*[-—,:(]?\\s*(?:Page|p\\.?|p\\b|pages?)\\s*(\\d+)\\b`, 'gi'),
        new RegExp(`\\[${escapedName}\\s*—\\s*Page\\s*(\\d+)\\]`, 'gi'),
        new RegExp(`\\[${escapedName}\\s*p\\.?\\s*(\\d+)\\]`, 'gi'),
        new RegExp(`${escapedName}\\s*p\\.?\\s*(\\d+)\\b`, 'gi'),
      ];
      regexes.forEach(regex => {
        let match;
        while ((match = regex.exec(text)) !== null) {
          const pageNum = parseInt(match[1]);
          if (pageNum > 0 && pageNum <= d.pages.length) {
            const key = `${d.name}||${pageNum}`;
            if (!seen.has(key)) {
              seen.add(key);
              cited.push({ docName: d.name, pageNum });
            }
          }
        }
      });
    });
  });

  // Fallback: generic "Page N" pattern
  const pageRegex = /\b(?:Page|p\.|p)\s*(\d+)\b/gi;
  let match;
  while ((match = pageRegex.exec(text)) !== null) {
    const pageNum = parseInt(match[1]);
    
    // Check if this generic match is inside brackets matching a specific document citation
    // (e.g. [Notice Board... — Page 1]). If so, skip it as the specific regexes already handled it.
    const matchIndex = match.index;
    const textBefore = text.slice(Math.max(0, matchIndex - 150), matchIndex);
    const textAfter = text.slice(matchIndex, matchIndex + 50);
    const lastOpenBracket = textBefore.lastIndexOf('[');
    const lastCloseBracket = textBefore.lastIndexOf(']');
    const firstCloseBracket = textAfter.indexOf(']');
    const firstOpenBracket = textAfter.indexOf('[');
    
    let isInsideSpecificCitation = false;
    if (lastOpenBracket > lastCloseBracket && (firstCloseBracket !== -1 && (firstOpenBracket === -1 || firstCloseBracket < firstOpenBracket))) {
      const bracketContent = textBefore.slice(lastOpenBracket + 1) + textAfter.slice(0, firstCloseBracket);
      isInsideSpecificCitation = activeDocs.some(d => {
        const nameWithoutExt = d.name.replace(/\.[^/.]+$/, "");
        return bracketContent.toLowerCase().includes(d.name.toLowerCase()) || 
               bracketContent.toLowerCase().includes(nameWithoutExt.toLowerCase());
      });
    }
    
    if (isInsideSpecificCitation) {
      continue;
    }
    
    // Scenario 1: Only 1 active document
    if (activeDocs.length === 1) {
      const d = activeDocs[0];
      if (pageNum > 0 && pageNum <= d.pages.length) {
        const key = `${d.name}||${pageNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          cited.push({ docName: d.name, pageNum });
        }
      }
    }
    // Scenario 2: Multiple documents - correlate with retrieved chunks
    else {
      activeDocs.forEach(d => {
        const isRetrieved = retrievedMap.get(d.name)?.has(pageNum);
        if (isRetrieved && pageNum > 0 && pageNum <= d.pages.length) {
          const key = `${d.name}||${pageNum}`;
          if (!seen.has(key)) {
            seen.add(key);
            cited.push({ docName: d.name, pageNum });
          }
        }
      });
    }
  }

  return deduplicateSources(cited);
}

/**
 * Deduplicates and sorts cited sources by page number.
 * @param {Array<{ docName: string, pageNum: number }>} citedSources
 * @returns {Array<{ docName: string, pageNum: number }>}
 */
export function deduplicateSources(citedSources) {
  const seen = new Set();
  return citedSources.filter(s => {
    const key = `${s.docName}||${s.pageNum}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.pageNum - b.pageNum);
}

/**
 * Builds a compact citation line for injection into the AI response text.
 * Examples: "Page 1" / "Pages 1, 3" / "Pages 1, 3, 5 (+2 more)"
 *
 * @param {Array<{ docName: string, pageNum: number }>} citedSources
 * @returns {string} Citation line text (empty if no sources)
 */
export function buildCitationLine(citedSources) {
  if (!citedSources.length) return '';
  const unique = deduplicateSources(citedSources);
  const pages = [...new Set(unique.map(s => s.pageNum))].sort((a, b) => a - b);

  if (pages.length === 0) return '';
  const shown = pages.slice(0, MAX_CITATION_PAGES);
  const rest = pages.length - MAX_CITATION_PAGES;
  const pageStr = shown.length === 1 ? `Page ${shown[0]}` : `Pages ${shown.join(', ')}`;
  return `📄 Source: ${pageStr}${rest > 0 ? ` (+${rest} more)` : ''}`;
}

/**
 * Builds the HTML for source citation cards shown below an AI response.
 * Shows max MAX_CITATION_PAGES cards; remaining are collapsible.
 * On mobile: renders compact chip badges instead of full cards.
 *
 * @param {Array<{ docName: string, pageNum: number }>} citedSources
 * @param {string} confidence - 'High' | 'Medium' | 'Low'
 * @returns {string} HTML string for the sources container
 */
export function buildSourceCardsHtml(citedSources, confidence) {
  const unique = deduplicateSources(citedSources);
  const displayConf = confidence || 'High';
  const footerHtml = `
    <div class="answer-footer">
      <span style="display:flex;align-items:center;gap:4px">
        Confidence: <strong class="conf-badge ${displayConf.toLowerCase()}">${displayConf}</strong>
      </span>
    </div>`;

  if (!unique.length) {
    return `<div class="sources-used-container">${footerHtml}</div>`;
  }

  const isMulti = unique.length > 1 || new Set(unique.map(s => s.docName)).size > 1;
  const titleText = isMulti ? 'Sources Used' : 'Source Used';

  const shown = unique.slice(0, MAX_CITATION_PAGES);
  const hidden = unique.slice(MAX_CITATION_PAGES);
  const extraCount = hidden.length;

  const cardHtml = (s) => `
    <div class="source-card" onclick="window.viewPage('${esc(s.docName)}', ${s.pageNum})">
      <span class="source-card-doc" title="${esc(s.docName)}">📄 ${esc(s.docName)}</span>
      <span class="source-card-page">Page ${s.pageNum}</span>
    </div>`;

  const hiddenId = `hidden-sources-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

  const moreBtn = extraCount > 0
    ? `<button class="source-more-btn" onclick="
        var el=document.getElementById('${hiddenId}');
        var btn=this;
        if(el.style.display==='none'){el.style.display='flex';btn.textContent='Show less';}
        else{el.style.display='none';btn.textContent='+${extraCount} more';}
      ">+${extraCount} more</button>`
    : '';

  const hiddenCards = extraCount > 0
    ? `<div id="${hiddenId}" class="sources-grid" style="display:none">${hidden.map(cardHtml).join('')}</div>`
    : '';

  return `
    <div class="sources-used-container">
      <div class="sources-used-title">${titleText}</div>
      <div class="sources-grid">${shown.map(cardHtml).join('')}</div>
      ${moreBtn}
      ${hiddenCards}
      ${footerHtml}
    </div>`;
}
