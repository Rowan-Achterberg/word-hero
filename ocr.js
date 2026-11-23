// Photo -> word list.  Accuracy strategy ("never teach a wrong word"):
//   1. several independent readings of the same photo (Tesseract on a grey image, Tesseract on a
//      binarised image, and the OCR engine built into Windows when available) that vote on every word;
//   2. every word is checked against the offline dictionary; unknown words are never pre-selected;
//   3. anything uncertain is flagged so a person confirms it before it reaches a lesson.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const dict = require('./dict');

const POS = new Set(['n', 'v', 'vt', 'vi', 'adj', 'adv', 'prep', 'pron', 'conj', 'int', 'interj', 'art', 'num', 'aux',
  'a', 'ad', 'pl', 'abbr', 'det', 'modal', 'sb', 'sth', 'eg', 'etc']);
const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = require('tesseract.js');
      const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
      return createWorker('eng', OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none' });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

async function tesseract(buf) {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: '300', preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(buf, {}, { blocks: true, text: false });
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    words.push({ text: w.text, conf: w.confidence, bbox: w.bbox });
  }
  return words;
}

function windowsOcr(buf) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `wordhero-ocr-${process.pid}-${Date.now()}.png`);
    try { fs.writeFileSync(tmp, buf); } catch { return resolve(null); }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'winocr.ps1'), '-Path', tmp];
    execFile('powershell.exe', args, { windowsHide: true, timeout: 25000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      fs.unlink(tmp, () => {});
      if (err) return resolve(null);
      try {
        const json = JSON.parse(stdout.slice(stdout.indexOf('{')));
        const list = Array.isArray(json.words) ? json.words : (json.words ? [json.words] : []);
        resolve(list.map((w) => ({ text: String(w.t || ''), conf: null, bbox: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 } })));
      } catch { resolve(null); }
    });
  });
}

// One OCR "word" may hold several tokens ("look/see", "n.apple"); split and drop part-of-speech labels.
function tokenize(words) {
  const out = [];
  for (const w of words) {
    const text = w.text || '';
    let m; WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text))) {
      const t = m[0].replace(/’/g, "'");
      if (text[m.index + t.length] === '.' && POS.has(t.toLowerCase())) continue;
      if (t.length === 1 && t !== 'I') continue;
      out.push({ t, conf: w.conf, bbox: w.bbox, votes: 1, alts: new Set() });
    }
  }
  return out;
}

function overlap(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const min = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)) || 1;
  return (w * h) / min;
}

// Let another reading vote on the primary one; return what only the other reading saw.
function vote(primary, other) {
  const missed = [];
  for (const o of other) {
    const near = primary.filter((p) => overlap(p.bbox, o.bbox) > 0.4);
    const same = near.find((p) => p.t.toLowerCase() === o.t.toLowerCase());
    if (same) { same.votes++; if (o.conf != null) same.conf = Math.max(same.conf ?? 0, o.conf); }
    else if (near.length) near.forEach((p) => p.alts.add(o.t));
    else missed.push(o);
  }
  return missed;
}

function insertByPosition(list, item) {
  const cy = (item.bbox.y0 + item.bbox.y1) / 2;
  let at = -1;
  list.forEach((p, i) => { if (p.bbox.y0 <= cy && p.bbox.y1 >= cy && p.bbox.x0 < item.bbox.x0) at = i; });
  if (at < 0) {
    const below = list.findIndex((p) => p.bbox.y0 > item.bbox.y1);
    at = below < 0 ? list.length - 1 : below - 1;
  }
  list.splice(at + 1, 0, item);
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
// a second reading may correct the first only when both clearly mean the same printed word
const close = (a, b) => a.length >= 4 && b.length >= 4 && distance(a.toLowerCase(), b.toLowerCase()) <= 2;

function classify(tokens, engineCount) {
  const items = []; let ignored = 0; const seen = new Map();
  for (const p of tokens) {
    let e = dict.lookup(p.t);
    let status, note = '';
    const conf = p.conf == null ? null : Math.round(p.conf);
    const altsKnown = [...p.alts].map((a) => dict.lookup(a)).filter(Boolean).map((x) => x.w)
      .filter((w, i, arr) => arr.indexOf(w) === i && (!e || w.toLowerCase() !== e.w.toLowerCase()));
    if (e) {
      const sure = (conf != null && conf >= 75) || p.votes >= 2;
      // short "words" are what stray marks and Chinese characters usually turn into: demand strong evidence
      if (p.t.length <= 3 && !((p.votes >= 2 && (conf == null || conf >= 60)) || (conf != null && conf >= 90))) { ignored++; continue; }
      status = sure ? 'ok' : 'warn';
      if (!sure) note = '识别把握不大，请对照原图确认';
      if (altsKnown.length && p.votes < 2 && (conf == null || conf < 90)) { status = 'warn'; note = '几次识别结果不一致，请对照原图确认'; }
      if (p.inserted && status === 'ok' && p.votes < 2) { status = 'warn'; note = '补充识别到的词，请确认'; }
    } else if (altsKnown.some((a) => close(p.t, a))) {
      const pick = altsKnown.find((a) => close(p.t, a));
      altsKnown.splice(altsKnown.indexOf(pick), 1);
      e = dict.lookup(pick); status = 'warn'; note = `原识别为 “${p.t}”，已按另一次识别更正，请确认`;
    } else {
      if (p.t.length <= 2 || (conf != null && conf < 60)) { ignored++; continue; }
      status = 'bad'; note = '词典里没有这个词，可能识别有误';
    }
    const word = e ? e.w : p.t;
    const key = word.toLowerCase();
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (prev.status !== 'ok' && status === 'ok') { prev.status = 'ok'; prev.note = ''; prev.checked = true; }
      continue;
    }
    const sugg = status === 'bad' ? dict.suggest(p.t) : altsKnown.slice(0, 3);
    const item = { w: word, raw: p.t, p: e ? e.p : '', m: e ? e.m : '', status, note, conf, votes: p.votes, engines: engineCount,
      sugg, bbox: p.bbox, checked: status === 'ok' };
    seen.set(key, item); items.push(item);
  }
  return { items, ignored };
}

// images: { gray: Buffer(PNG), bin: Buffer(PNG) } — same pixel size.
async function run(images, onProgress = () => {}) {
  const engines = [];
  onProgress({ step: 1, total: 4, text: '第一遍识别（灰度图）…' });
  const primary = tokenize(await tesseract(images.gray)); engines.push('Tesseract');
  onProgress({ step: 2, total: 4, text: '第二遍识别（去阴影黑白图）…' });
  let missed = [];
  try { missed = missed.concat(vote(primary, tokenize(await tesseract(images.bin)))); engines.push('Tesseract·黑白'); } catch { /* optional pass */ }
  onProgress({ step: 3, total: 4, text: process.platform === 'win32' ? 'Windows 识别引擎复核…' : '核对中…' });
  const win = await windowsOcr(images.gray);
  if (win) { missed = missed.concat(vote(primary, tokenize(win))); engines.push('Windows OCR'); }
  onProgress({ step: 4, total: 4, text: '逐词对照词典…' });
  // words seen only by the extra readings: merge duplicates among themselves, then insert by position
  const extra = [];
  for (const m of missed) {
    const same = extra.find((x) => x.t.toLowerCase() === m.t.toLowerCase() && overlap(x.bbox, m.bbox) > 0.4);
    if (same) same.votes++; else extra.push(m);
  }
  for (const m of extra) {
    if (m.t.length < 3 || !dict.known(m.t)) continue;
    if (m.conf != null && m.conf < 75 && m.votes < 2) continue;
    m.inserted = true; insertByPosition(primary, m);
  }
  const { items, ignored } = classify(primary, engines.length);
  return { items, ignored, engines };
}

async function shutdown() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* ignore */ }
  workerPromise = null;
}

module.exports = { run, shutdown };
