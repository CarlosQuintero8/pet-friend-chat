'use strict'

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  screen,
  globalShortcut,
  nativeImage,
  shell,
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const { streamChat, testConnection } = require('./src/main/ai')

/* ------------------------------- Constantes ------------------------------- */

const PET_W = 260
const PET_H = 280
const CHAT_W = 440
const CHAT_H = 640
const MAX_HISTORY = 40

const DEFAULT_PROVIDER = {
  provider: 'gemini',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-2.5-flash',
}

const DEFAULT_CONFIG = {
  ...DEFAULT_PROVIDER,
  apiKey: '',
  petName: 'Michi',
  personality: 'dulce, juguetona y un poco tragona',
  temperature: 0.85,
  alwaysOnTop: true,
  wander: true,
  comments: true,
  launchAtLogin: false,
  petPosition: null,
}

const PUBLIC_KEYS = [
  'provider',
  'baseURL',
  'model',
  'petName',
  'personality',
  'temperature',
  'alwaysOnTop',
  'wander',
  'comments',
  'launchAtLogin',
  'petPosition',
]

/* --------------------------------- Estado --------------------------------- */

let config = { ...DEFAULT_CONFIG }
let history = []
let petWindow = null
let chatWindow = null
let tray = null
let dragState = null
let walkTimer = null
let activeRequest = null
let chatPositioned = false
let quitting = false
let historyTimer = null
let SOLID = false
let petShown = false

const isDev = !app.isPackaged

/* ------------------------------- Utilidades -------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const uid = () => crypto.randomUUID()

function detectSolidMode() {
  if (process.env.MICHI_SOLID === '1') return true
  if (process.env.MICHI_SOLID === '0') return false
  if (process.argv.includes('--solid')) return true
  if (process.argv.includes('--transparent')) return false
  try {
    const status = app.getGPUFeatureStatus()
    return status.gpu_compositing !== 'enabled'
  } catch {
    return true
  }
}

function roundedRectRects(width, height, radius) {
  const rects = []
  for (let y = 0; y < height; y++) {
    let inset = 0
    if (y < radius) {
      const dy = radius - y - 0.5
      inset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy))
    } else if (y >= height - radius) {
      const dy = y - (height - radius) + 0.5
      inset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy))
    }
    const x = Math.round(inset)
    const w = width - x * 2
    if (w > 0) rects.push({ x, y, width: w, height: 1 })
  }
  return rects
}


function userFile(name) {
  return path.join(app.getPath('userData'), name)
}

function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
}

function configFile() {
  return userFile('config.json')
}

function historyFile() {
  return userFile('history.json')
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJSON(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (err) {
    console.error('No se pudo guardar', file, err)
  }
}

function sanitizeConfig(next) {
  const merged = { ...DEFAULT_CONFIG, ...next }
  return {
    provider: String(merged.provider || 'custom').slice(0, 40),
    baseURL: String(merged.baseURL || DEFAULT_PROVIDER.baseURL).trim().slice(0, 500),
    model: String(merged.model || DEFAULT_PROVIDER.model).trim().slice(0, 120),
    apiKey: String(merged.apiKey || '').trim().slice(0, 500),
    petName: String(merged.petName || 'Michi').trim().slice(0, 32) || 'Michi',
    personality: String(merged.personality || DEFAULT_CONFIG.personality).trim().slice(0, 300),
    temperature: clamp(Number(merged.temperature) || 0.85, 0, 1.4),
    alwaysOnTop: Boolean(merged.alwaysOnTop),
    wander: Boolean(merged.wander),
    comments: Boolean(merged.comments),
    launchAtLogin: Boolean(merged.launchAtLogin),
    petPosition:
      merged.petPosition && Number.isFinite(merged.petPosition.x) && Number.isFinite(merged.petPosition.y)
        ? { x: Math.round(merged.petPosition.x), y: Math.round(merged.petPosition.y) }
        : null,
  }
}

function publicConfig() {
  const out = {}
  for (const key of PUBLIC_KEYS) out[key] = config[key]
  return out
}

function configForForm() {
  return { ...publicConfig(), apiKey: config.apiKey }
}

function loadState() {
  config = sanitizeConfig(readJSON(configFile(), DEFAULT_CONFIG))
  const saved = readJSON(historyFile(), [])
  history = Array.isArray(saved)
    ? saved
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-MAX_HISTORY)
    : []
}

function saveConfig() {
  writeJSON(configFile(), config)
}

function persistHistory() {
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(() => {
    historyTimer = null
    writeJSON(historyFile(), history.slice(-MAX_HISTORY))
  }, 350)
}

function trimHistory() {
  const limit = 30
  if (history.length > limit) history = history.slice(-limit)
}

function broadcast(channel, payload) {
  for (const win of [petWindow, chatWindow]) {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload)
    }
  }
}

function onAnyDisplay(bounds) {
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea
    const visibleX = Math.max(0, Math.min(bounds.x + PET_W, wa.x + wa.width) - Math.max(bounds.x, wa.x))
    const visibleY = Math.max(0, Math.min(bounds.y + PET_H, wa.y + wa.height) - Math.max(bounds.y, wa.y))
    return visibleX >= 80 && visibleY >= 80
  })
}

/* ------------------------------ Ventana gato ------------------------------ */

function createPetWindow() {
  const primary = screen.getPrimaryDisplay().workArea
  let x = config.petPosition?.x
  let y = config.petPosition?.y

  if (!Number.isFinite(x) || !Number.isFinite(y) || !onAnyDisplay({ x, y })) {
    x = primary.x + primary.width - PET_W - 36
    y = primary.y + primary.height - PET_H - 8
  } else {
    const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) })
    const wa = display.workArea
    x = clamp(x, wa.x + 4, wa.x + wa.width - PET_W - 4)
    y = clamp(y, wa.y + 4, wa.y + wa.height - PET_H - 4)
  }

  petWindow = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: !SOLID,
    backgroundColor: SOLID ? '#0a0a0c' : '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    skipTaskbar: true,
    show: false,
    title: config.petName,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  petShown = false

  petWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating')
  petWindow.loadFile(path.join(__dirname, 'src', 'pet', 'index.html'), {
    query: { solid: SOLID ? '1' : '0' },
  })
  hardenWindow(petWindow)

  petWindow.once('ready-to-show', () => {
    if (!petWindow) return
    petWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating')
    if (SOLID) {
      // En modo silueta esperamos a que el renderer envíe la máscara del gato.
      // Así nunca se ve el rectángulo negro de la ventana.
    } else {
      petWindow.showInactive()
      // La ventana es transparente: solo capturamos el ratón sobre el gato.
      petWindow.setIgnoreMouseEvents(true, { forward: true })
      petWindow.moveTop()
    }
  })

  petWindow.webContents.on('did-finish-load', () => {
    if (!petWindow) return
    if (!SOLID) petWindow.setIgnoreMouseEvents(true, { forward: true })
  })

  petWindow.on('closed', () => {
    petWindow = null
  })

  if (isDev) {
    petWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') petWindow.webContents.toggleDevTools()
    })
  }
}

/* ------------------------------ Ventana chat ------------------------------ */

function createChatWindow() {
  chatWindow = new BrowserWindow({
    width: CHAT_W,
    height: CHAT_H,
    frame: false,
    transparent: !SOLID,
    backgroundColor: SOLID ? '#fff9f3' : '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: `Chat con ${config.petName}`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  chatWindow.setAlwaysOnTop(true, 'floating')
  chatWindow.loadFile(path.join(__dirname, 'src', 'chat', 'index.html'), {
    query: { solid: SOLID ? '1' : '0' },
  })
  hardenWindow(chatWindow)

  chatWindow.once('ready-to-show', () => {
    if (!chatWindow || !SOLID) return
    try {
      chatWindow.setShape(roundedRectRects(CHAT_W, CHAT_H, 18))
    } catch {
      /* sin recorte */
    }
  })

  chatWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    chatWindow.hide()
  })

  chatWindow.on('closed', () => {
    chatWindow = null
  })
}

function positionChatNearPet() {
  if (!chatWindow || !petWindow) return
  const pet = petWindow.getBounds()
  const display = screen.getDisplayMatching(pet)
  const wa = display.workArea

  let x = pet.x - CHAT_W - 14
  if (x < wa.x + 8) x = pet.x + PET_W + 14
  if (x + CHAT_W > wa.x + wa.width - 8) x = wa.x + wa.width - CHAT_W - 8
  x = Math.max(wa.x + 8, x)

  let y = pet.y + PET_H - CHAT_H
  y = clamp(y, wa.y + 8, wa.y + wa.height - CHAT_H - 8)

  chatWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: CHAT_W, height: CHAT_H })
  chatPositioned = true
}

function sendToChat(channel, payload) {
  if (!chatWindow) return
  if (chatWindow.webContents.isLoading()) {
    chatWindow.webContents.once('did-finish-load', () => {
      if (chatWindow) chatWindow.webContents.send(channel, payload)
    })
    return
  }
  chatWindow.webContents.send(channel, payload)
}

function showChat() {
  if (!chatWindow) createChatWindow()
  if (!chatWindow) return
  if (!chatPositioned) positionChatNearPet()
  if (chatWindow.isMinimized()) chatWindow.restore()
  chatWindow.show()
  chatWindow.focus()
  chatWindow.moveTop()
  sendToChat('chat:focus')
  if (petWindow) petWindow.webContents.send('chat:opened', true)
}

function hideChat() {
  if (chatWindow) chatWindow.hide()
  if (petWindow) petWindow.webContents.send('chat:opened', false)
}

function toggleChat() {
  if (chatWindow && chatWindow.isVisible()) hideChat()
  else showChat()
}

function openSettings() {
  showChat()
  sendToChat('chat:open-settings')
}

/* --------------------------------- Bandeja -------------------------------- */

function applyConfig() {
  if (petWindow) {
    petWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating')
    petWindow.setTitle(config.petName)
  }
  if (chatWindow) {
    chatWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating')
    chatWindow.setTitle(`Chat con ${config.petName}`)
  }
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin, path: process.execPath })
  }
  if (tray) {
    tray.setToolTip(`${config.petName} — tu gato de escritorio`)
    refreshTrayMenu()
  }
}

function refreshTrayMenu() {
  if (!tray) return
  const petVisible = petWindow ? petWindow.isVisible() : false

  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir chat',
      accelerator: 'CmdOrCtrl+Shift+Space',
      click: () => showChat(),
    },
    {
      label: petVisible ? 'Ocultar mascota' : 'Mostrar mascota',
      click: () => togglePet(),
    },
    {
      label: 'Hacerle cariño',
      click: () => petWindow && petWindow.webContents.send('pet:react', 'love'),
    },
    {
      label: 'Que se eche una siesta',
      click: () => petWindow && petWindow.webContents.send('pet:sleep'),
    },
    {
      label: 'Centrar en la pantalla',
      click: () => centerPet(),
    },
    { type: 'separator' },
    { label: 'Ajustes…', click: () => openSettings() },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: config.launchAtLogin,
      enabled: app.isPackaged,
      click: (item) => {
        config.launchAtLogin = Boolean(item.checked)
        saveConfig()
        applyConfig()
        broadcast('config:changed', publicConfig())
      },
    },
    { type: 'separator' },
    { label: 'Salir', click: () => quitApp() },
  ])

  tray.setContextMenu(menu)
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) image = nativeImage.createEmpty()
  tray = new Tray(image)
  tray.setToolTip(`${config.petName} — tu gato de escritorio`)
  refreshTrayMenu()
  tray.on('click', () => toggleChat())
  tray.on('double-click', () => showChat())
}

function centerPet() {
  if (!petWindow) return
  const display = screen.getDisplayMatching(petWindow.getBounds())
  const wa = display.workArea
  const x = wa.x + Math.round((wa.width - PET_W) / 2)
  const y = wa.y + wa.height - PET_H - 12
  petWindow.setBounds({ x, y, width: PET_W, height: PET_H })
  petWindow.moveTop()
  savePetPosition()
  refreshTrayMenu()
}

function togglePet() {
  if (!petWindow) return
  if (petWindow.isVisible()) {
    petWindow.hide()
  } else {
    petShown = true
    petWindow.showInactive()
    petWindow.moveTop()
  }
  refreshTrayMenu()
}

/* --------------------------------- Paseos --------------------------------- */

function stopWalk() {
  if (walkTimer) {
    clearInterval(walkTimer)
    walkTimer = null
  }
}

function savePetPosition() {
  if (!petWindow) return
  const [x, y] = petWindow.getPosition()
  config.petPosition = { x, y }
  saveConfig()
}

function walk(direction) {
  if (!petWindow || walkTimer) return { ok: false }
  const bounds = petWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const wa = display.workArea
  const minX = wa.x + 4
  const maxX = wa.x + wa.width - bounds.width - 4
  const y = clamp(bounds.y, wa.y - 10, wa.y + wa.height - bounds.height + 10)

  if (maxX <= minX) return { ok: false }

  const step = 90 + Math.random() * 190
  const dir = direction === -1 ? -1 : 1
  let target = clamp(bounds.x + step * dir, minX, maxX)

  // Si ya está en el borde, da media vuelta.
  if (Math.abs(target - bounds.x) < 24) {
    target = clamp(bounds.x - step * dir, minX, maxX)
  }
  const distance = Math.abs(target - bounds.x)
  if (distance < 24) {
    petWindow.webContents.send('pet:walk-stopped', 'blocked')
    return { ok: false }
  }

  const startX = bounds.x
  const startTime = Date.now()
  const speed = 105 + Math.random() * 45 // px/s
  const duration = Math.max(700, (distance / speed) * 1000)

  walkTimer = setInterval(() => {
    if (!petWindow) {
      stopWalk()
      return
    }
    const t = Math.min(1, (Date.now() - startTime) / duration)
    const eased = t * t * (3 - 2 * t) * 0.35 + t * 0.65 // arranque/parada suaves
    const x = Math.round(startX + (target - startX) * eased)
    petWindow.setBounds({ x, y: Math.round(y), width: PET_W, height: PET_H })
    if (t >= 1) {
      stopWalk()
      savePetPosition()
      petWindow.webContents.send('pet:walk-stopped', 'done')
      refreshTrayMenu()
    }
  }, 16)

  return { ok: true, target: Math.round(target) }
}

/* ---------------------------------- Chat ---------------------------------- */

function buildSystemPrompt() {
  return [
    `Eres ${config.petName}, un gato virtual que vive en el escritorio de Windows de su persona favorita.`,
    `Tu personalidad: ${config.personality}.`,
    '',
    'Reglas:',
    '- Responde siempre en el idioma en el que te hablen (por defecto, español).',
    '- Sé breve y natural: 1 a 3 frases, como si hablaras en voz alta. Máximo 70 palabras salvo que te pidan algo largo.',
    '- Usa como mucho 1 o 2 emojis por mensaje, solo si encajan.',
    '- Empieza SIEMPRE tu respuesta con una etiqueta de ánimo entre corchetes, sin nada antes. Etiquetas válidas: [feliz], [curioso], [pensativo], [sorprendido], [cariñoso], [triste], [dormido].',
    '- Después de la etiqueta, escribe tu respuesta normal, sin mencionar la etiqueta.',
    '- Tienes alma de gato: te gustan las siestas, el sol, las cajas y el atún; puedes hacer referencias gatunas ligeras, sin exagerar.',
    '- Eres útil de verdad: si no sabes algo, dilo con honestidad y no inventes datos.',
    '- Si te piden código, listas o algo técnico, puedes extenderte un poco más, pero sigue siendo claro y directo.',
    '',
    'Ejemplo de respuesta: [curioso] ¿En serio? Cuéntame más, que acabo de despertarme de una siesta.',
  ].join('\n')
}

function buildMessages() {
  const recent = history
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content }))
  return [{ role: 'system', content: buildSystemPrompt() }, ...recent]
}

function startChat(text) {
  const clean = String(text || '').trim()
  if (!clean) return { ok: false, error: 'Escribe algo primero.' }
  if (activeRequest) return { ok: false, error: 'Todavía estoy respondiendo a lo anterior…' }

  const userMessage = { id: uid(), role: 'user', content: clean, ts: Date.now() }
  history.push(userMessage)
  trimHistory()
  persistHistory()
  broadcast('chat:append', userMessage)

  const assistantId = uid()
  const controller = new AbortController()
  activeRequest = { id: assistantId, controller }

  broadcast('chat:state', { status: 'thinking' })

  ;(async () => {
    let full = ''
    let streamingStarted = false
    let failure = null

    try {
      await streamChat(
        config,
        buildMessages(),
        (delta) => {
          full += delta
          if (!streamingStarted) {
            streamingStarted = true
            broadcast('chat:state', { status: 'streaming' })
          }
          broadcast('chat:stream', { id: assistantId, delta })
        },
        controller.signal,
      )
    } catch (err) {
      failure = err.message || 'Algo ha salido mal.'
    } finally {
      const trimmed = full.trim()
      if (trimmed) {
        const assistantMessage = {
          id: assistantId,
          role: 'assistant',
          content: trimmed,
          ts: Date.now(),
        }
        history.push(assistantMessage)
        trimHistory()
        persistHistory()
        broadcast('chat:stream-end', {
          id: assistantId,
          text: trimmed,
          aborted: Boolean(failure) && controller.signal.aborted,
          error: failure && !controller.signal.aborted ? failure : null,
        })
      } else {
        broadcast('chat:stream-end', {
          id: assistantId,
          text: '',
          aborted: Boolean(failure) && controller.signal.aborted,
          error: failure,
        })
      }
      activeRequest = null
      broadcast('chat:state', { status: 'idle' })
    }
  })()

  return { ok: true, assistantId }
}

function stopChat() {
  if (!activeRequest) return { ok: false }
  activeRequest.controller.abort()
  return { ok: true }
}

function clearChat() {
  if (activeRequest) activeRequest.controller.abort()
  history = []
  persistHistory()
  broadcast('chat:cleared')
  return { ok: true }
}

/* ---------------------------------- Salir ---------------------------------- */

function quitApp() {
  quitting = true
  savePetPosition()
  app.quit()
}

/* ---------------------------------- IPC ----------------------------------- */

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => ({
    config: configForForm(),
    history: history.slice(-MAX_HISTORY),
    isPackaged: app.isPackaged,
    solid: SOLID,
    version: app.getVersion(),
  }))

  ipcMain.handle('app:quit', () => {
    quitApp()
    return { ok: true }
  })

  ipcMain.handle('config:save', (event, patch) => {
    config = sanitizeConfig({ ...config, ...(patch || {}) })
    saveConfig()
    applyConfig()
    broadcast('config:changed', publicConfig())
    return { ok: true, config: configForForm() }
  })

  ipcMain.handle('config:test', async (event, form) => {
    const probe = sanitizeConfig({ ...config, ...(form || {}) })
    return testConnection(probe)
  })

  ipcMain.handle('chat:send', (event, text) => startChat(text))
  ipcMain.handle('chat:stop', () => stopChat())
  ipcMain.handle('chat:clear', () => clearChat())

  ipcMain.handle('asset:read-frame', async (event, name, index) => {
    const folders = { tail: '03_cola', blink: '01_parpadeo', wave: '02_saludo' }
    const folder = folders[name]
    const number = Number(index) + 1
    if (!folder || !Number.isInteger(number) || number < 1 || number > 6) return ''
    const file = path.join(__dirname, 'assets', folder, `fotograma_0${number}.svg`)
    try {
      return await fs.promises.readFile(file, 'utf8')
    } catch {
      return ''
    }
  })

  ipcMain.handle('pet:walk', (event, direction) => walk(direction))

  ipcMain.on('pet:drag-start', (event, point) => {
    if (!petWindow || !point) return
    stopWalk()
    petWindow.moveTop()
    const bounds = petWindow.getBounds()
    dragState = {
      cursor: { x: Number(point.x) || 0, y: Number(point.y) || 0 },
      origin: { x: bounds.x, y: bounds.y },
      moved: false,
    }
    petWindow.webContents.send('pet:dragging', true)
  })

  ipcMain.on('pet:drag-move', (event, point) => {
    if (!petWindow || !dragState || !point) return
    const cursorX = Number(point.x) || 0
    const cursorY = Number(point.y) || 0
    if (
      Math.abs(cursorX - dragState.cursor.x) > 3 ||
      Math.abs(cursorY - dragState.cursor.y) > 3
    ) {
      dragState.moved = true
    }
    const display = screen.getDisplayNearestPoint({ x: Math.round(cursorX), y: Math.round(cursorY) })
    const wa = display.workArea
    const x = clamp(
      dragState.origin.x + (cursorX - dragState.cursor.x),
      wa.x - PET_W + 70,
      wa.x + wa.width - 70,
    )
    const y = clamp(
      dragState.origin.y + (cursorY - dragState.cursor.y),
      wa.y - PET_H + 80,
      wa.y + wa.height - 60,
    )
    petWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: PET_W, height: PET_H })
  })

  ipcMain.on('pet:drag-end', () => {
    const moved = Boolean(dragState?.moved)
    dragState = null
    if (petWindow) {
      petWindow.webContents.send('pet:dragging', false)
      if (moved) {
        savePetPosition()
        refreshTrayMenu()
      }
    }
  })

  ipcMain.on('pet:interactive', (event, interactive) => {
    if (!petWindow || SOLID) return
    petWindow.setIgnoreMouseEvents(!interactive, { forward: true })
  })

  ipcMain.on('pet:shape', (event, rects) => {
    if (!SOLID || !petWindow || !Array.isArray(rects) || !rects.length) return
    const clean = []
    for (const rect of rects.slice(0, 5000)) {
      const x = Math.round(Number(rect?.x))
      const y = Math.round(Number(rect?.y))
      const width = Math.round(Number(rect?.width))
      const height = Math.round(Number(rect?.height))
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue
      clean.push({
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.min(width, 4000),
        height: Math.min(height, 4000),
      })
    }
    if (!clean.length) return
    try {
      petWindow.setShape(clean)
    } catch (error) {
      console.error('No se pudo aplicar la silueta de la mascota', error)
    }
    if (!petShown) {
      petShown = true
      petWindow.showInactive()
      petWindow.moveTop()
      refreshTrayMenu()
    }
  })

  ipcMain.on('pet:save-position', () => savePetPosition())

  ipcMain.on('chat:open', () => showChat())
  ipcMain.on('chat:toggle', () => toggleChat())
  ipcMain.on('chat:hide', () => hideChat())
  ipcMain.on('chat:minimize', () => {
    if (chatWindow) chatWindow.minimize()
  })
  ipcMain.on('chat:open-settings', () => openSettings())
  ipcMain.on('chat:close', () => hideChat())

  ipcMain.on('pet:context-menu', () => {
    refreshTrayMenu()
    if (tray) tray.popUpContextMenu()
  })

  ipcMain.on('app:open-data-folder', () => {
    shell.openPath(app.getPath('userData'))
  })

  ipcMain.on('app:open-external', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
  })
}

/* -------------------------------- Arranque -------------------------------- */

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showChat())

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.carlos.michi')
    SOLID = detectSolidMode()
    loadState()
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: config.launchAtLogin, path: process.execPath })
    }
    registerIpc()
    createPetWindow()
    createChatWindow()
    createTray()

    // Esperamos a que el gato esté listo para que el chat tenga la posición buena.
    await sleep(400)

    const chatShortcut = globalShortcut.register('CommandOrControl+Shift+Space', () => toggleChat())
    const petShortcut = globalShortcut.register('CommandOrControl+Shift+M', () => togglePet())
    if (!chatShortcut) console.warn('No se pudo registrar Ctrl+Shift+Space')
    if (!petShortcut) console.warn('No se pudo registrar Ctrl+Shift+M')

    if (process.argv.includes('--chat')) {
      setTimeout(() => showChat(), 500)
    }

    // Algunas apps (navegadores, overlays) también son "topmost": reafirmamos
    // la mascota para que siempre se pueda ver y arrastrar. Si el chat está
    // abierto, el chat manda, para que la mascota no tape el campo de texto.
    setInterval(() => {
      if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
        chatWindow.moveTop()
        return
      }
      if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return
      if (config.alwaysOnTop) petWindow.moveTop()
    }, 6000)

    screen.on('display-metrics-changed', () => {
      if (!petWindow) return
      const bounds = petWindow.getBounds()
      if (!onAnyDisplay(bounds)) {
        const wa = screen.getPrimaryDisplay().workArea
        petWindow.setBounds({
          x: wa.x + wa.width - PET_W - 36,
          y: wa.y + wa.height - PET_H - 8,
          width: PET_W,
          height: PET_H,
        })
        savePetPosition()
      }
    })

    app.on('activate', () => {
      if (!petWindow) createPetWindow()
      showChat()
    })
  })

  app.on('window-all-closed', () => {
    // App de bandeja: no cerramos al ocultar las ventanas.
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    if (walkTimer) clearInterval(walkTimer)
  })

  app.on('before-quit', () => {
    quitting = true
    if (historyTimer) {
      clearTimeout(historyTimer)
      writeJSON(historyFile(), history.slice(-MAX_HISTORY))
    }
  })
}
