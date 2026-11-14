'use strict'

/* Michi — comportamiento de la mascota y motor de fotogramas */

const stage = document.getElementById('stage')
const bubble = document.getElementById('bubble')
const bubbleText = document.getElementById('bubbleText')
const bubbleClose = document.getElementById('bubbleClose')
const catWrap = document.getElementById('catWrap')
const catFramesEl = document.getElementById('catFrames')

const SOLID = new URLSearchParams(location.search).get('solid') === '1'
if (SOLID) document.documentElement.classList.add('solid')

const host = window.api || {
  bootstrap: async () => ({
    config: { petName: 'Michi', comments: false },
    history: [],
  }),
  dragStart() {},
  dragMove() {},
  dragEnd() {},
  setInteractive() {},
  setShape() {},
  readFrame: async () => '',
  toggleChat() {},
  showContextMenu() {},
  on: () => () => {},
}

/* ------------------------------- Fotogramas -------------------------------- */

const FRAME_BASE = '../../assets/gato-pixel'
const FRAMES = {
  tail: Array.from({ length: 6 }, (_, i) => `${FRAME_BASE}/cola_0${i + 1}.svg`),
  blink: Array.from({ length: 6 }, (_, i) => `${FRAME_BASE}/parpadeo_0${i + 1}.svg`),
  wave: Array.from({ length: 6 }, (_, i) => `${FRAME_BASE}/saludo_0${i + 1}.svg`),
}

const TAIL_FRAME_MS = 230
const CLOSED_EYES_FRAME = 2 // 01_parpadeo/fotograma_03.svg

const frameEls = new Map()
let visibleFrame = null
let spriteTimer = null
let animating = false
let sleepingSprite = false
let tailIndex = 0

function buildFrames() {
  for (const [name, urls] of Object.entries(FRAMES)) {
    urls.forEach((url, index) => {
      const img = document.createElement('img')
      img.src = url
      img.alt = ''
      img.draggable = false
      img.decoding = 'async'
      catFramesEl.appendChild(img)
      frameEls.set(`${name}-${index}`, img)
    })
  }
  showFrame('tail', 0)
}

function showFrame(name, index) {
  const key = `${name}-${index}`
  const next = frameEls.get(key)
  if (!next || next === visibleFrame) return
  if (visibleFrame) visibleFrame.classList.remove('active')
  next.classList.add('active')
  visibleFrame = next
  currentFrameKey = key
  requestShape()
}

function stopSprite() {
  if (spriteTimer) {
    clearTimeout(spriteTimer)
    spriteTimer = null
  }
}

function startTail() {
  if (sleepingSprite) return
  if (!spriteTimer) spriteTimer = setTimeout(tailTick, TAIL_FRAME_MS)
}

function tailTick() {
  spriteTimer = null
  if (sleepingSprite) return
  tailIndex = (tailIndex + 1) % FRAMES.tail.length
  showFrame('tail', tailIndex)
  spriteTimer = setTimeout(tailTick, TAIL_FRAME_MS)
}

function resumeTail() {
  stopSprite()
  animating = false
  tailIndex = 0
  if (!sleepingSprite) {
    showFrame('tail', 0)
    startTail()
  }
}

function playOnce(name, fps = 10, done = null) {
  stopSprite()
  animating = true
  let index = 0
  const interval = Math.round(1000 / fps)

  const step = () => {
    showFrame(name, index)
    index += 1
    if (index < FRAMES[name].length) {
      spriteTimer = setTimeout(step, interval)
    } else {
      spriteTimer = setTimeout(() => {
        spriteTimer = null
        animating = false
        if (done) done()
        else resumeTail()
      }, interval)
    }
  }

  step()
}

function setSpriteSleeping(on) {
  sleepingSprite = Boolean(on)
  stopSprite()
  animating = false
  if (sleepingSprite) showFrame('blink', CLOSED_EYES_FRAME)
  else resumeTail()
}

/* --------------------------- Silueta (sin GPU) ---------------------------- */

const SHAPE_DILATION = 3
const shapeMasks = new Map()
const maskIds = new Map()
let currentFrameKey = 'tail-0'
let masksReady = false
let shapeTimer = null
let lastShapeKey = ''

function hashMask(mask) {
  let hash = 2166136261
  for (let i = 0; i < mask.length; i++) {
    hash ^= mask[i]
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function dilateMask(mask, W, H, D) {
  const tmp = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const row = y * W
    let run = 0
    for (let x = 0; x < W; x++) {
      run = mask[row + x] ? D : Math.max(0, run - 1)
      if (run) tmp[row + x] = 1
    }
    run = 0
    for (let x = W - 1; x >= 0; x--) {
      run = mask[row + x] ? D : Math.max(0, run - 1)
      if (run) tmp[row + x] = 1
    }
  }

  mask.fill(0)
  for (let x = 0; x < W; x++) {
    let run = 0
    for (let y = 0; y < H; y++) {
      run = tmp[y * W + x] ? D : Math.max(0, run - 1)
      if (run) mask[y * W + x] = 1
    }
    run = 0
    for (let y = H - 1; y >= 0; y--) {
      run = tmp[y * W + x] ? D : Math.max(0, run - 1)
      if (run) mask[y * W + x] = 1
    }
  }
}

function spansFromMask(mask, W, H) {
  const rects = []
  for (let y = 0; y < H; y++) {
    const row = y * W
    let start = -1
    for (let x = 0; x < W; x++) {
      if (mask[row + x]) {
        if (start < 0) start = x
      } else if (start >= 0) {
        rects.push({ x: start, y, width: x - start, height: 1 })
        start = -1
      }
    }
    if (start >= 0) rects.push({ x: start, y, width: W - start, height: 1 })
  }
  return rects
}

function loadSvgImage(svg) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo rasterizar el fotograma'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

function fallbackMask(W, H) {
  const rect = catWrap.getBoundingClientRect()
  const mask = new Uint8Array(W * H)
  const left = Math.max(0, Math.floor(rect.left) - SHAPE_DILATION)
  const right = Math.min(W - 1, Math.ceil(rect.right) + SHAPE_DILATION)
  const top = Math.max(0, Math.floor(rect.top) - SHAPE_DILATION)
  const bottom = Math.min(H - 1, Math.ceil(rect.bottom) + SHAPE_DILATION)
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) mask[y * W + x] = 1
  }
  return spansFromMask(mask, W, H)
}

async function buildMasks() {
  if (!SOLID) return
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const W = Math.max(1, window.innerWidth)
    const H = Math.max(1, window.innerHeight)
    const rect = catWrap.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    for (const name of Object.keys(FRAMES)) {
      for (let index = 0; index < FRAMES[name].length; index++) {
        const svg = await host.readFrame(name, index)
        if (!svg) throw new Error(`Falta el fotograma ${name}-${index}`)
        const image = await loadSvgImage(svg)
        ctx.clearRect(0, 0, W, H)
        ctx.drawImage(image, rect.left, rect.top, rect.width, rect.height)
        const data = ctx.getImageData(0, 0, W, H).data
        const mask = new Uint8Array(W * H)
        for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
          mask[i] = data[p] > 24 ? 1 : 0
        }
        dilateMask(mask, W, H, SHAPE_DILATION)
        const key = `${name}-${index}`
        shapeMasks.set(key, spansFromMask(mask, W, H))
        maskIds.set(key, hashMask(mask))
      }
    }

    masksReady = true
    requestShape(true)
  } catch (error) {
    console.error('No se pudo calcular la silueta del gato', error)
    const W = Math.max(1, window.innerWidth)
    const H = Math.max(1, window.innerHeight)
    shapeMasks.set('tail-0', fallbackMask(W, H))
    masksReady = true
    requestShape(true)
  }
}

function bubbleShapeRects() {
  if (!bubble.classList.contains('show')) return []
  const W = Math.max(1, window.innerWidth)
  const H = Math.max(1, window.innerHeight)
  const width = bubble.offsetWidth
  const height = bubble.offsetHeight
  const left = bubble.offsetLeft - width / 2
  const top = bubble.offsetTop
  const pad = 2
  const x0 = Math.max(0, Math.floor(left - pad))
  const x1 = Math.min(W - 1, Math.ceil(left + width + pad))
  const y0 = Math.max(0, Math.floor(top - pad))
  const y1 = Math.min(H - 1, Math.ceil(top + height + pad))
  const radius = 19
  const rects = []

  for (let y = y0; y <= y1; y++) {
    let inset = 0
    if (y < y0 + radius) {
      const dy = y0 + radius - y - 0.5
      inset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy))
    } else if (y > y1 - radius) {
      const dy = y - (y1 - radius) + 0.5
      inset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy))
    }
    const start = Math.max(0, Math.round(x0 + inset))
    const end = Math.min(W - 1, Math.round(x1 - inset))
    if (end >= start) rects.push({ x: start, y, width: end - start + 1, height: 1 })
  }

  // Colita de la burbuja
  const center = (x0 + x1) / 2
  for (let i = 0; i < 12; i++) {
    const y = y1 + i
    if (y >= H) break
    const half = Math.max(0, 7 - i * 0.58)
    const start = Math.max(0, Math.round(center - half))
    const end = Math.min(W - 1, Math.round(center + half))
    if (end >= start) rects.push({ x: start, y, width: end - start + 1, height: 1 })
  }

  return rects
}

function applyShape() {
  if (!SOLID || !masksReady) return
  const shown = bubble.classList.contains('show')
  const bubbleKey = shown ? `${bubble.offsetWidth}x${bubble.offsetHeight}` : '0'
  const maskId = maskIds.get(currentFrameKey) || 0
  const key = `${maskId}|${bubbleKey}`
  if (key === lastShapeKey) return
  lastShapeKey = key
  const base = shapeMasks.get(currentFrameKey) || shapeMasks.get('tail-0') || []
  const rects = base.concat(bubbleShapeRects())
  if (rects.length) host.setShape(rects)
}

function requestShape(force = false) {
  if (!SOLID || !masksReady) return
  if (force) {
    clearTimeout(shapeTimer)
    shapeTimer = null
    applyShape()
    return
  }
  if (shapeTimer) return
  shapeTimer = setTimeout(() => {
    shapeTimer = null
    applyShape()
  }, 70)
}

/* Diagnóstico de desarrollo: permite inspeccionar la silueta calculada. */
window.__michiShape = () => {
  if (!SOLID) return { solid: false }
  const spans = shapeMasks.get(currentFrameKey) || shapeMasks.get('tail-0') || []
  if (!spans.length) return { solid: true, masksReady, count: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const rect of spans) {
    minX = Math.min(minX, rect.x)
    maxX = Math.max(maxX, rect.x + rect.width)
    minY = Math.min(minY, rect.y)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return {
    solid: true,
    masksReady,
    frame: currentFrameKey,
    count: spans.length,
    minX,
    maxX,
    minY,
    maxY,
    bubbleRects: bubbleShapeRects().length,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
  }
}

/* -------------------------------- Estado ---------------------------------- */

let config = { petName: 'Michi', comments: true }
let state = 'idle'
let busy = false
let dragging = false
let sleeping = false
let chatOpen = false
let interactive = false
let pointer = null
let streamRaw = ''
let lastInteraction = Date.now()

let blinkTimer = null
let actionTimer = null
let commentTimer = null
let bubbleTimer = null
let transientTimer = null
let sleepTimer = null
let clickTimer = null
let napTimer = null
let lastMouse = { x: -1, y: -1 }

const COMMENTS = [
  'Qué buena siesta… ¿me rascas la oreja? 🐾',
  'He visto un pájaro por la ventana. Sospechoso. 👀',
  '¿Un descansito? Yo voto que sí. ☕',
  'Miau. Solo pasaba a recordarte que soy adorable.',
  'Oye… ¿tienes algo rico por ahí? 🍣',
  'Estoy vigilando tu escritorio. Todo bajo control.',
  'Se me ha ocurrido una idea, pero ya se me ha olvidado. 😴',
  '¿Trabajando mucho? Estira un poco, porfa.',
  'Te aviso: llevas un rato sin acariciarme. Solo digo. 💛',
]

const LOVE_LINES = [
  '¡Miau miau! Yo también te quiero 💛',
  '¿Rascaditas? Vale, me lo apunto. 🐾',
  'Eres mi humano favorito. No se lo digas a nadie.',
]

const EMOTIONS = {
  feliz: 'happy',
  alegre: 'happy',
  contenta: 'happy',
  contento: 'happy',
  curioso: 'curious',
  curiosa: 'curious',
  pensativo: 'think',
  pensativa: 'think',
  sorprendido: 'surprised',
  sorprendida: 'surprised',
  cariñoso: 'love',
  cariñosa: 'love',
  mimoso: 'love',
  mimosa: 'love',
  amor: 'love',
  triste: 'sad',
  melancolico: 'sad',
  melancólica: 'sad',
  dormido: 'sleep',
  somnoliento: 'sleep',
  somnolienta: 'sleep',
}

/* ------------------------------- Funciones -------------------------------- */

function setState(next) {
  if (transientTimer) {
    clearTimeout(transientTimer)
    transientTimer = null
  }
  if (state === next) return
  state = next
  stage.dataset.state = next

  if (next === 'sleep') {
    setSpriteSleeping(true)
  } else if (sleepingSprite) {
    setSpriteSleeping(false)
  }

  if ((next === 'happy' || next === 'love') && !sleepingSprite) {
    playOnce('wave', 9)
  }
}

function flashState(next, ms = 2200) {
  setState(next)
  transientTimer = setTimeout(() => {
    transientTimer = null
    if (sleeping) setState('sleep')
    else if (busy) setState('talk')
    else if (dragging) setState('drag')
    else setState('idle')
  }, ms)
}

function showBubble(text, { sticky = false, dots = false, duration = 0 } = {}) {
  clearTimeout(bubbleTimer)
  bubble.classList.toggle('dots-only', dots)
  if (!dots) bubbleText.textContent = text
  bubble.classList.add('show')
  requestShape()
  if (!sticky) {
    const ms = duration || Math.min(17000, 6200 + String(text).length * 42)
    bubbleTimer = setTimeout(hideBubble, ms)
  }
}

function hideBubble() {
  clearTimeout(bubbleTimer)
  bubbleTimer = null
  bubble.classList.remove('show', 'dots-only')
  requestShape()
  if (!pointer && !dragging) {
    setInteractive(hitTest(lastMouse.x, lastMouse.y))
  }
}

function truncate(text, max = 220) {
  const clean = String(text).trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : max)}…`
}

function cleanReply(raw) {
  const text = String(raw || '')
  const match = text.match(/^\s*\[([^\]\n]{1,24})\]/)
  if (match) {
    const emotion = EMOTIONS[match[1].trim().toLowerCase()] || null
    return { emotion, text: text.slice(match[0].length).trim() }
  }
  // Etiqueta de ánimo a medio escribir durante el streaming.
  if (/^\s*\[[^\]\n]{0,24}$/.test(text) && text.length < 30) return { emotion: null, text: '' }
  return { emotion: null, text: text.trim() }
}

function emotionState(emotion) {
  switch (emotion) {
    case 'happy':
    case 'love':
    case 'surprised':
    case 'sad':
      return emotion
    case 'think':
    case 'curious':
      return 'think'
    case 'sleep':
      return 'sleep'
    default:
      return 'happy'
  }
}

function wake(silent = true) {
  lastInteraction = Date.now()
  if (!sleeping) return
  sleeping = false
  setState('idle')
  if (!silent) showBubble('¡Miau! Ya estoy despierta ☀️', { duration: 3200 })
}

function enterSleep() {
  if (busy || dragging) return
  sleeping = true
  hideBubble()
  setState('sleep')
}

function maybeSleep() {
  if (sleeping || busy || dragging) return
  if (Date.now() - lastInteraction > 4 * 60 * 1000) enterSleep()
}

function reactLove() {
  wake()
  lastInteraction = Date.now()
  hideBubble()
  const line = LOVE_LINES[Math.floor(Math.random() * LOVE_LINES.length)]
  showBubble(line, { duration: 4200 })
  flashState('love', 3000)
}

/* --------------------------- Comportamiento ------------------------------- */

function scheduleBlink() {
  clearTimeout(blinkTimer)
  blinkTimer = setTimeout(() => {
    if (!sleeping && !sleepingSprite && state !== 'sleep' && !animating && !document.hidden) {
      playOnce('blink', 15)
      if (Math.random() < 0.3) setTimeout(headShake, 460)
    }
    scheduleBlink()
  }, 2600 + Math.random() * 4200)
}

function headShake() {
  stage.classList.add('twitch')
  setTimeout(() => stage.classList.remove('twitch'), 540)
}

function scheduleAction(delay) {
  clearTimeout(actionTimer)
  actionTimer = setTimeout(() => {
    runAction()
    scheduleAction()
  }, delay ?? 9000 + Math.random() * 14000)
}

function runAction() {
  if (busy || dragging || sleeping || chatOpen) return
  if (bubble.classList.contains('show')) return

  const roll = Math.random()
  if (roll < 0.55) {
    flashState('happy', 2000)
  } else if (roll < 0.75) {
    headShake()
    flashState('surprised', 1400)
  } else if (roll < 0.9) {
    flashState('think', 2200)
  } else {
    // Cabezadita rápida
    clearTimeout(napTimer)
    setState('sleep')
    napTimer = setTimeout(() => {
      if (!busy && !sleeping) setState('idle')
    }, 3600)
  }
}

function scheduleComment() {
  clearTimeout(commentTimer)
  commentTimer = setTimeout(() => {
    if (
      config.comments &&
      !busy &&
      !dragging &&
      !sleeping &&
      !chatOpen &&
      !bubble.classList.contains('show')
    ) {
      const line = COMMENTS[Math.floor(Math.random() * COMMENTS.length)]
      showBubble(line)
      flashState('happy', 1700)
    }
    scheduleComment()
  }, (5 + Math.random() * 9) * 60 * 1000)
}

/* ------------------------------ Ratón / drag ------------------------------ */

function hitTest(x, y) {
  const rect = catWrap.getBoundingClientRect()
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true
  if (bubble.classList.contains('show')) {
    const b = bubble.getBoundingClientRect()
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return true
  }
  return false
}

function setInteractive(next) {
  if (SOLID) return
  if (next === interactive) return
  interactive = next
  host.setInteractive(next)
}

window.addEventListener('mousemove', (event) => {
  lastMouse = { x: event.clientX, y: event.clientY }
  if (pointer || dragging) return
  setInteractive(hitTest(event.clientX, event.clientY))
})

window.addEventListener('mouseleave', () => {
  if (!pointer && !dragging) setInteractive(false)
})

document.addEventListener('mouseleave', () => {
  if (!pointer && !dragging) setInteractive(false)
})

stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  if (event.target.closest('[data-no-click]')) return
  const startedOn = event.target.closest('.cat-wrap, .bubble') ? 'pet' : 'card'
  if (startedOn === 'card' && !SOLID) return
  wake()
  lastInteraction = Date.now()
  pointer = { x: event.screenX, y: event.screenY, moved: false, id: event.pointerId, startedOn }
  try {
    stage.setPointerCapture(event.pointerId)
  } catch {
    /* sin captura, seguimos igual */
  }
  host.dragStart({ x: event.screenX, y: event.screenY })
})

window.addEventListener('pointermove', (event) => {
  if (!pointer) return
  if (!pointer.moved) {
    const dist = Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y)
    if (dist > 4) {
      pointer.moved = true
      dragging = true
      setState('drag')
    }
  }
  if (pointer.moved) host.dragMove({ x: event.screenX, y: event.screenY })
})

window.addEventListener('pointerup', (event) => {
  if (!pointer) return
  const { moved, id, startedOn } = pointer
  pointer = null
  try {
    if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id)
  } catch {
    /* nada */
  }
  host.dragEnd()

  if (moved) {
    dragging = false
    setState('idle')
    flashState('happy', 1300)
  } else if (startedOn === 'pet') {
    scheduleClick()
  }
})

window.addEventListener('pointercancel', () => {
  if (!pointer) return
  pointer = null
  dragging = false
  host.dragEnd()
  setState('idle')
})

function scheduleClick() {
  clearTimeout(clickTimer)
  clickTimer = setTimeout(() => {
    clickTimer = null
    wake()
    if (!sleepingSprite) playOnce('wave', 11)
    host.toggleChat()
  }, 220)
}

catWrap.addEventListener('dblclick', () => {
  clearTimeout(clickTimer)
  clickTimer = null
  reactLove()
})

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  wake()
  host.showContextMenu()
})

bubbleClose.addEventListener('click', (event) => {
  event.stopPropagation()
  hideBubble()
})

/* -------------------------------- Eventos IA ------------------------------ */

host.on('chat:state', (payload) => {
  const status = payload?.status
  if (status === 'thinking') {
    busy = true
    wake()
    streamRaw = ''
    setState('think')
    if (!chatOpen) showBubble('', { dots: true, sticky: true })
  } else if (status === 'idle') {
    busy = false
    if (state === 'think') setState(sleeping ? 'sleep' : 'idle')
  }
})

host.on('chat:stream', (payload) => {
  if (!payload?.delta) return
  busy = true
  streamRaw += payload.delta
  const parsed = cleanReply(streamRaw)
  if (parsed.emotion) lastInteraction = Date.now()
  if (!chatOpen) {
    if (parsed.text) showBubble(truncate(parsed.text), { sticky: true })
    else showBubble('', { dots: true, sticky: true })
  }
  if (parsed.text) setState('talk')
})

host.on('chat:stream-end', (payload) => {
  busy = false
  wake()
  const parsed = cleanReply(payload?.text || streamRaw)
  streamRaw = ''

  if (payload?.error) {
    if (!chatOpen) showBubble(`😿 ${payload.error}`, { duration: 8000 })
    else hideBubble()
    flashState('sad', 3000)
    return
  }

  if (chatOpen) {
    hideBubble()
  } else if (parsed.text) {
    showBubble(truncate(parsed.text))
  } else {
    hideBubble()
  }

  const next = emotionState(parsed.emotion)
  flashState(next, next === 'happy' ? 2400 : 3200)
})

host.on('chat:cleared', () => {
  hideBubble()
  if (!sleeping) setState('idle')
})

host.on('chat:opened', (open) => {
  chatOpen = Boolean(open)
  if (chatOpen) hideBubble()
})

host.on('chat:focus', () => {
  wake()
  lastInteraction = Date.now()
})

host.on('pet:react', (kind) => {
  if (kind === 'love') reactLove()
  else if (kind === 'sleep') enterSleep()
  else if (kind === 'happy') flashState('happy', 2000)
})

host.on('pet:sleep', () => enterSleep())

host.on('config:changed', (next) => {
  config = { ...config, ...next }
})

host.on('pet:dragging', (isDragging) => {
  if (isDragging && !dragging) {
    dragging = true
    setState('drag')
  }
})

/* -------------------------------- Arranque -------------------------------- */

buildFrames()
resumeTail()
if (SOLID) buildMasks()

;(async () => {
  try {
    const data = await host.bootstrap()
    if (data?.config) config = { ...config, ...data.config }
    if (!data?.history || data.history.length === 0) {
      setTimeout(() => {
        showBubble(
          `¡Miau! Soy ${config.petName}. Haz clic en mí para hablar o arrástrame para moverme 🐾`,
          { duration: 10000 },
        )
        flashState('happy', 2200)
      }, 1100)
    }
  } catch (error) {
    console.error('No se pudo cargar la configuración de la mascota', error)
  }

  scheduleBlink()
  scheduleAction(7000)
  scheduleComment()
  sleepTimer = setInterval(maybeSleep, 15000)
})()
