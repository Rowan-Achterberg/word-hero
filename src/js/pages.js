/* Pages (home / learn / map / mistakes / settings), router and start-up. */
const App = { page: 'home', info: {} };

function go(page, arg) {
  const view = $('#view'), same = App.page === page, y = view.scrollTop;
  App.page = page; Keys.on(null);
  view.innerHTML = `<div class="page page-${page}">${Pages[page](arg)}</div>`;
  view.scrollTop = same ? y : 0;
  $$('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  if (Pages[page].mount) Pages[page].mount();
  refreshNav();
}
Act.nav = (el) => go(el.dataset.page);

function applyTheme() {
  const dark = Store.d.settings.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  api.setTheme(dark);
}
const nextGroup = (book) => { const g = Books.prog(book.id).g, n = Books.groups(book).length; for (let i = 0; i < n; i++) if (!g[i]) return i; return 0; };

/* ---------- 首页 ---------- */
Pages.home = () => {
  const book = Books.cur(), gi = nextGroup(book), p = Store.d.profile, due = Store.due().length, miss = Store.mistakes().length;
  const h = new Date().getHours(), hi = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const streak = p.lastDay >= dayStr(-1) ? p.streak : 0, today = p.days[dayStr()] || { xp: 0, learned: 0 };
  const week = Array.from({ length: 7 }, (_, i) => { const d = dayStr(i - 6); return { d, xp: (p.days[d] || {}).xp || 0 }; });
  const max = Math.max(60, ...week.map((x) => x.xp));
  return `
    <section class="hero">
      <div class="hero-text">
        <h1>${hi}，小英雄！</h1>
        <p>每次只背 10 个词：先看一遍，再用字母拼，最后自己写。坚持每天一组，进步看得见。</p>
        <div class="row">
          <button class="btn primary big" data-act="home-continue">▶ 继续学习 · ${esc(book.name)} 第 ${gi + 1} 组</button>
          ${due ? `<button class="btn big light" data-act="home-review">🔁 今日复习 ${due} 词</button>` : ''}
        </div>
      </div>
      <div class="hero-art"><span>🦸</span><i>A</i><i>B</i><i>C</i></div>
    </section>
    <div class="stats">
      <div class="stat s1"><i>🔥</i><b>${streak}</b><span>连续学习天数</span></div>
      <div class="stat s2"><i>📖</i><b>${Store.learned()}</b><span>已学会的单词</span></div>
      <div class="stat s3"><i>⭐</i><b>${today.xp}</b><span>今日经验值</span></div>
      <div class="stat s4"><i>📕</i><b>${miss}</b><span>错词本里的词</span></div>
    </div>
    <h2 class="sec">选择学习方式</h2>
    <div class="mode-grid four">
      <button class="mode-card m1" data-act="nav" data-page="learn"><div class="mode-ico">📖</div><h3>三步记忆</h3><p>看一遍 → 字母拼词 → 默写。最扎实的记忆方法。</p><em>推荐</em></button>
      <button class="mode-card m2" data-act="nav" data-page="map"><div class="mode-ico">🗺️</div><h3>闯关挑战</h3><p>3 颗爱心闯一关，每 5 关一个 Boss，检验学习成果。</p></button>
      <button class="mode-card m3" data-act="nav" data-page="practice"><div class="mode-ico">🎮</div><h3>趣味练习</h3><p>听音拼写、闪电四选一、配对消消乐。</p></button>
      <button class="mode-card m4" data-act="nav" data-page="scan"><div class="mode-ico">📷</div><h3>拍照识词</h3><p>拍下老师发的单词表，马上就能学。</p></button>
    </div>
    <h2 class="sec">最近 7 天</h2>
    <div class="card week">${week.map((x) => `<div class="wk"><div class="wk-bar"><i style="height:${Math.round((x.xp / max) * 100)}%" title="${x.xp} XP"></i></div><span>${x.d === dayStr() ? '今天' : x.d.slice(5).replace('-', '/')}</span></div>`).join('')}</div>`;
};
Act['home-continue'] = () => { const b = Books.cur(); startGroup(b.id, nextGroup(b), () => go('home')); };
Act['home-review'] = () => Study.start({ words: Store.due().slice(0, 10), title: '今日复习', startStep: 2, onClose: () => go('home') });

/* ---------- 三步记忆：选词书、选组 ---------- */
const bookStrip = () => Books.all().map((b) => {
  const n = Books.groups(b).length, done = Object.keys(Books.prog(b.id).g).length;
  return `<button class="book ${b.id === Books.cur().id ? 'on' : ''}" data-act="book-pick" data-id="${b.id}"><div class="book-ico">${b.icon || '📘'}</div><div class="book-txt"><b>${esc(b.name)}</b><small>${b.words.length} 词 · ${n} 组</small><div class="mini-bar"><i style="width:${Math.round((done / n) * 100)}%"></i></div></div><span class="tag">${esc(b.level || '')}</span></button>`;
}).join('');

Pages.learn = () => {
  const book = Books.cur(), groups = Books.groups(book), g = Books.prog(book.id).g, next = nextGroup(book);
  return `
    <header class="page-head"><h1>三步记忆</h1><p>选一本词书，再选一组（10 个单词）。按顺序一组一组学，效果最好。</p></header>
    <div class="books">${bookStrip()}</div>
    <div class="sec-row"><h2 class="sec">${esc(book.name)}</h2><span class="mute">${esc(book.desc || '')}　已完成 ${Object.keys(g).length} / ${groups.length} 组</span>${book.custom ? `<span class="grow"></span><button class="btn ghost" data-act="list-del" data-id="${book.id}">🗑️ 删除这个词表</button>` : ''}</div>
    <div class="groups">${groups.map((ws, i) => `
      <button class="group ${g[i] ? 'done' : ''} ${i === next && !g[i] ? 'next' : ''}" data-act="group-open" data-gi="${i}">
        <div class="group-top"><b>第 ${i + 1} 组</b>${g[i] ? stars(g[i].stars) : i === next ? '<span class="tag hot">从这里开始</span>' : ''}</div>
        <div class="group-words">${ws.slice(0, 5).map((w) => esc(w.w)).join(' · ')}${ws.length > 5 ? ' …' : ''}</div>
      </button>`).join('')}</div>`;
};
Act['book-pick'] = (el) => { Store.d.bookId = el.dataset.id; Store.save(); go(App.page); };
Act['book-open'] = (el) => { Store.d.bookId = el.dataset.id; Store.save(); go('learn'); };
Act['group-open'] = async (el) => {
  const book = Books.cur(), gi = +el.dataset.gi, ws = Books.groups(book)[gi];
  Speak.preload(ws);
  const pick = await UI.modal(`
    <h3>${esc(book.name)} · 第 ${gi + 1} 组 <small class="mute">${ws.length} 个单词</small></h3>
    <div class="sheet-words">${ws.map((w, k) => `<div class="sw"><span class="s-no">${k + 1}</span><button class="link" data-act="say" data-w="${esc(w.w)}">🔊</button><b>${esc(w.w)}</b><small>${w.p ? '/' + esc(w.p) + '/' : ''}</small><span>${esc(w.m)}</span></div>`).join('')}</div>
    <div class="modal-btns"><button class="btn" data-act="sheet" data-v="game">⚔️ 闯关挑战</button><button class="btn" data-act="sheet" data-v="quiz">🧩 跳过第 ① 步，直接拼词</button><button class="btn primary" data-act="sheet" data-v="study" data-default>📖 开始三步记忆</button></div>`);
  if (pick === 'study') startGroup(book.id, gi, () => go('learn'));
  else if (pick === 'quiz') startGroup(book.id, gi, () => go('learn'), 2);
  else if (pick === 'game') {
    if (!Game.unlocked(book.id, gi)) UI.toast('这一关还没解锁：先通过前一关，或在设置里打开「解锁全部关卡」');
    else Game.start(book.id, gi, () => go('learn'));
  }
};
Act.sheet = (el) => UI.closeModal(el.dataset.v);

/* ---------- 闯关地图 ---------- */
Pages.map = () => {
  const book = Books.cur(), groups = Books.groups(book), lv = Books.prog(book.id).lv;
  const total = Object.values(lv).reduce((a, b) => a + b, 0);
  const rows = [];
  for (let i = 0; i < groups.length; i += 5) rows.push(groups.slice(i, i + 5).map((_, k) => i + k));
  const node = (li) => {
    const st = lv[li] || 0, open = Game.unlocked(book.id, li), boss = Game.isBoss(li);
    const cls = st ? 'done' : open ? 'open' : 'locked';
    return `<div class="lv-wrap"><button class="lv ${cls} ${boss ? 'boss' : ''}" data-act="lv-go" data-li="${li}" title="${esc(groups[li].map((w) => w.w).join(', '))}">${open ? (boss ? '👑' : li + 1) : '🔒'}</button><div class="lv-stars">${st ? stars(st) : boss ? '<small>Boss</small>' : `<small>第 ${li + 1} 关</small>`}</div></div>`;
  };
  return `
    <header class="page-head row"><div><h1>闯关挑战</h1><p>每关 10 个单词、3 颗爱心：选择 → 听音 → 拼词 → 默写，越来越难。通过一关解锁下一关。</p></div><span class="grow"></span><div class="star-total">★ ${total}<small> / ${groups.length * 3}</small></div></header>
    <div class="books">${bookStrip()}</div>
    <div class="map card">${rows.map((r) => `<div class="map-row">${r.map(node).join('')}</div>`).join('')}</div>`;
};
Act['lv-go'] = (el) => {
  const book = Books.cur(), li = +el.dataset.li;
  if (!Game.unlocked(book.id, li)) return UI.toast('🔒 先通过前一关才能解锁这一关');
  Game.start(book.id, li, () => go('map'));
};

/* ---------- 错词本 ---------- */
Pages.mistakes = () => {
  const list = Store.mistakes(), due = Store.due().length;
  if (!list.length) return `<header class="page-head"><h1>错词本</h1></header><div class="card empty"><div class="intro-ico">🎉</div><h3>错词本是空的</h3><p class="mute">默写时没有一次写对的词会自动收进这里。连续两次写对，它就会自己“毕业”。</p>${due ? `<button class="btn primary" data-act="home-review">🔁 今日还有 ${due} 个词待复习</button>` : ''}</div>`;
  return `
    <header class="page-head row"><div><h1>错词本</h1><p>共 ${list.length} 个词。连续两次默写正确，就会自动移出。</p></div><span class="grow"></span>
      <button class="btn" data-act="miss-dict">🎧 听音拼写</button><button class="btn primary" data-act="miss-study">📖 三步重学（前 ${Math.min(10, list.length)} 个）</button></header>
    <div class="card miss-list">${list.map((w) => `<div class="mrow"><button class="link" data-act="say" data-w="${esc(w.w)}">🔊</button><b>${esc(w.w)}</b><small>${w.p ? '/' + esc(w.p) + '/' : ''}</small><span class="grow">${esc(w.m)}</span><span class="tag bad">错 ${w.bad} 次</span><button class="btn ghost sm" data-act="miss-del" data-w="${esc(w.w)}">已掌握，移出</button></div>`).join('')}</div>`;
};
Act['miss-study'] = () => Study.start({ words: Store.mistakes().slice(0, 10).map(({ w, p, m }) => ({ w, p, m })), title: '错词重学', onClose: () => go('mistakes') });
Act['miss-dict'] = () => { if (Store.mistakes().length < 4) return UI.toast('错词不足 4 个，直接用「三步重学」吧'); Practice.src = 'miss'; Practice.begin('dictation'); Overlay.onClose = () => go('mistakes'); };
Act['miss-del'] = (el) => { const r = Store.d.words[el.dataset.w.toLowerCase()]; if (r) { r.miss = false; Store.save(); } go('mistakes'); };

/* ---------- 设置 ---------- */
const seg = (key, opts) => `<div class="seg">${opts.map(([v, label]) => `<button class="${String(Store.d.settings[key]) === String(v) ? 'on' : ''}" data-act="set" data-k="${key}" data-v="${v}">${label}</button>`).join('')}</div>`;
Pages.settings = () => {
  const v = Speak.voice();
  return `
    <header class="page-head"><h1>设置</h1></header>
    <div class="card settings">
      <div class="set-row"><div><b>外观</b><small>浅色或深色界面</small></div>${seg('theme', [['light', '☀️ 浅色'], ['dark', '🌙 深色']])}</div>
      <div class="set-row"><div><b>发音来源</b><small>「真人发音」需要联网（有道词典发音，听过的词会保存到本机）；没网时自动改用 Windows 语音</small></div>${seg('voice', [['auto', '真人发音优先'], ['system', '只用系统语音']])}</div>
      <div class="set-row"><div><b>口音</b><small>${v ? '系统英文语音：' + esc(v.name) : '⚠ 没找到 Windows 英文语音：可在 Windows「设置 → 时间和语言 → 语音」里添加英语语音'}</small></div>${seg('accent', [[2, '🇺🇸 美式'], [1, '🇬🇧 英式']])}<button class="btn" data-act="voice-test">🔊 试听</button></div>
      <div class="set-row"><div><b>看单词时朗读几遍</b><small>第 ① 步每个单词自动朗读的次数</small></div>${seg('repeat', [[1, '1 遍'], [2, '2 遍'], [3, '3 遍']])}</div>
      <div class="set-row"><div><b>音效</b><small>答对、答错时的提示音</small></div>${seg('sfx', [[true, '开'], [false, '关']])}</div>
      <div class="set-row"><div><b>解锁全部关卡</b><small>老师或家长想直接抽查任意一关时打开</small></div>${seg('unlockAll', [[false, '按顺序解锁'], [true, '全部解锁']])}</div>
      <div class="set-row"><div><b>学习数据</b><small>清空学习进度、错词本和经验值（自己建的词表会保留）</small></div><button class="btn danger" data-act="reset">重置学习进度</button></div>
    </div>
    <div class="card about"><b>单词小英雄 WordHero</b> v${esc(App.info.version || '')} · ${esc(App.info.platform || '')} ${esc(App.info.arch || '')}
      <p class="mute">词典数据与音标来自开源项目 ECDICT（MIT 许可）；小学、初中词书的中文释义经人工校对。离线文字识别使用 Tesseract，Windows 上同时使用系统自带的识别引擎复核。所有学习数据只保存在这台电脑上。</p></div>`;
};
Act.set = (el) => {
  const raw = el.dataset.v, v = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? +raw : raw;
  Store.d.settings[el.dataset.k] = v; Store.save(); applyTheme(); Speak.offlineUntil = 0; go('settings');
};
Act['voice-test'] = () => Speak.say('welcome', 1);
Act.reset = async () => {
  if (!(await UI.confirm('重置学习进度？', '所有学习进度、星星、错词本和经验值都会清空，不能恢复。', '重置', true))) return;
  const d = Store.d; d.prog = {}; d.words = {}; d.profile = Store.defaults().profile; Store.save(); UI.toast('已重置'); go('settings');
};

/* ---------- start-up ---------- */
(async () => {
  await Store.load(); await Books.load();
  App.info = await api.info();
  document.body.classList.add('os-' + App.info.platform);
  if (!Books.get(Store.d.bookId)) Store.d.bookId = 'primary';
  applyTheme(); go('home');
  if (window.speechSynthesis) speechSynthesis.getVoices();
})();
