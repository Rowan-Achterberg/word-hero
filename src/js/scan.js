/* 拍照识词: photo -> OCR (several readings + dictionary check) -> a person confirms -> saved as a word list. */
const Scan = {
  bitmap: null, rot: 0, preview: '', items: null, info: null, busy: '', name: '', manual: false, size: null,

  reset() { this.bitmap = null; this.rot = 0; this.preview = ''; this.items = null; this.info = null; this.busy = ''; this.manual = false; },

  async loadBlob(blob) {
    try { this.bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch { return UI.toast('这张图片打不开，请换一张 JPG / PNG 图片', 'bad'); }
    this.rot = 0; this.manual = false;
    await this.recognize();
  },

  // Draw the photo upright at the wanted scale, then flatten lighting and binarise for the two OCR passes.
  async prepare(scale) {
    const b = this.bitmap, turned = this.rot % 180 !== 0;
    const w = Math.round((turned ? b.height : b.width) * scale), h = Math.round((turned ? b.width : b.height) * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2); ctx.rotate((this.rot * Math.PI) / 180);
    ctx.drawImage(b, (-b.width * scale) / 2, (-b.height * scale) / 2, b.width * scale, b.height * scale);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.preview || this._prevRot !== this.rot) { // preview of the original colours, for the checking screen
      const k = Math.min(1, 1400 / Math.max(w, h)), p = document.createElement('canvas'); p.width = Math.round(w * k); p.height = Math.round(h * k);
      p.getContext('2d').drawImage(c, 0, 0, p.width, p.height); this.preview = p.toDataURL('image/jpeg', 0.85); this._prevRot = this.rot;
    }
    const img = ctx.getImageData(0, 0, w, h);
    const flat = Preprocess.flatten(Preprocess.toGray(img.data, w * h), w, h), bin = Preprocess.binarize(flat);
    const png = async (px) => {
      const d = img.data; for (let i = 0, j = 0; i < px.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = px[i]; d[j + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      return (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer();
    };
    return { gray: await png(flat), bin: await png(bin), w, h };
  },

  async recognize() {
    const long = Math.max(this.bitmap.width, this.bitmap.height);
    let scale = Math.min(3, Math.max(0.3, 2600 / long));
    this.preview = ''; this.items = null; this.busy = '正在处理图片…'; go('scan');
    api.onOcrProgress((p) => { this.busy = p.text; const el = $('#scan-busy'); if (el) el.textContent = p.text; });
    try {
      let res, prep;
      for (let attempt = 0; attempt < 2; attempt++) {
        prep = await this.prepare(scale);
        res = await api.ocr({ gray: prep.gray, bin: prep.bin });
        if (!res.ok) throw new Error(res.error);
        // Text much smaller or larger than the size OCR reads best: rescale once and read again.
        const hs = res.items.map((i) => i.bbox.y1 - i.bbox.y0).sort((a, b) => a - b), med = hs[Math.floor(hs.length / 2)];
        if (attempt || hs.length < 3 || (med >= 28 && med <= 95)) break;
        const next = Math.min(4, Math.max(0.25, (scale * 44) / med));
        if (Math.abs(next / scale - 1) < 0.25 || long * next > 4600) break;
        scale = next; this.busy = '文字偏' + (med < 28 ? '小' : '大') + '，调整大小后再识别一遍…'; const el = $('#scan-busy'); if (el) el.textContent = this.busy;
      }
      this.size = { w: prep.w, h: prep.h };
      this.items = res.items; this.info = { ignored: res.ignored, engines: res.engines };
      const d = new Date(); this.name = `拍照词表 ${d.getMonth() + 1}-${d.getDate()}`;
      if (!res.items.length) UI.toast('没有识别到英文单词。请确认照片清晰、文字是正的，或点「旋转」后重试。', 'bad');
    } catch (err) {
      this.items = null; UI.toast('识别失败：' + err.message, 'bad');
    }
    this.busy = ''; go('scan');
  },

  async fromText(text) {
    const rows = [];
    for (const raw of text.split(/[\n;；]+/)) {
      const line = raw.replace(/\b(n|v|vt|vi|adj|adv|prep|pron|conj|int|art|num|aux)\.\s*/gi, ' ');
      const m = line.trim().match(/^[\d.、)\s]*([A-Za-z][A-Za-z'’\- ]*?)(?:\s*[:：=,，\t]\s*|\s+(?=[^\x00-\x7F])|\s*$)(.*)$/);
      if (m) rows.push({ w: m[1].trim(), m: m[2].trim() });
    }
    if (!rows.length) return UI.toast('没有找到英文单词，每行写一个，例如：apple 苹果');
    const found = await api.lookup(rows.map((r) => r.w));
    const seen = new Set(); this.items = [];
    for (let i = 0; i < rows.length; i++) {
      const e = found[i], w = e ? e.w : rows[i].w;
      if (seen.has(w.toLowerCase())) continue; seen.add(w.toLowerCase());
      // a phrase the dictionary does not list is fine when every word in it is a real word
      const parts = w.split(/[ ]+/), phrase = !e && parts.length > 1 && (await api.lookup(parts)).every(Boolean);
      const m = rows[i].m || (e ? e.m : '');
      this.items.push({ w, raw: rows[i].w, p: e ? e.p : '', m, mEdited: !!rows[i].m, status: e ? 'ok' : phrase ? 'warn' : 'bad',
        note: e ? '' : phrase ? (m ? '短语：每个单词都已核对' : '短语：请填写中文意思后再勾选') : '词典里没有这个词，请确认拼写',
        sugg: e || phrase ? [] : await api.suggest(rows[i].w), checked: !!e || (phrase && !!m), bbox: null });
    }
    this.manual = true; this.preview = ''; this.info = { ignored: 0, engines: [] };
    const d = new Date(); this.name = `我的词表 ${d.getMonth() + 1}-${d.getDate()}`;
    go('scan');
  },

  async setWord(i, value) {
    const it = this.items[i], v = value.trim(); if (!v) return;
    const [e] = await api.lookup([v]);
    if (e) { Object.assign(it, { w: e.w, p: e.p, status: 'ok', note: '已改正并通过词典核对', sugg: [], checked: true }); if (!it.mEdited) it.m = e.m; }
    else { Object.assign(it, { w: v, p: '', status: 'bad', note: '词典里没有这个词，请确认拼写', checked: false, sugg: await api.suggest(v) }); if (!it.mEdited) it.m = ''; }
    this.redraw();
  },
  redraw() { const el = $('#scan-review'); if (el) { const y = $('.scan-rows')?.scrollTop || 0; el.innerHTML = this.reviewHtml(); $('.scan-rows').scrollTop = y; this.bind(); } },

  reviewHtml() {
    const it = this.items, n = it.filter((x) => x.checked).length;
    const cnt = (s) => it.filter((x) => x.status === s).length;
    const chip = { ok: '<span class="st ok">✓ 已核对</span>', warn: '<span class="st warn">⚠ 请确认</span>', bad: '<span class="st bad">✗ 可能有误</span>' };
    return `
      <div class="scan-sum">
        <b>共 ${it.length} 个单词</b><span class="st ok">✓ ${cnt('ok')} 已核对</span><span class="st warn">⚠ ${cnt('warn')} 请确认</span><span class="st bad">✗ ${cnt('bad')} 可能有误</span>
        ${this.info.ignored ? `<span class="mute">另有 ${this.info.ignored} 处看不清的片段已忽略</span>` : ''}
        ${this.info.engines.length ? `<span class="mute" title="${esc(this.info.engines.join(' + '))}">${this.info.engines.length} 遍识别互相印证</span>` : ''}
      </div>
      <div class="scan-note">只有<b>打勾</b>的词会进入学习。黄色和红色的词默认不勾选，请对照${this.manual ? '原文' : '左边原图'}确认或改正；单词和中文都可以直接修改。</div>
      <div class="scan-rows">
        ${it.map((x, i) => `
          <div class="srow ${x.status} ${x.checked ? '' : 'off'}" data-i="${i}">
            <input type="checkbox" class="s-chk" ${x.checked ? 'checked' : ''} title="加入词表">
            <span class="s-no">${i + 1}</span>
            <input class="s-w" value="${esc(x.w)}" spellcheck="false" title="单词（可修改）">
            <input class="s-m" value="${esc(x.m)}" placeholder="中文意思" title="中文意思（可修改）">
            <div class="s-st">${chip[x.status]}${x.sugg && x.sugg.length ? x.sugg.map((s) => `<button class="chip s-sugg" data-s="${esc(s)}" title="改成这个词">${esc(s)}</button>`).join('') : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</div>
            <button class="icon-btn s-say" title="听发音">🔊</button><button class="icon-btn s-del" title="删除这一行">✕</button>
          </div>`).join('')}
      </div>
      <div class="scan-foot">
        <button class="btn ghost" data-act="scan-all">全选已核对</button><button class="btn ghost" data-act="scan-none">全不选</button>
        <span class="grow"></span>
        <input id="scan-name" value="${esc(this.name)}" maxlength="24" title="词表名称">
        <button class="btn" data-act="scan-save" ${n ? '' : 'disabled'}>保存词表（${n} 词）</button>
        <button class="btn primary" data-act="scan-learn" ${n ? '' : 'disabled'}>保存并开始学习 →</button>
      </div>`;
  },
  bind() {
    const rows = $('.scan-rows'); if (!rows) return;
    const idx = (el) => +el.closest('.srow').dataset.i;
    rows.onchange = async (e) => {
      const i = idx(e.target), it = this.items[i];
      if (e.target.classList.contains('s-w')) return this.setWord(i, e.target.value);
      if (e.target.classList.contains('s-m')) { it.m = e.target.value.trim(); it.mEdited = true; return; }
      if (e.target.classList.contains('s-chk')) {
        if (e.target.checked && it.status === 'bad') {
          if (!it.m) { UI.toast('词典里没有这个词：请先确认拼写并填上中文意思'); e.target.checked = false; return; }
          if (!(await UI.confirm('确认加入这个词？', `词典里没有收录 “${it.w}”。请再对照一遍原文，确认拼写完全正确。`, '拼写正确，加入'))) { e.target.checked = false; return; }
          it.status = 'warn'; it.note = '由你确认的词'; it.sugg = [];
        } else if (e.target.checked && it.status === 'warn') {
          if (!it.m) { UI.toast('请先填上中文意思'); e.target.checked = false; return; }
          it.status = 'ok'; it.note = '已由你确认';
        }
        it.checked = e.target.checked; this.redraw();
      }
    };
    rows.onclick = (e) => {
      const row = e.target.closest('.srow'); if (!row) return; const i = +row.dataset.i;
      if (e.target.closest('.s-sugg')) this.setWord(i, e.target.closest('.s-sugg').dataset.s);
      else if (e.target.closest('.s-say')) Speak.say(this.items[i].w, 1);
      else if (e.target.closest('.s-del')) { this.items.splice(i, 1); this.redraw(); this.drawBoxes(); }
    };
    rows.onmouseover = (e) => { const row = e.target.closest('.srow'); $$('.box.hot').forEach((b) => b.classList.remove('hot')); if (row) $(`.box[data-i="${row.dataset.i}"]`)?.classList.add('hot'); };
    const nm = $('#scan-name'); if (nm) nm.oninput = () => { this.name = nm.value; };
  },
  drawBoxes() {
    const host = $('#scan-boxes'); if (!host || !this.size) return;
    host.innerHTML = this.items.map((x, i) => (x.bbox ? `<i class="box ${x.status}" data-i="${i}" style="left:${(x.bbox.x0 / this.size.w) * 100}%;top:${(x.bbox.y0 / this.size.h) * 100}%;width:${((x.bbox.x1 - x.bbox.x0) / this.size.w) * 100}%;height:${((x.bbox.y1 - x.bbox.y0) / this.size.h) * 100}%"></i>` : '')).join('');
  },

  save() {
    const picked = this.items.filter((x) => x.checked);
    const badRow = picked.find((x) => !/^[A-Za-z][A-Za-z'\- ]*$/.test(x.w) || !x.m.trim());
    if (badRow) { UI.toast(`“${badRow.w}” 还缺中文意思或拼写里有奇怪的符号，请先改好`, 'bad'); return null; }
    const list = { id: 'c' + Date.now(), name: (this.name || '我的词表').trim(), custom: true, icon: this.manual ? '✏️' : '📷', level: '我的词表', desc: `${dayStr()} 创建`, words: picked.map((x) => ({ w: x.w, p: x.p || '', m: x.m.trim() })) };
    Store.d.lists.push(list); Store.d.bookId = list.id; Store.save(); this.reset();
    UI.toast(`已保存「${list.name}」，共 ${list.words.length} 个单词，按原顺序每 10 个一组`, 'good');
    return list;
  },

};
// UI.modal resolves only after the modal is torn down, so grab the frame first.
(() => {
  const close = UI.closeModal.bind(UI);
  UI.closeModal = (value) => {
    const video = $('#cam');
    if (value && video && video.videoWidth) { const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0); Scan._shot = c; }
    close(value);
  };
})();
Scan.camera = async function () {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 2560 }, height: { ideal: 1440 } } }); }
  catch { return UI.toast('打不开摄像头。请检查 Windows「隐私和安全性 → 相机」权限，或改用手机拍照后传到电脑。', 'bad'); }
  Scan._shot = null;
  const done = UI.modal('<h3>摄像头拍照</h3><p class="mute">把单词表放平、摆正、光线均匀，让文字尽量占满画面。</p><video id="cam" autoplay playsinline muted></video><div class="modal-btns"><button class="btn" data-act="modal-no">取消</button><button class="btn primary" data-act="modal-yes" data-default>📸 拍照并识别</button></div>');
  $('#cam').srcObject = stream;
  const ok = await done;
  stream.getTracks().forEach((t) => t.stop());
  if (ok && Scan._shot) Scan.loadBlob(await new Promise((r) => Scan._shot.toBlob(r, 'image/png')));
};

Act['scan-pick'] = async () => { const f = await api.pickImage(); if (f) Scan.loadBlob(new Blob([f.data])); };
Act['scan-camera'] = () => Scan.camera();
Act['scan-rotate'] = () => { Scan.rot = (Scan.rot + 90) % 360; Scan.recognize(); };
Act['scan-new'] = () => { Scan.reset(); go('scan'); };
Act['scan-all'] = () => { Scan.items.forEach((x) => { if (x.status === 'ok') x.checked = true; }); Scan.redraw(); };
Act['scan-none'] = () => { Scan.items.forEach((x) => { x.checked = false; }); Scan.redraw(); };
Act['scan-save'] = () => { if (Scan.save()) go('learn'); };
Act['scan-learn'] = () => { const l = Scan.save(); if (l) { go('learn'); startGroup(l.id, 0, () => go('learn')); } };
Act['scan-text'] = async () => {
  const ok = await UI.modal('<h3>手动输入单词</h3><p class="mute">每行一个单词，可以带中文意思（不写就自动查词典）。也可以直接粘贴一整列。</p><textarea id="scan-ta" rows="10" spellcheck="false" placeholder="apple 苹果&#10;banana&#10;library 图书馆"></textarea><div class="modal-btns"><button class="btn" data-act="modal-no">取消</button><button class="btn primary" data-act="scan-text-ok">核对单词 →</button></div>');
  if (ok) Scan.fromText(ok);
};
Act['scan-text-ok'] = () => UI.closeModal($('#scan-ta').value);
Act['list-del'] = async (el) => {
  const l = Books.get(el.dataset.id); if (!l) return;
  if (!(await UI.confirm('删除词表？', `「${l.name}」和它的学习进度会被删除，背过的单词记录仍会保留。`, '删除', true))) return;
  Store.d.lists = Store.d.lists.filter((x) => x.id !== l.id); delete Store.d.prog[l.id];
  if (Store.d.bookId === l.id) Store.d.bookId = 'primary';
  Store.save(); go(App.page);
};
document.addEventListener('paste', (e) => {
  if (App.page !== 'scan' || Scan.busy || !$('#modal').hidden) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); Scan.loadBlob(item.getAsFile()); }
});

Pages.scan = () => {
  if (Scan.busy) return `<header class="page-head"><h1>拍照识词</h1></header><div class="card scan-wait"><div class="spinner"></div><h3 id="scan-busy">${esc(Scan.busy)}</h3><p class="mute">为了不认错字，会用不同方式识别好几遍再逐词对照词典，通常需要 5～20 秒。</p></div>`;
  if (Scan.items) {
    return `<header class="page-head row"><div><h1>核对单词</h1><p>确认无误后保存。顺序与${Scan.manual ? '你输入的' : '照片上'}一致，学习时每 10 个一组。</p></div><span class="grow"></span>
      ${Scan.manual ? '' : '<button class="btn" data-act="scan-rotate">⟳ 旋转 90° 重新识别</button>'}<button class="btn" data-act="scan-new">换一张 / 重新开始</button></header>
      <div class="scan-main ${Scan.manual ? 'no-img' : ''}">
        ${Scan.manual ? '' : `<div class="scan-img card"><div class="scan-img-in"><img src="${Scan.preview}" alt=""><div id="scan-boxes"></div></div></div>`}
        <div class="card scan-review" id="scan-review">${Scan.reviewHtml()}</div>
      </div>`;
  }
  const mine = Store.d.lists;
  return `
    <header class="page-head"><h1>拍照识词</h1><p>拍下课本、试卷或老师发的单词表，自动抓出英文单词，按原来的顺序每 10 个一组来学。</p></header>
    <div class="drop card" id="drop">
      <div class="drop-ico">📷</div><h3>把单词表照片拖到这里</h3><p class="mute">也可以按 Ctrl + V 粘贴截图</p>
      <div class="row center"><button class="btn primary big" data-act="scan-pick">选择图片</button><button class="btn big" data-act="scan-camera">摄像头拍照</button><button class="btn big" data-act="scan-text">手动输入 / 粘贴单词</button></div>
    </div>
    <div class="tips card"><h3>怎样拍，识别最准？</h3><ul><li>📄 纸放平、摆正，文字不要歪</li><li>💡 光线均匀，避免手机的影子和反光</li><li>🔍 一次只拍一页，让文字占满画面，对好焦</li><li>🖨️ 印刷体识别最可靠；手写体请用「手动输入」</li></ul>
      <p class="mute">每个识别出的词都会和内置 3 万词词典逐一核对，对不上的词不会自动进入学习，需要你确认。</p></div>
    ${mine.length ? `<h2 class="sec">我的词表</h2><div class="mylists">${mine.map((l) => `<div class="card mylist"><div class="ml-ico">${l.icon || '📷'}</div><div class="grow"><b>${esc(l.name)}</b><small>${l.words.length} 个单词 · ${Math.ceil(l.words.length / 10)} 组 · ${esc(l.desc || '')}</small></div><button class="btn primary" data-act="book-open" data-id="${l.id}">去学习</button><button class="icon-btn" data-act="list-del" data-id="${l.id}" title="删除">🗑️</button></div>`).join('')}</div>` : ''}`;
};
Pages.scan.mount = () => {
  Scan.bind(); Scan.drawBoxes();
  const drop = $('#drop'); if (!drop) return;
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) Scan.loadBlob(f); else UI.toast('请拖入图片文件'); };
};
