/* 趣味练习: 听音拼写 / 闪电四选一 / 配对消消乐, on any group, the mistake book or today's review words. */
const Pages = {};
const Practice = {
  src: 'group', gi: 0, P: null,

  words() {
    if (this.src === 'miss') return Store.mistakes().slice(0, 20);
    if (this.src === 'due') return Store.due().slice(0, 20);
    const groups = Books.groups(Books.cur());
    return groups[Math.min(this.gi, groups.length - 1)] || [];
  },
  frame(title, right = '') {
    return Overlay.open(`<div class="sess game"><div class="sess-top"><button class="icon-btn" data-act="sess-exit" title="退出">✕</button><div class="sess-title">${esc(title)}</div>${right}</div><div class="pbar"><i id="s-bar"></i></div><div class="stage" id="stage"></div></div>`, () => go('practice'));
  },
  begin(mode) {
    const words = this.words();
    if (words.length < 4) return UI.toast('这个范围里的单词不足 4 个，换一个范围吧');
    Speak.preload(words);
    this[mode](words);
  },

  /* ---------- 听音拼写 ---------- */
  dictation(words) {
    const P = this.P = { mode: 'dictation', list: shuffle(words), i: 0, right: 0, wrong: [] };
    P.token = this.frame('🎧 听音拼写', '<div class="sess-count" id="s-count"></div>');
    const ask = () => {
      if (!Overlay.alive(P.token)) return;
      $('#s-bar').style.width = `${(P.i / P.list.length) * 100}%`;
      if (P.i >= P.list.length) return this.summary(`写对 ${P.right} / ${P.list.length}`, P.right === P.list.length, P.wrong);
      $('#s-count').textContent = `${P.i + 1} / ${P.list.length}`;
      const w = P.list[P.i];
      $('#stage').innerHTML = '<div class="quiz" id="quiz"></div>';
      spellWidget($('#quiz'), w, { mode: 'listen', copyOnWrong: false, onDone: ({ correct }) => { Store.mark(w, correct); if (correct) P.right++; else P.wrong.push(w); P.i++; ask(); } });
    };
    ask();
  },

  /* ---------- 闪电四选一 ---------- */
  blitz(words) {
    const P = this.P = { mode: 'blitz', score: 0, left: 60, wrong: [] };
    P.token = this.frame('⚡ 闪电四选一', '<div class="g-score">⭐ <b id="g-score">0</b></div><div class="g-timer">⏱ <b id="g-time">60</b> 秒</div>');
    const pool = words.length >= 8 ? words : [...words, ...Books.cur().words.slice(0, 40)];
    let last = null;
    const tick = setInterval(() => {
      if (!Overlay.alive(P.token)) return clearInterval(tick);
      P.left--; const el = $('#g-time'); if (el) el.textContent = Math.max(0, P.left);
      $('#s-bar').style.width = `${(1 - P.left / 60) * 100}%`;
      if (P.left <= 0) {
        clearInterval(tick);
        const best = Store.d.profile.best.blitz || 0, record = P.score > best;
        if (record) Store.d.profile.best.blitz = P.score;
        Store.addXP(10 + P.score * 2);
        this.summary(`60 秒答对 ${P.score} 题${record ? ' · 新纪录！' : ` · 最高纪录 ${best}`}`, record || P.score >= 15, P.wrong);
      }
    }, 1000);
    const ask = () => {
      if (!Overlay.alive(P.token) || P.left <= 0) return;
      let w; do { w = words[Math.floor(Math.random() * words.length)]; } while (w === last && words.length > 1); last = w;
      const zh = Math.random() < 0.5, field = zh ? 'w' : 'm';
      const options = shuffle([{ label: w[field], correct: true }, ...distractors(w, pool, field).map((d) => ({ label: d[field] }))]);
      $('#stage').innerHTML = '<div class="quiz" id="quiz"></div>';
      choiceWidget($('#quiz'), { tag: zh ? '选出对应的英文单词' : '选出正确的中文意思', promptHtml: zh ? `<div class="q-mean">${esc(w.m)}</div>` : `<div class="q-word">${esc(w.w)}</div>`, options,
        onDone: ({ correct }) => { if (correct) { P.score++; const s = $('#g-score'); if (s) s.textContent = P.score; } else { P.left -= 3; if (!P.wrong.includes(w)) P.wrong.push(w); } ask(); } });
    };
    ask();
  },

  /* ---------- 配对消消乐 ---------- */
  match(words) {
    const set = shuffle(words).slice(0, 10);
    const P = this.P = { mode: 'match', t0: Date.now(), miss: 0, left: set.length, pick: null };
    P.token = this.frame('🧩 配对消消乐', '<div class="g-timer">⏱ <b id="g-time">0</b> 秒</div>');
    const tiles = shuffle([...set.map((w, i) => ({ id: i, text: w.w, en: true })), ...set.map((w, i) => ({ id: i, text: w.m, en: false }))]);
    $('#stage').innerHTML = `<div class="match"><div class="q-tag">把英文单词和它的中文意思配成一对</div><div class="match-grid">${tiles.map((t, k) => `<button class="mt ${t.en ? 'en' : 'zh'}" data-k="${k}">${esc(t.text)}</button>`).join('')}</div></div>`;
    const timer = setInterval(() => { if (!Overlay.alive(P.token) || !P.left) return clearInterval(timer); const el = $('#g-time'); if (el) el.textContent = Math.round((Date.now() - P.t0) / 1000); }, 500);
    Keys.on(null);
    $('.match-grid').onclick = (e) => {
      const b = e.target.closest('.mt'); if (!b || b.classList.contains('gone') || b.classList.contains('bad')) return;
      const k = +b.dataset.k;
      if (P.pick == null) { P.pick = k; b.classList.add('sel'); Snd.tap(); if (tiles[k].en) Speak.say(tiles[k].text, 1); return; }
      if (P.pick === k) { P.pick = null; b.classList.remove('sel'); return; }
      const a = $(`.mt[data-k="${P.pick}"]`), ta = tiles[P.pick], tb = tiles[k]; P.pick = null;
      if (ta.en !== tb.en && (ta.id === tb.id || sameSense(set[ta.id], set[tb.id]))) { // synonyms (bye / goodbye) may pair either way
        Snd.ok(); Speak.say(set[ta.en ? ta.id : tb.id].w, 1); [a, b].forEach((x) => { x.classList.remove('sel'); x.classList.add('gone'); });
        P.left--; $('#s-bar').style.width = `${(1 - P.left / set.length) * 100}%`;
        if (!P.left) {
          const secs = Math.round((Date.now() - P.t0) / 1000), best = Store.d.profile.best.match, record = !best || secs < best;
          if (record) Store.d.profile.best.match = secs;
          Store.addXP(15 + Math.max(0, 10 - P.miss));
          setTimeout(() => this.summary(`用时 ${secs} 秒 · 配错 ${P.miss} 次${record ? ' · 新纪录！' : ` · 最快纪录 ${best} 秒`}`, true, []), 600);
        }
      } else { Snd.bad(); P.miss++; [a, b].forEach((x) => { x.classList.remove('sel'); x.classList.add('bad'); setTimeout(() => x.classList.remove('bad'), 450); }); }
    };
  },

  summary(line, cheer, wrong) {
    Keys.on(null); Speak.stop(); refreshNav();
    $('#s-bar').style.width = '100%';
    $('#stage').innerHTML = `<div class="result"><div class="intro-ico">${cheer ? '🏆' : '💪'}</div><h2>${cheer ? '好样的！' : '练完了！'}</h2><p class="big-line">${esc(line)}</p>
      ${wrong.length ? `<p class="mute">这些词还不熟：</p><div class="chips">${wrong.map((w) => `<button class="chip" data-act="say" data-w="${esc(w.w)}">🔊 ${esc(w.w)} · ${esc(w.m)}</button>`).join('')}</div>` : ''}
      <div class="row center"><button class="btn" data-act="pr-again">↺ 再来一局</button><button class="btn primary" data-act="sess-exit">完成</button></div></div>`;
    if (cheer) { UI.confetti(); Snd.win(); }
  },
};
Act['pr-again'] = () => { const m = Practice.P.mode; Overlay.onClose = null; Practice.begin(m); };
Act['pr-start'] = (el) => Practice.begin(el.dataset.mode);

Pages.practice = () => {
  const book = Books.cur(), groups = Books.groups(book), miss = Store.mistakes().length, due = Store.due().length;
  Practice.gi = Math.min(Practice.gi, groups.length - 1);
  const best = Store.d.profile.best;
  return `
    <header class="page-head"><h1>趣味练习</h1><p>换个玩法巩固记忆。先选练习范围，再挑一个游戏。</p></header>
    <div class="card range">
      <label>练习范围</label>
      <select id="pr-src"><option value="group" ${Practice.src === 'group' ? 'selected' : ''}>${esc(book.name)}</option><option value="miss" ${Practice.src === 'miss' ? 'selected' : ''} ${miss < 4 ? 'disabled' : ''}>错词本（${miss} 词）</option><option value="due" ${Practice.src === 'due' ? 'selected' : ''} ${due < 4 ? 'disabled' : ''}>今日待复习（${due} 词）</option></select>
      <select id="pr-gi" ${Practice.src !== 'group' ? 'hidden' : ''}>${groups.map((g, i) => `<option value="${i}" ${i === Practice.gi ? 'selected' : ''}>第 ${i + 1} 组：${esc(g[0].w)} … ${esc(g[g.length - 1].w)}</option>`).join('')}</select>
    </div>
    <div class="mode-grid">
      <div class="mode-card m1"><div class="mode-ico">🎧</div><h3>听音拼写</h3><p>听发音写单词，练耳朵也练拼写。</p><button class="btn primary" data-act="pr-start" data-mode="dictation">开始</button></div>
      <div class="mode-card m2"><div class="mode-ico">⚡</div><h3>闪电四选一</h3><p>60 秒能答对几题？答错扣 3 秒。${best.blitz ? `<br>最高纪录：${best.blitz} 题` : ''}</p><button class="btn primary" data-act="pr-start" data-mode="blitz">开始</button></div>
      <div class="mode-card m3"><div class="mode-ico">🧩</div><h3>配对消消乐</h3><p>把英文和中文配成一对，越快越好。${best.match ? `<br>最快纪录：${best.match} 秒` : ''}</p><button class="btn primary" data-act="pr-start" data-mode="match">开始</button></div>
    </div>`;
};
Pages.practice.mount = () => {
  $('#pr-src').onchange = (e) => { Practice.src = e.target.value; go('practice'); };
  $('#pr-gi').onchange = (e) => { Practice.gi = +e.target.value; };
};
