// Offline dictionary used to validate every OCR / typed word before it can be taught.
const fs = require('fs');
const path = require('path');

let D = null, L = null, LOWER = null, PHRASES = null;

function load() {
  if (D) return;
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'dict.json'), 'utf8'));
  D = raw.d; L = raw.l; LOWER = new Map();
  for (const k of Object.keys(D)) {
    const lk = k.toLowerCase();
    if (LOWER.has(lk)) LOWER.get(lk).push(k); else LOWER.set(lk, [k]);
  }
  // multi-word entries taught in the built-in books ("ice cream", "next to")
  PHRASES = new Map();
  const bank = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'wordbank.json'), 'utf8'));
  for (const b of bank.books) for (const e of b.words) if (e.w.includes(' ')) PHRASES.set(e.w.toLowerCase(), { w: e.w, p: e.p, m: e.m });
}

const entry = (w) => ({ w, p: D[w][0], m: D[w][1], rank: D[w][2] });

// Returns {w,p,m,rank,base?} or null when the word is not a known English word.
function lookup(token) {
  load();
  const t = String(token || '').trim().replace(/’/g, "'");
  if (!t) return null;
  if (D[t]) return entry(t);
  const lk = t.toLowerCase();
  const vs = LOWER.get(lk);
  if (vs) return entry(vs.includes(lk) ? lk : vs[0]);
  if (PHRASES && PHRASES.has(lk)) return { ...PHRASES.get(lk), rank: 0 };
  const base = L[lk];
  if (base && D[base]) {
    const e = entry(base);
    return { w: lk, p: '', m: `${e.m}（${e.w} 的变形）`, rank: e.rank, base: e.w };
  }
  return null;
}

const known = (t) => { load(); const lk = t.toLowerCase(); return LOWER.has(lk) || !!L[lk]; };

// Typical OCR confusions, tried before generic single-edit corrections.
const CONFUSE = [['0', 'o'], ['1', 'l'], ['1', 'i'], ['5', 's'], ['8', 'b'], ['6', 'b'], ['9', 'g'], ['rn', 'm'], ['m', 'rn'],
  ['vv', 'w'], ['cl', 'd'], ['d', 'cl'], ['l', 'i'], ['i', 'l'], ['I', 'l'], ['l', 't'], ['c', 'e'], ['e', 'c'], ['h', 'b'],
  ['u', 'n'], ['n', 'u'], ['ii', 'u'], ['li', 'h'], ['nn', 'm']];

function suggest(token, max = 3) {
  load();
  const t = String(token || '');
  const lk = t.toLowerCase();
  const found = new Map(); // word -> score (lower is better)
  const add = (cand, bonus) => {
    if (cand === lk || cand.length < 2) return;
    const e = lookup(cand);
    if (!e) return;
    const r = e.rank > 0 ? e.rank : 60000;
    const s = r * bonus;
    if (!found.has(e.w) || found.get(e.w) > s) found.set(e.w, s);
  };
  for (const [a, b] of CONFUSE) {
    let i = -1;
    while ((i = t.indexOf(a, i + 1)) >= 0) add((t.slice(0, i) + b + t.slice(i + a.length)).toLowerCase(), 0.2);
  }
  const s = lk.replace(/[^a-z'-]/g, '');
  if (s !== lk) add(s, 0.2);
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i <= s.length; i++) {
    if (i < s.length) add(s.slice(0, i) + s.slice(i + 1), 1.5);
    if (i < s.length - 1) add(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2), 1);
    for (const c of abc) {
      if (i < s.length) add(s.slice(0, i) + c + s.slice(i + 1), 1);
      add(s.slice(0, i) + c + s.slice(i), 1.5);
    }
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map((x) => x[0]);
}

module.exports = { lookup, known, suggest };
