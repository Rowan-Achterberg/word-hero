/* 闯关挑战: every group of 10 words is a level; each 5th level is a boss that mixes the last 50 words.
   Three hearts. Question types get harder inside a level: choose → listen → unscramble → spell. */
const Game = {
  G: null,
  isBoss: (li) => (li + 1) % 5 === 0,
  unlocked(bookId, li) { return li === 0 || Store.d.settings.unlockAll || (Books.prog(bookId).lv[li - 1] || 0) >= 1; },

  start(bookId, li, onClose) {
    const book = Books.get(bookId), groups = Books.groups(book), boss = this.isBoss(li);
    let pool = groups[li];
    if (boss) pool = shuffle(groups.slice(Math.max(0, li - 4), li + 1).flat()).slice(0, 15);
    else pool = shuffle(pool);
    const n = pool.length;
    const plan = pool.map((w, i) => {
      const f = i / n;
      const type = f < 0.3 ? (i % 2 ? 'zh2en' : 'en2zh') : f < 0.5 ? 'listen' : f < 0.8 ? 'scramble' : 'spell';
      return { w, type };
    });
    const near = book.words.slice(Math.max(0, li * 10 - 40), li * 10 + 50);
    const G = this.G = { bookId, li, boss, plan, i: 0, hearts: 3, score: 0, combo: 0, best: 0, right: 0, near, onClose };
    G.token = Overlay.open(`
      <div class="sess game ${boss ? 'boss' : ''}">
        <div class="sess-top">
          <button class="icon-btn" data-act="sess-exit" title="退出">✕</button>
          <div class="sess-title">${boss ? '👑 Boss 关' : '⚔️ 第 ' + (li + 1) + ' 关'} · ${esc(book.name)}</div>
          <div class="g-combo" id="g-combo"></div>
          <div class="g-score">⭐ <b id="g-score">0</b></div>
          <div class="g-hearts" id="g-hearts"></div>
        </div>
        <div class="pbar"><i id="s-bar"></i></div>
        <div class="stage" id="stage"></div>
      </div>`, onClose);
    Speak.preload(pool);
    this.next();
  },
  hud() {
    const G = this.G;
    $('#g-hearts').innerHTML = '❤️'.repeat(G.hearts) + '<span class="lost">' + '🤍'.repeat(3 - G.hearts) + '</span>';
    $('#g-score').textContent = G.score;
    $('#g-combo').textContent = G.combo >= 2 ? `🔥 连对 ×${G.combo}` : '';
    $('#s-bar').style.width = `${(G.i / G.plan.length) * 100}%`;
  },
  next() {
    const G = this.G;
    if (!Overlay.alive(G.token)) return;
    this.hud();
    if (G.hearts <= 0) return this.end(false);
    if (G.i >= G.plan.length) return this.end(true);
    const { w, type } = G.plan[G.i];
    $('#stage').innerHTML = '<div class="quiz" id="quiz"></div>';
    const host = $('#quiz');
    const onDone = ({ correct }) => {
      if (!Overlay.alive(G.token)) return;
      if (correct) { G.combo++; G.best = Math.max(G.best, G.combo); G.right++; G.score += 100 + Math.min(G.combo - 1, 5) * 20; }
      else { G.combo = 0; G.hearts--; Store.mark(w, false); refreshNav(); }
      if (correct && type === 'spell') Store.mark(w, true);
      G.i++; this.next();
    };
    if (type === 'scramble') return scrambleWidget(host, w, { onDone });
    if (type === 'spell') return spellWidget(host, w, { onDone, copyOnWrong: false });
    const field = type === 'zh2en' ? 'w' : 'm';
    const options = shuffle([{ label: w[field], correct: true }, ...distractors(w, G.near, field).map((d) => ({ label: d[field] }))]);
    const promptHtml = type === 'en2zh' ? `<div class="q-word">${esc(w.w)}</div>`
      : type === 'zh2en' ? `<div class="q-mean">${esc(w.m)}</div>`
        : `<button class="big-speak" data-act="say" data-w="${esc(w.w)}">🔊</button>`;
    const tag = type === 'en2zh' ? '选出正确的中文意思' : type === 'zh2en' ? '选出对应的英文单词' : '听发音，选出中文意思';
    choiceWidget(host, { tag, promptHtml, options, onDone, after: () => { if (type !== 'listen') Speak.say(w.w, 1); else { const p = document.createElement('div'); p.className = 'q-reveal'; p.textContent = w.w; host.insertBefore(p, $('.choices', host)); } } });
    if (type !== 'zh2en') Speak.say(w.w, 1);
  },
  end(win) {
    const G = this.G; Keys.on(null); Speak.stop();
    const lv = Books.prog(G.bookId).lv;
    if (win) {
      const st = G.hearts; lv[G.li] = Math.max(lv[G.li] || 0, st);
      const xp = 30 + st * 10 + (G.boss ? 30 : 0); Store.addXP(xp);
      const book = Books.get(G.bookId), more = G.li + 1 < Books.groups(book).length;
      $('#s-bar').style.width = '100%';
      $('#stage').innerHTML = `<div class="result"><div class="result-stars">${stars(st)}</div><h2>${G.boss ? '👑 Boss 被打败了！' : '🎉 闯关成功！'}</h2>
        <div class="result-stats"><div><b>${G.score}</b><span>得分</span></div><div><b>${G.right}/${G.plan.length}</b><span>答对</span></div><div><b>×${G.best}</b><span>最高连对</span></div><div><b>+${xp}</b><span>经验值</span></div></div>
        <div class="row center"><button class="btn" data-act="g-retry">↺ 再挑战一次</button>${more ? '<button class="btn primary" data-act="g-next">下一关 →</button>' : '<button class="btn primary" data-act="sess-exit">完成</button>'}</div></div>`;
      UI.confetti(); Snd.win();
    } else {
      Store.save();
      $('#stage').innerHTML = `<div class="result fail"><div class="intro-ico">💔</div><h2>差一点点！</h2><p>爱心用完了。先去「三步记忆」把这组词练熟，再回来挑战吧。</p>
        <div class="row center"><button class="btn" data-act="g-retry">↺ 再试一次</button><button class="btn primary" data-act="g-study">📖 去学这一组</button></div></div>`;
    }
  },
};
Act['g-retry'] = () => { const G = Game.G; Game.start(G.bookId, G.li, G.onClose); };
Act['g-next'] = () => { const G = Game.G; Game.start(G.bookId, G.li + 1, G.onClose); };
Act['g-study'] = () => { const G = Game.G; startGroup(G.bookId, G.li, G.onClose); };
