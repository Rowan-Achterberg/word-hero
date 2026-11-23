const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  wordbank: () => ipcRenderer.invoke('wordbank'),
  info: () => ipcRenderer.invoke('app:info'),
  setTheme: (dark) => ipcRenderer.send('theme', dark),
  lookup: (words) => ipcRenderer.invoke('dict:lookup', words),
  suggest: (word) => ipcRenderer.invoke('dict:suggest', word),
  ocr: (images) => ipcRenderer.invoke('ocr:run', images),
  onOcrProgress: (cb) => { ipcRenderer.removeAllListeners('ocr:progress'); ipcRenderer.on('ocr:progress', (_e, p) => cb(p)); },
  pickImage: () => ipcRenderer.invoke('dialog:image'),
  tts: (text, accent) => ipcRenderer.invoke('tts', text, accent),
});
