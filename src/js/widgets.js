/* Question widgets shared by the study flow, the challenge game and the practice modes.
   Each one renders into `host`, handles its own feedback, then calls onDone({correct, hinted}). */

const isLetter = (c) => /[A-Za-z]/.test(c);

// Step 2: the meaning plus exactly the letters of the word, shuffled.
function scrambleWidget(host, word, { onDone, speak = true }) {
  const chars = [...word.w];
  const target = chars.filter(isLetter);
  let tiles = target.map((c) => ({ c }));
  const distinct = new Set(target.map((c) => c.toLowerCase())).size > 1;
  for (let i = 0; i < 30; i++) { tiles = shuffle(tiles); if (!distinct || tiles.map((t) => t.c).join('') !== target.join('')) break; }
  const slots = new Array(target.length).fill(null); // index into tiles
  const fixed = new Set();
  let locked = false, hinted = false;
  const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

  const draw = (state = '') => {
    let k = 0;
    const slotHtml = chars.map((c) => {
      if (!isLetter(c)) return `<span class="gap">${c === ' ' ? '' : esc(c)}</span>`;
      const i = k++, t = slots[i];
      let cls = t == null ? '' : ' filled';
      if (fixed.has(i)) cls += ' hint';
      if (state === 'right') cls += ' ok';
      if (state === 'wrong' && t != null) cls += eq(tiles[t].c, target[i]) ? ' ok' : ' bad';
      if (state === 'reveal') return `<button class="slot filled reveal">${esc(target[i])}</button>`;
      return `<button class="slot${cls}" data-s="${i}">${t == null ? '' : esc(tiles[t].c)}</button>`;
    }).join('');
    const used = new Set(slots.filter((x) => x != null));
    host.innerHTML = `
      <div class="q-tag">看中文，用下面的字母拼出单词</div>
      <div class="q-mean">${esc(word.m)}</div>
      <div class="slots ${state === 'wrong' ? 'shake' : ''}">${slotHtml}</div>
      <div class="tiles">${tiles.map((t, i) => `<button class="tile${used.has(i) ? ' used' : ''}" data-t="${i}">${esc(t.c)}</button>`).join('')}</div>
      <div class="q-fb">${state === 'right' ? '<span class="good">✓ 拼对了！</span>' : state === 'reveal' ? `<span class="warn">正确拼写是 <b>${esc(word.w)}</b>，记住它，等会儿再拼一次</span>` : '<span class="mute">点字母或直接敲键盘 · 退格键撤销</span>'}</div>
      <div class="q-actions"><button class="btn ghost" data-w="hint">💡 提示一个字母</button><button class="btn ghost" data-w="clear">↺ 清空</button><button class="btn ghost" data-w="giveup">不会，看答案</button></div>`;
  };

  const finish = (correct) => {
    locked = true;
    if (correct) { draw('right'); Snd.ok(); if (speak) Speak.say(word.w, 1); setTimeout(() => onDone({ correct: true, hinted }), 1000); }
    else { draw('reveal'); if (speak) Speak.say(word.w, 1); setTimeout(() => onDone({ correct: false, hinted }), 2300); }
  };
  const check = () => {
    if (slots.some((x) => x == null)) return draw();
    if (slots.every((t, i) => eq(tiles[t].c, target[i]))) return finish(true);
    locked = true; draw('wrong'); Snd.bad(); setTimeout(() => finish(false), 1100);
  };
  const place = (ti) => { const i = slots.indexOf(null); if (i < 0 || slots.includes(ti)) return; slots[i] = ti; Snd.tap(); check(); };
  const unplace = (i) => { if (slots[i] == null || fixed.has(i)) return; slots[i] = null; draw(); };
  const hint = () => {
    const i = slots.findIndex((t, k) => t == null || !eq(tiles[t].c, target[k]));
    if (i < 0) return;
    hinted = true; slots[i] = null;
    let ti = tiles.findIndex((t, k) => eq(t.c, target[i]) && !slots.includes(k));
    if (ti < 0) { // the needed letter sits in a later, wrong slot: take it back
      const j = slots.findIndex((t, k) => k > i && t != null && eq(tiles[t].c, target[i]) && !fixed.has(k));
      if (j < 0) return; ti = slots[j]; slots[j] = null;
    }
    slots[i] = ti; fixed.add(i); check();
  };

  host.onclick = (e) => {
    if (locked) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t != null) place(+b.dataset.t);
    else if (b.dataset.s != null) unplace(+b.dataset.s);
    else if (b.dataset.w === 'hint') hint();
    else if (b.dataset.w === 'clear') { slots.forEach((_, i) => { if (!fixed.has(i)) slots[i] = null; }); draw(); }
    else if (b.dataset.w === 'giveup') finish(false);
  };
  Keys.on((e) => {
    if (locked || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Backspace') { for (let i = slots.length - 1; i >= 0; i--) if (slots[i] != null && !fixed.has(i)) { unplace(i); break; } e.preventDefault(); }
    else if (e.key.length === 1 && isLetter(e.key)) {
      const want = target[slots.indexOf(null)];
      // prefer the tile whose case matches the slot, so "A…a" words fill naturally
      let ti = tiles.findIndex((t, k) => t.c === want && eq(t.c, e.key) && !slots.includes(k));
      if (ti < 0) ti = tiles.findIndex((t, k) => eq(t.c, e.key) && !slots.includes(k));
      if (ti >= 0) place(ti); else Snd.bad();
    }
  });
  draw();
}

// Step 3 (and dictation): type the whole word from memory.
function spellWidget(host, word, { onDone, mode = 'meaning', copyOnWrong = true, speak = true }) {
  let phase = 'ask', hinted = false, locked = false;
  host.innerHTML = `
    <div class="q-tag">${mode === 'listen' ? '听发音，写出单词' : '看中文，写出单词'}</div>
    ${mode === 'listen' ? '<button class="big-speak" data-w="listen">🔊</button><div class="q-mean small" id="sp-mean"></div>' : `<div class="q-mean">${esc(word.m)}</div>`}
    <input class="spell-in" id="sp-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="在这里输入单词">
    <div class="q-fb" id="sp-fb"><span class="mute">输入后按回车键确认</span></div>
    <div class="q-actions"><button class="btn primary" data-w="ok">确定</button>${mode === 'listen' ? '' : '<button class="btn ghost" data-w="listen">🔊 听一听</button>'}<button class="btn ghost" data-w="first">💡 首字母</button><button class="btn ghost" data-w="giveup">不会</button></div>`;
  const input = $('#sp-in', host), fb = $('#sp-fb', host);
  setTimeout(() => input.focus(), 30);
  if (mode === 'listen') Speak.say(word.w, 2);

  const diff = (guess) => [...guess].map((c, i) => `<span class="${word.w[i] && c.toLowerCase() === word.w[i].toLowerCase() ? 'dok' : 'dbad'}">${esc(c)}</span>`).join('');
  const wrong = (guess) => {
    Snd.bad(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 500);
    if (speak) Speak.say(word.w, 1);
    if (mode === 'listen') $('#sp-mean', host).textContent = word.m;
    const mine = guess ? `<div class="mine">你写的：${diff(guess)}</div>` : '';
    if (!copyOnWrong) { locked = true; input.disabled = true; fb.innerHTML = `<div class="answer">正确拼写：<b>${esc(word.w)}</b></div>${mine}`; setTimeout(() => onDone({ correct: false, hinted }), 2400); return; }
    phase = 'copy'; input.value = ''; input.placeholder = '照着上面写一遍';
    fb.innerHTML = `<div class="answer">正确拼写：<b>${esc(word.w)}</b></div>${mine}<div class="mute">照着写一遍加深记忆，等会儿还会再考你 💪</div>`;
    input.focus();
  };
  const submit = () => {
    if (locked) return;
    const guess = input.value.trim();
    if (phase === 'copy') {
      if (sameWord(guess, word.w)) { locked = true; input.classList.add('ok'); Snd.tap(); setTimeout(() => onDone({ correct: false, hinted }), 500); }
      else { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 500); }
      return;
    }
    if (!guess) return input.focus();
    if (sameWord(guess, word.w)) {
      locked = true; input.classList.add('ok'); input.value = word.w; Snd.ok(); if (speak) Speak.say(word.w, 1);
      if (mode === 'listen') $('#sp-mean', host).textContent = word.m;
      const caseTip = guess.replace(/\s+/g, ' ') !== word.w ? `　<span class="warn">注意大小写：${esc(word.w)}</span>` : '';
      fb.innerHTML = `<span class="good">✓ 完全正确！</span>${caseTip}`;
      setTimeout(() => onDone({ correct: true, hinted }), caseTip ? 1800 : 1000);
    } else wrong(guess);
  };
  host.onclick = (e) => {
    const b = e.target.closest('button'); if (!b || locked) return;
    const w = b.dataset.w;
    if (w === 'ok') submit();
    else if (w === 'listen') { if (mode !== 'listen') hinted = true; Speak.say(word.w, 1); input.focus(); }
    else if (w === 'first') { hinted = true; if (!input.value) input.value = word.w[0]; fb.innerHTML = `<span class="mute">首字母是 <b>${esc(word.w[0])}</b>，共 ${[...word.w].filter(isLetter).length} 个字母</span>`; input.focus(); }
    else if (w === 'giveup' && phase === 'ask') wrong('');
  };
  Keys.on((e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

// Four-option question. options: [{label, correct}]
function choiceWidget(host, { tag, promptHtml, options, onDone, after }) {
  let locked = false;
  host.innerHTML = `<div class="q-tag">${esc(tag)}</div>${promptHtml}
    <div class="choices">${options.map((o, i) => `<button class="choice" data-c="${i}"><kbd>${i + 1}</kbd><span>${esc(o.label)}</span></button>`).join('')}</div>`;
  const pick = (i) => {
    if (locked || !options[i]) return; locked = true;
    const ok = !!options[i].correct;
    $$('.choice', host).forEach((b, k) => { if (options[k].correct) b.classList.add('ok'); else if (k === i) b.classList.add('bad'); b.disabled = true; });
    if (ok) Snd.ok(); else Snd.bad();
    if (after) after(ok);
    setTimeout(() => onDone({ correct: ok }), ok ? 800 : 1700);
  };
  host.onclick = (e) => { const b = e.target.closest('.choice'); if (b) pick(+b.dataset.c); };
  Keys.on((e) => { if (/^[1-4]$/.test(e.key)) pick(+e.key - 1); });
}

// Do two Chinese glosses share a sense ("嗨；你好" vs "你好")? Such words must never be offered as wrong answers for each other.
const senses = (m) => m.replace(/（[^）]*）|\([^)]*\)|[a-z]+\.\s*/g, '').split(/[；;，,、]/).map((x) => x.trim()).filter(Boolean);
const sameSense = (a, b) => { const sa = senses(a.m); return a.w.toLowerCase() === b.w.toLowerCase() || senses(b.m).some((x) => sa.includes(x)); };

// Three wrong answers for a word, taken from its neighbours in the book (same topic, similar difficulty).
function distractors(word, pool, field) {
  const out = [];
  for (const w of shuffle(pool)) {
    if (sameSense(word, w) || out.some((o) => sameSense(o, w))) continue;
    out.push(w);
    if (out.length === 3) break;
  }
  return out;
}
