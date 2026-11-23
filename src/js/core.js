/* Shared helpers: storage, word books, speech, sounds, small UI pieces. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dayStr = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sameWord = (a, b) => a.trim().replace(/\s+/g, ' ').replace(/’/g, "'").toLowerCase() === b.trim().replace(/’/g, "'").toLowerCase();
const stars = (n, max = 3) => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(max - n)}</span></span>`;

const REVIEW_DAYS = [1, 1, 2, 4, 7, 15]; // days until the next review after each correct recall
const LEVELS = ['单词萌新', '字母探险家', '拼写小能手', '记忆小达人', '单词骑士', '词汇魔法师', '拼写大师', '单词小英雄', '词汇王者', '传奇学霸'];

const Store = {
  d: null,
  defaults: () => ({
    v: 1,
    settings: { theme: 'light', voice: 'auto', accent: 2, repeat: 2, sfx: true, unlockAll: false },
    profile: { xp: 0, streak: 0, lastDay: '', days: {}, best: {} },
    bookId: 'primary', lists: [], prog: {}, words: {},
  }),
  async load() {
    const saved = await api.loadStore();
    const d = this.defaults();
    if (saved && typeof saved === 'object') {
      Object.assign(d, saved);
      d.settings = { ...this.defaults().settings, ...(saved.settings || {}) };
      d.profile = { ...this.defaults().profile, ...(saved.profile || {}) };
    }
    this.d = d;
  },
  save() { clearTimeout(this._t); this._t = setTimeout(() => api.saveStore(this.d), 200); },
  day() {
    const days = this.d.profile.days, t = dayStr();
    if (!days[t]) { days[t] = { xp: 0, learned: 0 }; const keys = Object.keys(days).sort(); while (keys.length > 60) delete days[keys.shift()]; }
    return days[t];
  },
  addXP(n) {
    const p = this.d.profile, t = dayStr();
    if (p.lastDay !== t) { p.streak = p.lastDay === dayStr(-1) ? p.streak + 1 : 1; p.lastDay = t; }
    const before = this.level().n;
    p.xp += n; this.day().xp += n; this.save();
    const after = this.level();
    if (after.n > before) setTimeout(() => { UI.toast(`🎉 升级啦！Lv.${after.n} ${after.title}`, 'good'); Snd.win(); }, 600);
    refreshNav();
  },
  level() {
    const xp = this.d.profile.xp, n = Math.floor(Math.sqrt(xp / 60)) + 1;
    const base = 60 * (n - 1) ** 2, next = 60 * n ** 2;
    return { n, title: LEVELS[Math.min(LEVELS.length - 1, Math.floor((n - 1) / 2))], pct: Math.round(((xp - base) / (next - base)) * 100), xp, next };
  },
  rec(word) {
    const k = word.w.toLowerCase();
    const r = this.d.words[k] || (this.d.words[k] = { box: 0, due: '', ok: 0, bad: 0, run: 0, miss: false });
    r.e = { w: word.w, p: word.p || '', m: word.m };
    return r;
  },
  // Record one honest recall attempt (typed from memory). Drives the mistake book and review dates.
  mark(word, correct) {
    const r = this.rec(word);
    if (correct) {
      if (!r.ok) this.day().learned++;
      r.ok++; r.run++; r.box = Math.min(REVIEW_DAYS.length - 1, r.box + 1); r.due = dayStr(REVIEW_DAYS[r.box]);
      if (r.miss && r.run >= 2) r.miss = false;
    } else { r.bad++; r.run = 0; r.box = 0; r.due = dayStr(1); r.miss = true; }
    this.save();
  },
  mistakes() { return Object.values(this.d.words).filter((r) => r.miss && r.e).sort((a, b) => b.bad - a.bad).map((r) => ({ ...r.e, bad: r.bad, ok: r.ok })); },
  due() { const t = dayStr(); return Object.values(this.d.words).filter((r) => r.e && r.ok > 0 && r.due && r.due <= t).sort((a, b) => (a.due < b.due ? -1 : 1)).map((r) => r.e); },
  learned() { return Object.values(this.d.words).filter((r) => r.ok > 0).length; },
};

const Books = {
  builtin: [],
  async load() { this.builtin = (await api.wordbank()).books; },
  all() { return [...this.builtin, ...Store.d.lists]; },
  get(id) { return this.all().find((b) => b.id === id); },
  cur() { return this.get(Store.d.bookId) || this.builtin[0]; },
  groups(book) { const g = []; for (let i = 0; i < book.words.length; i += 10) g.push(book.words.slice(i, i + 10)); return g; },
  prog(id) { const p = Store.d.prog; return p[id] || (p[id] = { g: {}, lv: {} }); },
};

/* ---------- sounds ---------- */
const Snd = {
  ctx: null,
  tone(freqs, dur = 0.12, type = 'sine', vol = 0.12) {
    if (!Store.d.settings.sfx) return;
    try {
      this.ctx = this.ctx || new AudioContext();
      let t = this.ctx.currentTime;
      for (const f of freqs) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.value = f; o.connect(g); g.connect(this.ctx.destination);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.start(t); o.stop(t + dur); t += dur * 0.8;
      }
    } catch { /* no audio device */ }
  },
  ok() { this.tone([660, 990]); },
  bad() { this.tone([220, 165], 0.16, 'triangle', 0.16); },
  tap() { this.tone([520], 0.05, 'sine', 0.06); },
  win() { this.tone([523, 659, 784, 1047], 0.16); },
};

/* ---------- pronunciation ---------- */
const Speak = {
  cache: new Map(), cur: null, seq: 0, offlineUntil: 0,
  stop() { this.seq++; try { this.cur && this.cur.pause(); } catch { /* */ } try { speechSynthesis.cancel(); } catch { /* */ } },
  async say(text, times = 1) {
    this.stop(); const me = this.seq;
    for (let i = 0; i < times; i++) {
      if (me !== this.seq) return;
      await this.once(text);
      if (i < times - 1) await sleep(380);
    }
  },
  async once(text) {
    const s = Store.d.settings;
    if (s.voice !== 'system') { const url = await this.online(text); if (url && await this.play(url)) return; }
    await this.system(text);
  },
  async online(text) {
    const key = Store.d.settings.accent + '|' + text.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    if (Date.now() < this.offlineUntil) return null;
    const buf = await api.tts(text, Store.d.settings.accent).catch(() => null);
    if (!buf) { this.offlineUntil = Date.now() + 60000; return null; }
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
    this.cache.set(key, url); return url;
  },
  preload(words) { if (Store.d.settings.voice !== 'system') words.forEach((w) => this.online(w.w)); },
  play(url) {
    return new Promise((res) => {
      const a = new Audio(url); this.cur = a; let done = false;
      const end = (v) => { if (!done) { done = true; res(v); } };
      a.onended = () => end(true); a.onerror = () => end(false); a.onpause = () => end(true);
      a.play().catch(() => end(false)); setTimeout(() => end(true), 6000);
    });
  },
  voice() {
    const vs = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang));
    const want = Store.d.settings.accent === 1 ? /en[-_]GB/i : /en[-_]US/i;
    const score = (v) => (want.test(v.lang) ? 4 : 0) + (/natural|online/i.test(v.name) ? 3 : 0) + (/aria|jenny|zira|sonia|libby|hazel/i.test(v.name) ? 1 : 0);
    return vs.sort((a, b) => score(b) - score(a))[0] || null;
  },
  system(text) {
    return new Promise((res) => {
      if (!window.speechSynthesis) return res();
      let done = false; const end = () => { if (!done) { done = true; res(); } };
      try {
        const u = new SpeechSynthesisUtterance(text); const v = this.voice();
        if (v) u.voice = v; u.lang = v ? v.lang : 'en-US'; u.rate = 0.85;
        u.onend = end; u.onerror = end; speechSynthesis.speak(u);
      } catch { end(); }
      setTimeout(end, 4500);
    });
  },
};
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => {};

/* ---------- keyboard: one active handler at a time ---------- */
const Keys = { fn: null, on(fn) { this.fn = fn; } };
document.addEventListener('keydown', (e) => {
  if (!$('#modal').hidden) { if (e.key === 'Escape') UI.closeModal(false); if (e.key === 'Enter') { const b = $('#modal [data-default]'); if (b) { e.preventDefault(); b.click(); } } return; }
  if (Keys.fn) Keys.fn(e);
});
// A Chinese input method swallows letter keys: tell the pupil how to switch instead of failing silently.
let imeTipAt = 0;
document.addEventListener('compositionstart', () => { if (Date.now() - imeTipAt > 8000) { imeTipAt = Date.now(); UI.toast('请按 Shift 键切换到英文输入法 ⌨️'); } });

/* ---------- click actions (no inline handlers) ---------- */
const Act = {};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && Act[el.dataset.act]) Act[el.dataset.act](el, e);
});

/* ---------- small UI pieces ---------- */
const UI = {
  toast(msg, type = '') {
    const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3000);
  },
  _resolve: null,
  modal(html) { const m = $('#modal'); m.innerHTML = `<div class="modal-card">${html}</div>`; m.hidden = false; return new Promise((r) => { this._resolve = r; }); },
  closeModal(value) { $('#modal').hidden = true; $('#modal').innerHTML = ''; const r = this._resolve; this._resolve = null; if (r) r(value); },
  confirm(title, body, okText = '确定', danger = false) {
    return this.modal(`<h3>${esc(title)}</h3><p>${esc(body)}</p><div class="modal-btns"><button class="btn" data-act="modal-no">取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="modal-yes" data-default>${esc(okText)}</button></div>`);
  },
  confetti() {
    const c = $('#confetti'), ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
    const colors = ['#ff5d73', '#ffb020', '#3ecf8e', '#3b82f6', '#a855f7', '#ffd43b'];
    const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 240, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 3, s: Math.random() * 8 + 4, c: colors[Math.floor(Math.random() * 6)], r: Math.random() * 6 }));
    const t0 = performance.now();
    const tick = (t) => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of ps) { p.vy += 0.42; p.x += p.vx; p.y += p.vy; p.r += 0.2; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore(); }
      if (t - t0 < 2400) requestAnimationFrame(tick); else ctx.clearRect(0, 0, c.width, c.height);
    };
    requestAnimationFrame(tick);
  },
};
Act['modal-yes'] = () => UI.closeModal(true);
Act['modal-no'] = () => UI.closeModal(false);
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') UI.closeModal(false); });

/* ---------- full-screen session layer (study / games) ---------- */
const Overlay = {
  token: 0, onClose: null,
  open(html, onClose) { this.token++; this.onClose = onClose || null; const o = $('#overlay'); o.innerHTML = html; o.hidden = false; document.body.classList.add('in-session'); return this.token; },
  alive(token) { return token === this.token && !$('#overlay').hidden; },
  close() { this.token++; Speak.stop(); Keys.on(null); $('#overlay').hidden = true; $('#overlay').innerHTML = ''; document.body.classList.remove('in-session'); const f = this.onClose; this.onClose = null; if (f) f(); },
};
Act['sess-exit'] = async () => {
  if ($('#overlay .result, #overlay .fail')) return Overlay.close();
  if (await UI.confirm('要退出吗？', '这一组还没完成，退出后本次进度不会保存。', '退出')) Overlay.close();
};
Act['say'] = (el) => { Speak.say(el.dataset.w, 1); };

function refreshNav() {
  const lv = Store.level(), miss = Store.mistakes().length;
  $('#nav-level').innerHTML = `<div class="lv-top"><b>Lv.${lv.n}</b><span>${lv.title}</span></div><div class="lv-bar"><i style="width:${lv.pct}%"></i></div><div class="lv-sub">🔥 连续 ${Store.d.profile.lastDay >= dayStr(-1) ? Store.d.profile.streak : 0} 天 · ${lv.xp} XP</div>`;
  const b = $('#nav-miss'); b.textContent = miss || ''; b.hidden = !miss;
}
