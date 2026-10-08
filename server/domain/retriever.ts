import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface PolicyChunk {
  id: string;
  heading: string;
  text: string;
}
export interface Retrieved {
  chunk: PolicyChunk;
  score: number;
}

const STOPWORDS = new Set(
  (
    'a an the of and or to in on at for from by with is are was were be been it its this that these those i me my we you your ' +
    'do does did how what when where which who whom why can could should would will shall may might must not no yes if then ' +
    'than so as about into up down out over any some something anything have has had get got there their they them'
  ).split(/\s+/),
);

const MIN_SCORE = 1.2;
/** Terms present in most chunks (e.g. "item") carry no signal and would drown out the real keywords. */
const COMMON_TERM_RATIO = 0.7;

/** Very small stemmer: enough to match reject/rejected/rejecting without a dependency. */
function stem(word: string): string {
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOPWORDS.has(w) && w.length > 1).map(stem);
}

interface Index {
  chunks: PolicyChunk[];
  docFreq: Map<string, number>;
  termCounts: Map<string, number>[];
  headingTerms: Set<string>[];
}

let index: Index | undefined;

export function loadChunks(): PolicyChunk[] {
  return getIndex().chunks;
}

function getIndex(): Index {
  if (index) return index;
  const md = readFileSync(path.join(__dirname, '../../data/policy-note.md'), 'utf8');
  const chunks = md
    .split(/^## /m)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((section, i): PolicyChunk => {
      const [heading = '', ...rest] = section.split('\n');
      return { id: `policy-${i + 1}`, heading: heading.trim(), text: rest.join('\n').trim() };
    });

  const docFreq = new Map<string, number>();
  const termCounts = chunks.map((c) => {
    const counts = new Map<string, number>();
    for (const t of tokenize(`${c.heading} ${c.text}`)) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    return counts;
  });
  const headingTerms = chunks.map((c) => new Set(tokenize(c.heading)));
  index = { chunks, docFreq, termCounts, headingTerms };
  return index;
}

/**
 * Keyword/TF-IDF retrieval over a handful of in-memory chunks. Returns [] when nothing is
 * relevant so callers can refuse to answer rather than let the model improvise.
 */
export function retrieve(query: string, k = 3): Retrieved[] {
  const { chunks, docFreq, termCounts, headingTerms } = getIndex();
  const all = [...new Set(tokenize(query))];
  if (all.length === 0) return [];
  const n = chunks.length;
  const distinctive = all.filter((t) => (docFreq.get(t) ?? 0) / n <= COMMON_TERM_RATIO);
  const terms = distinctive.length > 0 ? distinctive : all;

  const scored = chunks.map((chunk, i): Retrieved => {
    let score = 0;
    for (const term of terms) {
      const tf = termCounts[i]?.get(term);
      if (!tf) continue;
      const idf = Math.log(1 + n / (docFreq.get(term) ?? 1));
      score += (1 + Math.log(tf)) * idf;
      if (headingTerms[i]?.has(term)) score += idf;
    }
    return { chunk, score };
  });

  return scored
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
