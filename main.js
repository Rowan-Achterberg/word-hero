const { app, BrowserWindow, ipcMain, dialog, net, nativeTheme, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const dict = require('./dict');
const ocr = require('./ocr');

let win = null;
const userFile = (...p) => path.join(app.getPath('userData'), ...p);
const STORE = () => userFile('wordhero-data.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 980, minHeight: 660,
    show: false,
    backgroundColor: '#f3f5fb',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#3b3b3b', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { if (!process.env.WH_TEST) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.WH_TEST) require(path.resolve(process.env.WH_TEST))(win, app);
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // only the camera (for photographing a word list) is ever granted
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  createWindow();
});
app.on('window-all-closed', async () => { await ocr.shutdown(); app.quit(); });

// ---------- data ----------
ipcMain.handle('store:load', () => {
  for (const f of [STORE(), STORE() + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* try backup */ }
  }
  return null;
});
ipcMain.handle('store:save', (_e, data) => {
  const f = STORE();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);
    return true;
  } catch { return false; }
});
ipcMain.handle('wordbank', () => JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'wordbank.json'), 'utf8')));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }));
ipcMain.on('theme', (_e, dark) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f2f2f2' : '#3b3b3b', height: 40 }); } catch { /* not on this platform */ }
});

// ---------- dictionary ----------
ipcMain.handle('dict:lookup', (_e, words) => words.map((w) => {
  const e = dict.lookup(w);
  return e ? { w: e.w, p: e.p, m: e.m } : null;
}));
ipcMain.handle('dict:suggest', (_e, word) => dict.suggest(word));

// ---------- OCR ----------
ipcMain.handle('ocr:run', async (e, images) => {
  try {
    const res = await ocr.run({ gray: Buffer.from(images.gray), bin: Buffer.from(images.bin), w: images.w }, (p) => e.sender.send('ocr:progress', p));
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('dialog:image', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择单词表照片', properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const buf = fs.readFileSync(r.filePaths[0]);
  return { name: path.basename(r.filePaths[0]), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

// ---------- pronunciation: real-voice audio (cached on disk), the page falls back to the system voice ----------
ipcMain.handle('tts', async (_e, text, accent) => {
  const type = accent === 1 ? 1 : 2; // 1 = British, 2 = American
  const clean = String(text || '').trim().slice(0, 60);
  if (!/^[A-Za-z][A-Za-z '’-]*$/.test(clean)) return null;
  const file = userFile('audio', String(type), encodeURIComponent(clean.toLowerCase()) + '.mp3');
  const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  try { return toAB(fs.readFileSync(file)); } catch { /* not cached yet */ }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3500);
  try {
    const r = await net.fetch(`https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(clean)}`, { signal: ctl.signal });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 800 || !/audio|mpeg|octet/.test(r.headers.get('content-type') || '')) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return toAB(buf);
  } catch { return null; } finally { clearTimeout(timer); }
});
