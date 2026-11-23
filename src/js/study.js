/* 三步记忆: ① 看一遍(单词+中文+朗读) → ② 字母拼词(每次一个词) → ③ 默写(每次一个词).
   A word answered wrongly comes back at the end of the same step until it is right. */
const Study = {
  S: null,

  // opts: { words, title, bookId?, gi?, startStep? }
  start(opts) {
    const S = this.S = { ...opts, step: opts.startStep || 1, i: 0, first2: {}, first3: {}, t0: Date.now(), auto: false };
    S.token = Overlay.open(`
      <div class="sess">
        <div class="sess-top">
          <button class="icon-btn" data-act="sess-exit" title="退出">✕</button>
          <div class="sess-title">${esc(S.title)}</div>
          <div class="steps"><span data-step="1">① 看一遍</span><i></i><span data-step="2">② 字母拼词</span><i></i><span data-step="3">③ 默写</span></div>
          <div class="sess-count" id="s-count"></div>
        </div>
        <div class="pbar"><i id="s-bar"></i></div>
        <div class="stage" id="stage"></div>
      </div>`, opts.onClose);
    Speak.preload(S.words);
    if (S.step === 1) this.learn(0); else this.intro(S.step);
  },
  alive() { return this.S && Overlay.alive(this.S.token); },
  head(done, total) {
    const S = this.S;
    $$('.steps span').forEach((el) => { const n = +el.dataset.step; el.className = n === S.step ? 'on' : n < S.step ? 'done' : ''; });
    $('#s-count').textContent = `${Math.min(done + 1, total)} / ${total}`;
    $('#s-bar').style.width = `${((S.step - 1) / 3 + (done / total) / 3) * 100}%`;
  },

  /* ---------- ① 看一遍 ---------- */
  learn(i) {
    const S = this.S; S.step = 1; S.i = i;
    const w = S.words[i], n = S.words.length;
    this.head(i, n);
    $('#stage').innerHTML = `
      <div class="learn">
        <div class="dots">${S.words.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'done' : ''}"></i>`).join('')}</div>
        <div class="flash" key="${i}">
          <button class="speak-btn" data-act="st-say" title="再读一遍 (R)">🔊</button>
          <div class="flash-word">${esc(w.w)}</div>
          <div class="flash-ph">${w.p ? '/' + esc(w.p) + '/' : '&nbsp;'}</div>
          <div class="flash-mean">${esc(w.m)}</div>
        </div>
        <div class="learn-tip">👀 看拼写　👂 听发音　🗣️ 跟着大声读</div>
        <div class="row">
          <button class="btn" data-act="st-prev" ${i === 0 ? 'disabled' : ''}>← 上一个</button>
          <label class="switch"><input type="checkbox" id="st-auto" ${S.auto ? 'checked' : ''}><span>自动播放</span></label>
          <button class="btn primary" data-act="st-next">${i === n - 1 ? '看完了，全组回顾 →' : '下一个 →'}</button>
        </div>
      </div>`;
    $('#st-auto').onchange = (e) => { S.auto = e.target.checked; if (S.auto) this.sayThenAuto(); };
    Keys.on((e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Act['st-next'](); }
      else if (e.key === 'ArrowLeft') Act['st-prev']();
      else if (e.key.toLowerCase() === 'r') Act['st-say']();
    });
    this.sayThenAuto();
  },
  async sayThenAuto() {
    const S = this.S, i = S.i;
    await Speak.say(S.words[i].w, Store.d.settings.repeat);
    if (!S.auto) return;
    await sleep(1300);
    if (this.alive() && S.step === 1 && S.i === i && S.auto && $('.flash')) Act['st-next']();
  },
  overview() {
    const S = this.S; S.i = -1; Speak.stop();
    this.head(S.words.length - 1, S.words.length); $('#s-bar').style.width = '33.3%';
    $('#stage').innerHTML = `
      <div class="overview">
        <h2>这 ${S.words.length} 个单词都见过啦，再扫一眼</h2>
        <div class="ov-grid">${S.words.map((w, k) => `<button class="ov-card" data-act="ov-say" data-k="${k}"><b>${esc(w.w)}</b><small>${w.p ? '/' + esc(w.p) + '/' : ''}</small><span>${esc(w.m)}</span></button>`).join('')}</div>
        <div class="row center"><button class="btn" data-act="ov-all">🔊 全部朗读一遍</button><button class="btn" data-act="st-again">↺ 再看一遍</button><button class="btn primary big" data-act="st-go2">记住了，开始拼词 →</button></div>
      </div>`;
    Keys.on((e) => { if (e.key === 'Enter') Act['st-go2'](); });
  },

  /* ---------- between steps ---------- */
  intro(step) {
    const S = this.S; S.step = step; Speak.stop();
    this.head(0, S.words.length);
    const info = step === 2
      ? ['🧩', '第 ② 步：字母拼词', '给你中文意思和打乱的字母，把它们排成正确的单词。每次一个词。']
      : ['✍️', '第 ③ 步：默写', '只给中文意思，自己把单词完整写出来。每次一个词。'];
    $('#stage').innerHTML = `<div class="intro"><div class="intro-ico">${info[0]}</div><h2>${info[1]}</h2><p>${info[2]}</p><p class="mute">写错的词会在最后再出现，直到写对为止。</p><button class="btn primary big" data-act="st-begin">开始 (回车)</button></div>`;
    Keys.on((e) => { if (e.key === 'Enter') { e.preventDefault(); Act['st-begin'](); } });
  },

  /* ---------- ② / ③ ---------- */
  run(step) {
    const S = this.S; S.step = step;
    S.queue = S.words.map((_, k) => k);
    this.ask();
  },
  ask() {
    const S = this.S, total = S.words.length;
    if (!S.queue.length) return S.step === 2 ? this.intro(3) : this.finish();
    const k = S.queue[0], w = S.words[k];
    const first = S.step === 2 ? S.first2 : S.first3;
    this.head(total - new Set(S.queue).size, total);
    const stage = $('#stage');
    stage.innerHTML = `<div class="quiz" id="quiz"></div>${k in first ? '<div class="again-tag">↻ 再来一次</div>' : ''}`;
    const onDone = ({ correct, hinted }) => {
      if (!this.alive()) return;
      if (!(k in first)) first[k] = correct && !hinted;
      S.queue.shift();
      if (!correct) S.queue.push(k);
      this.ask();
    };
    if (S.step === 2) scrambleWidget($('#quiz'), w, { onDone }); else spellWidget($('#quiz'), w, { onDone });
  },

  /* ---------- result ---------- */
  finish() {
    const S = this.S, n = S.words.length; Speak.stop(); Keys.on(null);
    const did2 = Object.keys(S.first2).length > 0;
    const r2 = S.words.filter((_, k) => S.first2[k]).length, r3 = S.words.filter((_, k) => S.first3[k]).length;
    const acc = Math.round(((r2 + r3) / (n * (did2 ? 2 : 1))) * 100);
    const st = acc === 100 ? 3 : acc >= 75 ? 2 : 1;
    S.words.forEach((w, k) => Store.mark(w, !!S.first3[k]));
    if (S.bookId != null && S.gi != null) {
      const g = Books.prog(S.bookId).g, old = g[S.gi] || { stars: 0, times: 0 };
      g[S.gi] = { stars: Math.max(old.stars, st), acc: Math.max(old.acc || 0, acc), times: old.times + 1, last: dayStr() };
    }
    const xp = 20 + r3 * 3 + st * 5;
    Store.addXP(xp);
    const secs = Math.round((Date.now() - S.t0) / 1000);
    const mark = (v) => (v === undefined ? '<td class="mute">–</td>' : v ? '<td class="good">✓</td>' : '<td class="bad">✗</td>');
    const book = S.bookId != null ? Books.get(S.bookId) : null;
    const hasNext = book && S.gi != null && S.gi + 1 < Books.groups(book).length;
    $('.steps span.on')?.classList.replace('on', 'done'); $('#s-bar').style.width = '100%'; $('#s-count').textContent = '';
    $('#stage').innerHTML = `
      <div class="result">
        <div class="result-stars">${stars(st)}</div>
        <h2>${st === 3 ? '太棒了，全部一次写对！' : st === 2 ? '不错，再把错的词练一练！' : '完成了！错的词多练几遍'}</h2>
        <div class="result-stats"><div><b>${acc}%</b><span>一次写对率</span></div><div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b><span>用时</span></div><div><b>+${xp}</b><span>经验值</span></div></div>
        <table class="result-table"><tr><th>单词</th><th>中文</th><th>拼词</th><th>默写</th></tr>
          ${S.words.map((w, k) => `<tr><td><button class="link" data-act="say" data-w="${esc(w.w)}">🔊 ${esc(w.w)}</button></td><td>${esc(w.m)}</td>${mark(S.first2[k])}${mark(S.first3[k])}</tr>`).join('')}
        </table>
        <p class="mute">默写没有一次写对的词已放进「错词本」，系统会在合适的日子提醒复习。</p>
        <div class="row center">
          <button class="btn" data-act="st-retry">↺ 再练一遍</button>
          ${book && S.gi != null ? '<button class="btn" data-act="st-game">⚔️ 去闯关检验</button>' : ''}
          ${hasNext ? '<button class="btn primary" data-act="st-nextgroup">下一组 →</button>' : '<button class="btn primary" data-act="sess-exit">完成</button>'}
        </div>
      </div>`;
    if (st >= 2) { UI.confetti(); Snd.win(); }
    Keys.on(null);
  },
};

Act['st-say'] = () => { const S = Study.S; if (S && S.i >= 0) Speak.say(S.words[S.i].w, 1); };
Act['st-prev'] = () => { const S = Study.S; if (S.i > 0) Study.learn(S.i - 1); };
Act['st-next'] = () => { const S = Study.S; if (S.i < S.words.length - 1) Study.learn(S.i + 1); else Study.overview(); };
Act['st-again'] = () => Study.learn(0);
Act['st-go2'] = () => Study.intro(2);
Act['st-begin'] = () => Study.run(Study.S.step);
Act['ov-say'] = (el) => { $$('.ov-card').forEach((c) => c.classList.remove('on')); el.classList.add('on'); Speak.say(Study.S.words[+el.dataset.k].w, 1); };
Act['ov-all'] = async () => {
  const S = Study.S, cards = $$('.ov-card');
  for (let k = 0; k < cards.length; k++) {
    if (!Study.alive() || !cards[k].isConnected) return;
    cards.forEach((c) => c.classList.remove('on')); cards[k].classList.add('on');
    await Speak.once(S.words[k].w); await sleep(350);
  }
  cards.forEach((c) => c.classList.remove('on'));
};
Act['st-retry'] = () => { const S = Study.S; Study.start({ words: S.words, title: S.title, bookId: S.bookId, gi: S.gi, onClose: S.onClose }); };
Act['st-nextgroup'] = () => { const S = Study.S; startGroup(S.bookId, S.gi + 1, S.onClose); };
Act['st-game'] = () => { const S = Study.S; const onClose = S.onClose; Overlay.onClose = null; Overlay.close(); Game.start(S.bookId, S.gi, onClose); };

function startGroup(bookId, gi, onClose, startStep) {
  const book = Books.get(bookId); const words = Books.groups(book)[gi];
  if (!words) return;
  Study.start({ words, title: `${book.name} · 第 ${gi + 1} 组`, bookId, gi, startStep, onClose });
}
