'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const EVENTS = [
  'pet:dragging',
  'pet:react',
  'pet:sleep',
  'chat:append',
  'chat:stream',
  'chat:stream-end',
  'chat:state',
  'chat:cleared',
  'chat:focus',
  'chat:opened',
  'chat:open-settings',
  'config:changed',
  'update:state',
  'speech:speak',
  'speech:preview',
  'speech:stop',
  'speech:state',
]

contextBridge.exposeInMainWorld('api', {
  /* Arranque y configuración */
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  testConfig: (form) => ipcRenderer.invoke('config:test', form),
  openDataFolder: () => ipcRenderer.send('app:open-data-folder'),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  quit: () => ipcRenderer.invoke('app:quit'),

  /* Chat */
  sendChat: (text) => ipcRenderer.invoke('chat:send', text),
  stopChat: () => ipcRenderer.invoke('chat:stop'),
  clearChat: () => ipcRenderer.invoke('chat:clear'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openChat: () => ipcRenderer.send('chat:open'),
  toggleChat: () => ipcRenderer.send('chat:toggle'),
  hideChat: () => ipcRenderer.send('chat:hide'),
  minimizeChat: () => ipcRenderer.send('chat:minimize'),
  openSettings: () => ipcRenderer.send('chat:open-settings'),

  /* Mascota */
  dragStart: (point) => ipcRenderer.send('pet:drag-start', point),
  dragMove: (point) => ipcRenderer.send('pet:drag-move', point),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  setInteractive: (interactive) => ipcRenderer.send('pet:interactive', interactive),
  setShape: (rects) => ipcRenderer.send('pet:shape', rects),
  readFrame: (file) => ipcRenderer.invoke('asset:read-frame', file),
  savePosition: () => ipcRenderer.send('pet:save-position'),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),

  /* Voz */
  reportSpeech: (speaking) => ipcRenderer.send('speech:state', speaking),
  stopSpeaking: () => ipcRenderer.send('speech:stop'),
  previewVoice: (text, voice) => ipcRenderer.send('speech:preview', { text, voice }),
  transcribe: (audio, mime) => ipcRenderer.invoke('asr:transcribe', { audio, mime }),

  /* Eventos */
  on: (channel, callback) => {
    if (!EVENTS.includes(channel)) return () => {}
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
