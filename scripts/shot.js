'use strict'

/* Script de desarrollo: captura y diagnóstico de las ventanas. */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

ipcMain.handle('asset:read-frame', (event, name, index) => {
  const folders = { tail: '03_cola', blink: '01_parpadeo', wave: '02_saludo' }
  const folder = folders[name]
  const number = Number(index) + 1
  if (!folder || !Number.isInteger(number) || number < 1 || number > 6) return ''
  try {
    return fs.readFileSync(
      path.join(__dirname, '..', 'assets', folder, `fotograma_0${number}.svg`),
      'utf8',
    )
  } catch {
    return ''
  }
})

ipcMain.handle('app:bootstrap', () => ({
  config: {
    provider: 'gemini',
    apiKey: '',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    petName: 'Michi',
    personality: 'dulce, juguetona y un poco tragona',
    alwaysOnTop: true,
    wander: true,
    comments: true,
    launchAtLogin: false,
  },
  history: [],
  isPackaged: false,
  solid: true,
  version: '1.0.0',
}))

app.whenReady().then(async () => {
  const pet = new BrowserWindow({
    width: 260,
    height: 280,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  pet.webContents.on('console-message', (_event, level, message) => {
    console.log(`[pet console:${level}]`, message)
  })

  await pet.loadFile(path.join(__dirname, '..', 'src', 'pet', 'index.html'), {
    query: { solid: '1' },
  })
  await wait(2200)

  const info = await pet.webContents.executeJavaScript(`(() => {
    const imgs = Array.from(document.querySelectorAll('#catFrames img'))
    const active = imgs.find((img) => img.classList.contains('active'))
    const wrap = document.querySelector('.cat-wrap').getBoundingClientRect()
    const frames = document.querySelector('.cat-frames').getBoundingClientRect()
    const cs = active ? getComputedStyle(active) : null
    const bubble = document.querySelector('.bubble').getBoundingClientRect()
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
      wrap: wrap.toJSON(),
      frames: frames.toJSON(),
      bubble: bubble.toJSON(),
      bubbleShown: document.querySelector('.bubble').classList.contains('show'),
      loaded: imgs.filter((img) => img.complete && img.naturalWidth > 0).length,
      total: imgs.length,
      active: active
        ? {
            src: active.getAttribute('src'),
            complete: active.complete,
            naturalWidth: active.naturalWidth,
            naturalHeight: active.naturalHeight,
            rect: active.getBoundingClientRect().toJSON(),
            objectFit: cs.objectFit,
            opacity: cs.opacity,
          }
        : null,
    }
  })()`)
  console.log('PET INFO', JSON.stringify(info, null, 2))

  const frameSeq = await pet.webContents.executeJavaScript(`(async () => {
    const seen = []
    for (let i = 0; i < 45; i++) {
      const img = document.querySelector('#catFrames img.active')
      const src = img ? img.getAttribute('src') : null
      const name = src ? src.split('/').slice(-2).join('/') : null
      if (seen[seen.length - 1] !== name) seen.push(name)
      await new Promise((r) => setTimeout(r, 100))
    }
    return seen
  })()`)
  console.log('FRAME SEQUENCE', JSON.stringify(frameSeq))

  const shapeInfo = await pet.webContents.executeJavaScript(
    `typeof window.__michiShape === 'function' ? window.__michiShape() : null`,
  )
  console.log('SHAPE INFO', JSON.stringify(shapeInfo, null, 2))

  const petShot = await pet.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '..', 'shot-cat.png'), petShot.toPNG())

  const chat = new BrowserWindow({
    width: 440,
    height: 640,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  chat.webContents.on('console-message', (_event, level, message) => {
    console.log(`[chat console:${level}]`, message)
  })
  await chat.loadFile(path.join(__dirname, '..', 'src', 'chat', 'index.html'), {
    query: { solid: '1' },
  })
  await wait(1200)
  const chatShot = await chat.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '..', 'shot-chat.png'), chatShot.toPNG())

  app.quit()
})
