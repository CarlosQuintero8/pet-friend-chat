'use strict'

/* Michi — ventana de chat y ajustes */

/* --------------------------------- API ----------------------------------- */

const host = window.api || {
  bootstrap: async () => ({    config: {
      provider: 'gemini',
      apiKey: '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      petName: 'Michi',
      personality: 'dulce, juguetona y un poco tragona',
      alwaysOnTop: true,
      windowMode: 'transparent',
      comments: true,
      launchAtLogin: false,
      voiceEnabled: true,
      voiceName: '',
      voiceRate: 1,
      voicePitch: 1,
      voiceVolume: 1,
    },
    history: [],
    isPackaged: false,
    version: '1.0.0',
  }),
  saveConfig: async (patch) => ({ ok: true, config: { ...patch } }),
  checkUpdates: async () => ({ ok: false, message: 'Modo de demostración.' }),
  downloadUpdate: async () => ({ ok: false, message: 'Modo de demostración.' }),
  installUpdate: async () => ({ ok: false, message: 'Modo de demostración.' }),
  testConfig: async () => ({ ok: true, message: 'Modo de demostración: sin conexión real.' }),
  sendChat: async () => ({ ok: false, error: 'Abre la app con Electron para chatear.' }),
  stopChat: async () => ({ ok: false }),
  clearChat: async () => ({ ok: true }),
  stopSpeaking() {},
  previewVoice() {},
  transcribe: async () => ({ ok: false, message: 'Modo de demostración.' }),
  hideChat() {},
  minimizeChat() {},
  openDataFolder() {},
  quit() {},
  openExternal() {},
  on: () => () => {},
}

const SOLID = new URLSearchParams(location.search).get('solid') === '1'
if (SOLID) document.documentElement.classList.add('solid')

/* -------------------------------- Elementos ------------------------------- */

const messagesEl = document.getElementById('messages')
const welcomeEl = document.getElementById('welcome')
const welcomeTitle = document.getElementById('welcomeTitle')
const petNameEl = document.getElementById('petName')
const statusText = document.getElementById('statusText')
const statusDotEl = document.getElementById('statusDot')
const avatarEl = document.querySelector('.avatar')
const inputEl = document.getElementById('input')
const btnSend = document.getElementById('btnSend')
const btnStop = document.getElementById('btnStop')
const btnVoice = document.getElementById('btnVoice')
const btnMic = document.getElementById('btnMic')
const suggestionsEl = document.getElementById('suggestions')

const settingsEl = document.getElementById('settings')
const saveNote = document.getElementById('saveNote')
const testResult = document.getElementById('testResult')
const currentVersionEl = document.getElementById('currentVersion')
const btnCheckUpdate = document.getElementById('btnCheckUpdate')
const updateStatusEl = document.getElementById('updateStatus')
const updateProgressEl = document.getElementById('updateProgress')
const updateProgressBar = document.getElementById('updateProgressBar')
const btnUpdateAction = document.getElementById('btnUpdateAction')

const form = {
  provider: document.getElementById('fProvider'),
  apiKey: document.getElementById('fKey'),
  model: document.getElementById('fModel'),
  baseURL: document.getElementById('fBaseURL'),
  name: document.getElementById('fName'),
  personality: document.getElementById('fPersonality'),
  alwaysOnTop: document.getElementById('fAlwaysOnTop'),
  transparent: document.getElementById('fTransparent'),
  comments: document.getElementById('fComments'),
  launch: document.getElementById('fLaunch'),
  voice: document.getElementById('fVoice'),
  voiceName: document.getElementById('fVoiceName'),
  voiceRate: document.getElementById('fVoiceRate'),
  voicePitch: document.getElementById('fVoicePitch'),
  voiceVolume: document.getElementById('fVoiceVolume'),
}

/* -------------------------------- Estado --------------------------------- */

const state = {
  config: null,
  isPackaged: false,
  status: 'idle',
  nearBottom: true,
  clearing: false,
  version: '—',
  update: { status: 'idle', version: null, percent: 0, message: null },
}

const streamBuffers = new Map()

const MINI_CAT = '../../assets/avatar.png'

const PRESETS = {
  gemini: {
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    hint: 'Consigue una clave gratis en <b>aistudio.google.com/apikey</b>',
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    hint: 'Crea tu clave en <b>platform.openai.com/api-keys</b>',
  },
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    models: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
    hint: 'Una sola clave para muchos modelos: <b>openrouter.ai/keys</b>',
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    hint: 'Claves en <b>platform.deepseek.com</b>',
  },
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    hint: 'Claves en <b>console.groq.com/keys</b>',
  },
  ollama: {
    label: 'Ollama (local)',
    baseURL: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5', 'mistral'],
    hint: 'No necesita clave. Requiere Ollama en marcha (<b>ollama serve</b>).',
  },
  custom: {
    label: 'Otro',
    baseURL: '',
    models: [],
    hint: 'Cualquier API compatible con OpenAI (<code>/chat/completions</code>).',
  },
}

/* ------------------------------ Utilidades -------------------------------- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char])
}

function stripEmotionTag(text) {
  const clean = String(text)
  const match = clean.match(/^\s*\[[^\]\n]{1,24}\]\s*/)
  if (match) return clean.slice(match[0].length)
  if (/^\s*\[[^\]\n]{0,24}$/.test(clean) && clean.length < 26) return ''
  return clean
}

function renderAssistantBubble(bubble, text, { caret = false } = {}) {
  bubble.innerHTML = `${renderMarkdown(stripEmotionTag(text))}${caret ? '<span class="caret"></span>' : ''}`
}

function renderMarkdown(raw) {
  let text = escapeHtml(raw)
  const blocks = []

  text = text.replace(/```[\w+-]*\n?([\s\S]*?)```/g, (_match, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`)
    return `\n\u0000${blocks.length - 1}\u0000\n`
  })

  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  text = text.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" data-external="1">$1</a>',
  )

  const lines = text.split('\n').map((line) => {
    if (/^\s*[-*•]\s+/.test(line)) return `<li>${line.replace(/^\s*[-*•]\s+/, '')}</li>`
    if (/^\s*\d+[.)]\s+/.test(line)) return `<li>${line.replace(/^\s*\d+[.)]\s+/, '')}</li>`
    return line
  })
  text = lines.join('\n')
  text = text.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, (match) => `<ul>${match.replace(/\n/g, '')}</ul>`)
  text = text.replace(/\n/g, '<br>')
  text = text.replace(/\u0000(\d+)\u0000/g, (_match, index) => blocks[Number(index)])
  return text
}

function miniAvatar() {
  const el = document.createElement('div')
  el.className = 'msg-avatar'
  const img = document.createElement('img')
  img.src = MINI_CAT
  img.alt = ''
  img.draggable = false
  el.appendChild(img)
  return el
}

function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90
}

function scrollToBottom(force = false) {
  if (!force && !state.nearBottom) return
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight
  })
}

function updateWelcome() {
  const hasMessages = Boolean(messagesEl.querySelector('.msg'))
  welcomeEl.hidden = hasMessages
}

function createMessageElement(message) {
  const row = document.createElement('div')
  const isUser = message.role === 'user'
  row.className = `msg ${isUser ? 'user' : 'assistant'}`
  if (message.id) row.dataset.id = message.id
  if (!isUser) row.appendChild(miniAvatar())
  const bubble = document.createElement('div')
  bubble.className = 'bubble-md'
  if (isUser) bubble.innerHTML = renderMarkdown(message.content || '')
  else renderAssistantBubble(bubble, message.content || '')
  row.appendChild(bubble)
  return row
}

function appendMessage(message, { scroll = true } = {}) {
  if (message.id && messagesEl.querySelector(`.msg[data-id="${message.id}"]`)) return
  const row = createMessageElement(message)
  messagesEl.appendChild(row)
  updateWelcome()
  if (scroll) scrollToBottom(true)
}

function appendNotice(text, kind = 'system') {
  const row = document.createElement('div')
  row.className = `msg ${kind}`
  if (kind === 'error') row.appendChild(miniAvatar())
  const bubble = document.createElement('div')
  bubble.className = 'bubble-md'
  bubble.textContent = text
  row.appendChild(bubble)
  messagesEl.appendChild(row)
  scrollToBottom(true)
}

function setStatus(status) {
  state.status = status
  const busy = status === 'thinking' || status === 'streaming'
  avatarEl.classList.toggle('busy', busy)
  statusText.textContent =
    status === 'thinking' ? 'Pensando…' : status === 'streaming' ? 'Escribiendo…' : 'En línea'
  btnSend.disabled = busy
  btnStop.hidden = !busy
  btnSend.hidden = busy
  renderMic()
}

/* ------------------------------ Indicadores ------------------------------- */

function showTyping() {
  removeTyping()
  const row = document.createElement('div')
  row.className = 'msg assistant typing-row'
  row.appendChild(miniAvatar())
  const bubble = document.createElement('div')
  bubble.className = 'bubble-md'
  bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>'
  row.appendChild(bubble)
  messagesEl.appendChild(row)
  state.nearBottom = true
  scrollToBottom(true)
}

function removeTyping() {
  const row = messagesEl.querySelector('.typing-row')
  if (row) row.remove()
}

/* -------------------------------- Enviar --------------------------------- */

function autosize() {
  inputEl.style.height = 'auto'
  inputEl.style.height = `${Math.min(104, inputEl.scrollHeight)}px`
}

async function sendMessage(text) {
  if (MIC.active) return
  const content = String(text ?? inputEl.value).trim()
  if (!content || state.status !== 'idle') return

  inputEl.value = ''
  autosize()
  state.nearBottom = true
  setStatus('thinking')
  showTyping()

  const result = await host.sendChat(content)
  if (!result || !result.ok) {
    removeTyping()
    setStatus('idle')
    appendNotice(result?.error || 'No se pudo enviar el mensaje.', 'error')
  }
}

/* ------------------------------- Streaming -------------------------------- */

function getStreamElement(id) {
  let row = messagesEl.querySelector(`.msg[data-id="${id}"]`)
  if (!row) {
    row = document.createElement('div')
    row.className = 'msg assistant'
    row.dataset.id = id
    row.appendChild(miniAvatar())
    const bubble = document.createElement('div')
    bubble.className = 'bubble-md'
    row.appendChild(bubble)
    messagesEl.appendChild(row)
    updateWelcome()
  }
  return row.querySelector('.bubble-md')
}

function handleStream(id, delta) {
  removeTyping()
  const raw = (streamBuffers.get(id) || '') + delta
  streamBuffers.set(id, raw)
  const bubble = getStreamElement(id)
  state.nearBottom = isNearBottom()
  renderAssistantBubble(bubble, raw, { caret: true })
  if (state.status !== 'streaming') setStatus('streaming')
  scrollToBottom()
}

function handleStreamEnd(payload) {
  const { id, text, error, aborted } = payload || {}
  removeTyping()

  const bubble = getStreamElement(id)
  const raw = String(text || streamBuffers.get(id) || '').trim()
  streamBuffers.delete(id)

  if (raw) {
    renderAssistantBubble(bubble, raw)
  } else {
    const row = bubble.closest('.msg')
    if (row) row.remove()
  }

  if (error && !aborted) {
    appendNotice(error, 'error')
    state.nearBottom = true
    scrollToBottom(true)
  } else if (aborted && raw) {
    appendNotice('Respuesta interrumpida.', 'system')
  } else if (!raw && !error && !aborted) {
    appendNotice('No he recibido respuesta. Inténtalo otra vez.', 'system')
  }

  setStatus('idle')
  updateWelcome()
  scrollToBottom()
}

/* -------------------------------- Ajustes --------------------------------- */

let saveNoteTimer = null
let previewTimer = null

function showSaveNote(text, isError = false) {
  saveNote.textContent = text
  saveNote.classList.toggle('error', isError)
  saveNote.classList.add('show')
  clearTimeout(saveNoteTimer)
  saveNoteTimer = setTimeout(() => saveNote.classList.remove('show'), 4000)
}

function fillProviderOptions() {
  for (const [key, preset] of Object.entries(PRESETS)) {
    const option = form.provider.querySelector(`option[value="${key}"]`)
    if (option) option.textContent = preset.label
  }
}

function applyProviderPreset(provider) {
  const preset = PRESETS[provider] || PRESETS.custom
  form.baseURL.value = preset.baseURL
  document.getElementById('modelList').innerHTML = preset.models
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join('')
  if (preset.models.length) form.model.value = preset.models[0]
  document.getElementById('keyHint').innerHTML = preset.hint
  form.apiKey.disabled = provider === 'ollama'
  form.apiKey.placeholder = provider === 'ollama' ? 'No hace falta clave' : 'Pega aquí tu clave…'
}

function fillSettingsForm() {
  const cfg = state.config || {}
  form.provider.value = PRESETS[cfg.provider] ? cfg.provider : 'custom'
  form.apiKey.value = cfg.apiKey || ''
  form.model.value = cfg.model || ''
  form.baseURL.value = cfg.baseURL || ''
  form.name.value = cfg.petName || 'Michi'
  form.personality.value = cfg.personality || ''
  form.alwaysOnTop.checked = cfg.alwaysOnTop !== false
  form.transparent.checked = cfg.windowMode !== 'silhouette'
  form.comments.checked = cfg.comments !== false
  form.launch.checked = Boolean(cfg.launchAtLogin)
  form.launch.disabled = !state.isPackaged
  form.voice.checked = cfg.voiceEnabled !== false
  populateVoices(cfg.voiceName || '')
  form.voiceRate.value = String(cfg.voiceRate ?? 1)
  form.voicePitch.value = String(cfg.voicePitch ?? 1)
  form.voiceVolume.value = String(cfg.voiceVolume ?? 1)
  updateVoiceLabels()
  const voiceTest = document.getElementById('voiceTestResult')
  voiceTest.textContent = ''
  voiceTest.className = 'test-result'
  document.getElementById('launchHint').textContent = state.isPackaged
    ? 'Michi se abre sola al encender el equipo.'
    : 'Disponible cuando instales la app con el instalador.'

  const preset = PRESETS[form.provider.value] || PRESETS.custom
  document.getElementById('modelList').innerHTML = preset.models
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join('')
  document.getElementById('keyHint').innerHTML = preset.hint
  form.apiKey.disabled = form.provider.value === 'ollama'
  form.apiKey.placeholder =
    form.provider.value === 'ollama' ? 'No hace falta clave' : 'Pega aquí tu clave…'
  testResult.textContent = ''
  testResult.className = 'test-result'
}

function readSettingsForm() {
  return {
    provider: form.provider.value,
    apiKey: form.apiKey.value.trim(),
    model: form.model.value.trim(),
    baseURL: form.baseURL.value.trim(),
    petName: form.name.value.trim() || 'Michi',
    personality: form.personality.value.trim(),
    alwaysOnTop: form.alwaysOnTop.checked,
    windowMode: form.transparent.checked ? 'transparent' : 'silhouette',
    comments: form.comments.checked,
    launchAtLogin: form.launch.checked,
    voiceEnabled: form.voice.checked,
    voiceName: form.voiceName.value,
    voiceRate: Number(form.voiceRate.value),
    voicePitch: Number(form.voicePitch.value),
    voiceVolume: Number(form.voiceVolume.value),
  }
}

function openSettings() {
  fillSettingsForm()
  renderUpdate()
  settingsEl.hidden = false
}

function closeSettings() {
  settingsEl.hidden = true
  testResult.textContent = ''
}

function applyConfigToUi() {
  const name = state.config?.petName || 'Michi'
  petNameEl.textContent = name
  welcomeTitle.textContent = `¡Miau! Soy ${name}`
  document.title = `Chat con ${name}`
  statusDotEl.title = `${name} está aquí`
  renderVoiceButton()
}

/* --------------------------------- Voz ------------------------------------ */

const SPEECH = window.speechSynthesis || null

function formatRate(value) {
  const number = Number(value)
  return `${(Number.isFinite(number) ? number : 1).toFixed(1)}×`
}

function formatPercent(value) {
  const number = Number(value)
  return `${Math.round((Number.isFinite(number) ? number : 1) * 100)} %`
}

function renderVoiceButton() {
  const on = state.config?.voiceEnabled !== false
  btnVoice.classList.toggle('off', !on)
  btnVoice.title = on ? 'Silenciar voz' : 'Activar voz'
}

function voiceOption(voice) {
  return `<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)} (${escapeHtml(
    voice.lang || '',
  )})</option>`
}

function populateVoices(selected = '') {
  let voices = []
  try {
    voices = SPEECH ? SPEECH.getVoices() || [] : []
  } catch {
    voices = []
  }

  const sortVoices = (a, b) =>
    String(a.lang || '').localeCompare(String(b.lang || '')) || a.name.localeCompare(b.name)
  const spanish = voices.filter((voice) => /^es([-_]|$)/i.test(voice.lang || '')).sort(sortVoices)
  const others = voices.filter((voice) => !/^es([-_]|$)/i.test(voice.lang || '')).sort(sortVoices)

  const groups = []
  if (spanish.length) {
    groups.push(`<optgroup label="Español">${spanish.map(voiceOption).join('')}</optgroup>`)
  }
  if (others.length) {
    groups.push(`<optgroup label="Otras voces">${others.map(voiceOption).join('')}</optgroup>`)
  }

  form.voiceName.innerHTML = '<option value="">Automática (español)</option>' + groups.join('')
  form.voiceName.value = selected || ''
  if (form.voiceName.value !== (selected || '')) form.voiceName.value = ''
}

function updateVoiceLabels() {
  document.getElementById('voiceRateValue').textContent = formatRate(form.voiceRate.value)
  document.getElementById('voicePitchValue').textContent = Number(form.voicePitch.value).toFixed(1)
  document.getElementById('voiceVolumeValue').textContent = formatPercent(form.voiceVolume.value)
}

function readVoiceSettings() {
  return {
    enabled: true,
    name: form.voiceName.value,
    rate: Number(form.voiceRate.value),
    pitch: Number(form.voicePitch.value),
    volume: Number(form.voiceVolume.value),
  }
}

/* ------------------------------- Dictado ---------------------------------- */

const MIC = {
  active: false,
  starting: false,
  busy: false,
  stream: null,
  ctx: null,
  source: null,
  processor: null,
  chunks: [],
  frames: 0,
  sampleRate: 16000,
  stopTimer: null,
}

function micSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(window.AudioContext || window.webkitAudioContext)
}

function renderMic() {
  btnMic.classList.toggle('recording', MIC.active)
  btnMic.classList.toggle('busy', MIC.busy)
  btnMic.disabled = MIC.busy || MIC.starting || state.status !== 'idle'
  btnMic.title = MIC.active
    ? 'Detener y enviar'
    : MIC.busy
      ? 'Transcribiendo…'
      : 'Hablar con Michi (dictado)'
}

function toBase64(bytes) {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

function encodeWav(chunks, sampleRate) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + total * 2)
  const view = new DataView(buffer)

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + total * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, total * 2, true)

  let offset = 44
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return toBase64(new Uint8Array(buffer))
}

async function transcribeAudio(audioBase64) {
  MIC.busy = true
  renderMic()
  statusText.textContent = 'Transcribiendo…'
  try {
    const result = await host.transcribe(audioBase64, 'audio/wav')
    if (!result?.ok) {
      appendNotice(result?.message || 'No se pudo transcribir el audio.', 'error')
      return
    }
    const text = String(result.text || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) {
      appendNotice('No he entendido nada. Prueba otra vez, un poco más cerca del micrófono.', 'system')
      return
    }
    inputEl.value = text
    autosize()
    sendMessage(text)
  } catch (error) {
    appendNotice(`No se pudo transcribir el audio: ${error.message}`, 'error')
  } finally {
    MIC.busy = false
    if (state.status === 'idle') statusText.textContent = 'En línea'
    renderMic()
  }
}

async function startDictation() {
  if (MIC.active || MIC.starting || MIC.busy || state.status !== 'idle') return
  if (!micSupported()) {
    appendNotice('Este equipo no permite usar el micrófono desde la app.', 'system')
    return
  }

  host.stopSpeaking()

  let stream
  MIC.starting = true
  renderMic()
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
  } catch (error) {
    MIC.starting = false
    renderMic()
    const name = error?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      appendNotice(
        'No tengo permiso para usar el micrófono. Actívalo en Windows → Configuración → Privacidad → Micrófono.',
        'error',
      )
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      appendNotice('No encuentro ningún micrófono conectado.', 'error')
    } else {
      appendNotice(`No pude abrir el micrófono: ${error?.message || error}`, 'error')
    }
    return
  }
  MIC.starting = false

  const AudioCtx = window.AudioContext || window.webkitAudioContext
  let ctx
  try {
    ctx = new AudioCtx({ sampleRate: 16000 })
  } catch {
    ctx = new AudioCtx()
  }
  try {
    if (ctx.state === 'suspended') await ctx.resume()
  } catch {
    /* seguimos: el contexto puede arrancar al primer sonido */
  }

  if (typeof ctx.createScriptProcessor !== 'function') {
    stream.getTracks().forEach((track) => track.stop())
    ctx.close().catch(() => {})
    appendNotice('No se pudo preparar la grabación en este equipo.', 'error')
    return
  }

  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)

  MIC.active = true
  MIC.stream = stream
  MIC.ctx = ctx
  MIC.source = source
  MIC.processor = processor
  MIC.chunks = []
  MIC.frames = 0
  MIC.sampleRate = ctx.sampleRate || 16000

  processor.onaudioprocess = (event) => {
    if (!MIC.active) return
    const data = event.inputBuffer.getChannelData(0)
    MIC.chunks.push(new Float32Array(data))
    MIC.frames += data.length
    if (MIC.frames >= MIC.sampleRate * 30) stopDictation(false)
  }

  source.connect(processor)
  processor.connect(ctx.destination)

  statusText.textContent = 'Escuchando…'
  renderMic()
  clearTimeout(MIC.stopTimer)
  MIC.stopTimer = setTimeout(() => stopDictation(false), 30000)
}

function stopDictation(cancelled) {
  if (!MIC.active) return
  MIC.active = false
  clearTimeout(MIC.stopTimer)
  MIC.stopTimer = null
  if (state.status === 'idle') statusText.textContent = 'En línea'

  try {
    MIC.source?.disconnect()
  } catch {
    /* nada */
  }
  try {
    MIC.processor?.disconnect()
  } catch {
    /* nada */
  }
  try {
    MIC.stream?.getTracks().forEach((track) => track.stop())
  } catch {
    /* nada */
  }
  try {
    MIC.ctx?.close()
  } catch {
    /* nada */
  }

  const chunks = MIC.chunks
  const frames = MIC.frames
  const sampleRate = MIC.sampleRate
  MIC.chunks = []
  MIC.frames = 0
  MIC.stream = null
  MIC.ctx = null
  MIC.source = null
  MIC.processor = null

  renderMic()

  if (cancelled || !frames) return
  if (frames < sampleRate * 0.5) {
    appendNotice('Ha sido muy corto. Habla un par de segundos y vuelve a intentarlo.', 'system')
    return
  }

  const wav = encodeWav(chunks, sampleRate)
  transcribeAudio(wav)
}

/* ------------------------------ Actualizaciones --------------------------- */

function renderUpdate() {
  const update = state.update || {}
  const status = update.status || 'idle'
  const isBusy = status === 'checking' || status === 'downloading'
  const supported = state.isPackaged

  currentVersionEl.textContent = `v${state.version}`
  btnCheckUpdate.disabled = !supported || isBusy
  btnCheckUpdate.textContent = status === 'checking' ? 'Buscando…' : 'Buscar actualizaciones'
  updateStatusEl.classList.remove('ok', 'error')
  updateProgressEl.hidden = status !== 'downloading'
  updateProgressBar.style.width = `${Math.max(0, Math.min(100, Number(update.percent) || 0))}%`
  btnUpdateAction.hidden = true
  btnUpdateAction.disabled = false

  if (!supported) {
    updateStatusEl.textContent = 'Las actualizaciones solo están disponibles en la versión instalada.'
    return
  }

  switch (status) {
    case 'checking':
      updateStatusEl.textContent = 'Buscando actualizaciones…'
      break
    case 'available':
      updateStatusEl.textContent = `Hay una versión nueva disponible: v${update.version}.`
      btnUpdateAction.hidden = false
      btnUpdateAction.textContent = `Descargar v${update.version}`
      break
    case 'not-available':
      updateStatusEl.textContent = `Estás al día (v${state.version}).`
      updateStatusEl.classList.add('ok')
      break
    case 'downloading':
      updateStatusEl.textContent = `Descargando${update.version ? ` v${update.version}` : ''}… ${update.percent || 0}%`
      break
    case 'downloaded':
      updateStatusEl.textContent = `Actualización v${update.version || ''} lista. Reinicia para instalarla.`
      updateStatusEl.classList.add('ok')
      btnUpdateAction.hidden = false
      btnUpdateAction.textContent = 'Reiniciar e instalar'
      break
    case 'error':
      updateStatusEl.textContent = update.message || 'No se pudo comprobar la actualización.'
      updateStatusEl.classList.add('error')
      btnUpdateAction.hidden = false
      btnUpdateAction.textContent = 'Reintentar'
      break
    case 'unavailable':
      updateStatusEl.textContent = update.message || 'Actualizaciones no disponibles.'
      break
    default:
      updateStatusEl.textContent = 'Comprueba si hay una versión nueva.'
  }
}

function setUpdateState(patch) {
  state.update = { ...state.update, ...patch }
  renderUpdate()
}

async function checkForUpdates() {
  if (!state.isPackaged) return
  const status = state.update?.status
  if (status === 'checking' || status === 'downloading') return

  setUpdateState({ status: 'checking', message: null, percent: 0 })
  const result = await host.checkUpdates()
  if (!result?.ok) {
    setUpdateState({
      status: 'error',
      message: result?.message || 'No se pudo comprobar la actualización.',
    })
  }
}

btnCheckUpdate.addEventListener('click', () => {
  checkForUpdates()
})

btnUpdateAction.addEventListener('click', async () => {
  const status = state.update?.status
  if (status === 'available') {
    btnUpdateAction.disabled = true
    setUpdateState({ status: 'downloading', percent: 0, message: null })
    const result = await host.downloadUpdate()
    if (!result?.ok) {
      setUpdateState({
        status: 'error',
        message: result?.message || 'No se pudo descargar la actualización.',
      })
    }
  } else if (status === 'downloaded') {
    btnUpdateAction.disabled = true
    await host.installUpdate()
  } else if (status === 'error') {
    checkForUpdates()
  }
})

/* -------------------------------- Eventos --------------------------------- */

/* Mensajes del proceso principal */
host.on('chat:append', (message) => {
  if (!message) return
  const stick = message.role === 'user' || isNearBottom()
  appendMessage(message, { scroll: stick })
  if (stick) state.nearBottom = true
})

host.on('chat:stream', (payload) => {
  if (!payload?.id || !payload.delta) return
  handleStream(payload.id, payload.delta)
})

host.on('chat:stream-end', (payload) => {
  handleStreamEnd(payload)
})

host.on('chat:state', (payload) => {
  const status = payload?.status || 'idle'
  if (status === 'thinking') {
    if (!messagesEl.querySelector('.typing-row') && !messagesEl.querySelector('.caret')) showTyping()
    setStatus('thinking')
  } else if (status === 'streaming') {
    removeTyping()
    setStatus('streaming')
  } else {
    removeTyping()
    setStatus('idle')
  }
})

host.on('chat:cleared', () => {
  messagesEl.querySelectorAll('.msg').forEach((el) => el.remove())
  streamBuffers.clear()
  removeTyping()
  updateWelcome()
  setStatus('idle')
  appendNotice('Conversación nueva. ¿De qué hablamos? 🐾', 'system')
})

host.on('chat:focus', () => {
  setTimeout(() => inputEl.focus(), 60)
})

host.on('chat:open-settings', () => {
  openSettings()
})

host.on('update:state', (payload) => {
  if (!payload) return
  state.update = { ...state.update, ...payload }
  renderUpdate()
})

host.on('speech:state', (payload) => {
  btnVoice.classList.toggle('speaking', Boolean(payload?.speaking))
})

host.on('config:changed', (cfg) => {
  if (!cfg) return
  const wasOpen = !settingsEl.hidden
  state.config = { ...state.config, ...cfg }
  applyConfigToUi()
  if (!wasOpen) fillSettingsForm()
})

/* ------------------------------ Interacción ------------------------------- */

inputEl.addEventListener('input', autosize)

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
})

btnSend.addEventListener('click', () => sendMessage())
btnStop.addEventListener('click', () => host.stopChat())

btnMic.addEventListener('click', () => {
  if (MIC.active) stopDictation(false)
  else startDictation()
})

suggestionsEl.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-suggest]')
  if (!chip) return
  sendMessage(chip.dataset.suggest)
})

messagesEl.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-external]')
  if (!link) return
  event.preventDefault()
  host.openExternal(link.getAttribute('href'))
})

messagesEl.addEventListener('scroll', () => {
  state.nearBottom = isNearBottom()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (MIC.active) {
      stopDictation(true)
      return
    }
    if (!settingsEl.hidden) closeSettings()
    else host.hideChat()
  }
})

/* Botones de la cabecera */
document.getElementById('btnClose').addEventListener('click', () => {
  if (MIC.active) stopDictation(true)
  host.hideChat()
})
document.getElementById('btnMin').addEventListener('click', () => {
  if (MIC.active) stopDictation(true)
  host.minimizeChat()
})
document.getElementById('btnSettings').addEventListener('click', openSettings)

document.getElementById('btnNew').addEventListener('click', () => {
  if (!messagesEl.querySelector('.msg')) {
    appendNotice('Aún no hay conversación. ¡Escríbeme algo! 🐾', 'system')
    return
  }
  if (window.confirm('¿Empezar una conversación nueva? Se borrará la actual.')) {
    host.clearChat()
  }
})

/* ------------------------------- Ajustes UI ------------------------------- */

form.provider.addEventListener('change', () => {
  applyProviderPreset(form.provider.value)
})

btnVoice.addEventListener('click', async () => {
  const on = state.config?.voiceEnabled !== false
  const result = await host.saveConfig({ voiceEnabled: !on })
  if (!result?.ok) return
  state.config = { ...state.config, ...(result.config || {}) }
  applyConfigToUi()
  if (on) host.stopSpeaking()
  if (!settingsEl.hidden) form.voice.checked = !on
})

form.voiceRate.addEventListener('input', updateVoiceLabels)
form.voicePitch.addEventListener('input', updateVoiceLabels)
form.voiceVolume.addEventListener('input', updateVoiceLabels)

document.getElementById('btnVoiceTest').addEventListener('click', () => {
  const el = document.getElementById('voiceTestResult')
  let total = 0
  try {
    total = SPEECH ? (SPEECH.getVoices() || []).length : 0
  } catch {
    total = 0
  }
  if (!total) {
    el.textContent =
      'Windows no tiene voces instaladas. Añádelas en Configuración → Hora e idioma → Voz.'
    el.className = 'test-result fail'
    return
  }
  host.previewVoice(`¡Miau! Soy ${state.config?.petName || 'Michi'}. Así suena mi voz.`, readVoiceSettings())
  el.textContent = 'Reproduciendo…'
  el.className = 'test-result ok'
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    if (el.textContent === 'Reproduciendo…') el.textContent = ''
  }, 6000)
})

if (SPEECH) {
  const refreshVoices = () => {
    if (!settingsEl.hidden) populateVoices(form.voiceName.value)
  }
  if (typeof SPEECH.addEventListener === 'function') {
    SPEECH.addEventListener('voiceschanged', refreshVoices)
  } else {
    SPEECH.onvoiceschanged = refreshVoices
  }
}

document.getElementById('btnToggleKey').addEventListener('click', (event) => {
  const button = event.currentTarget
  const show = form.apiKey.type === 'password'
  form.apiKey.type = show ? 'text' : 'password'
  button.textContent = show ? 'Ocultar' : 'Ver'
})

document.getElementById('btnTest').addEventListener('click', async () => {
  const button = document.getElementById('btnTest')
  button.disabled = true
  testResult.textContent = 'Probando conexión…'
  testResult.className = 'test-result'
  try {
    const result = await host.testConfig(readSettingsForm())
    testResult.textContent = result.message
    testResult.className = `test-result ${result.ok ? 'ok' : 'fail'}`
  } catch (error) {
    testResult.textContent = `Error inesperado: ${error.message}`
    testResult.className = 'test-result fail'
  } finally {
    button.disabled = false
  }
})

document.getElementById('btnSave').addEventListener('click', async () => {
  const button = document.getElementById('btnSave')
  button.disabled = true
  try {
    const result = await host.saveConfig(readSettingsForm())
    if (result?.ok) {
      state.config = { ...state.config, ...(result.config || {}) }
      applyConfigToUi()
      if (result.restartRequired) {
        showSaveNote('Guardado. Reiniciando para aplicar el fondo…')
        return
      }
      showSaveNote('Guardado ✓')
      setTimeout(() => {
        if (!settingsEl.hidden) closeSettings()
      }, 900)
    } else {
      showSaveNote('No se pudo guardar', true)
    }
  } catch (error) {
    showSaveNote(`No se pudo guardar: ${error.message}`, true)
  } finally {
    button.disabled = false
  }
})

document.getElementById('btnSettingsClose').addEventListener('click', closeSettings)

document.getElementById('btnDataFolder').addEventListener('click', () => host.openDataFolder())

document.getElementById('btnQuit').addEventListener('click', () => {
  host.quit()
})

document.getElementById('btnClear').addEventListener('click', (event) => {
  const button = event.currentTarget
  if (!state.clearing) {
    state.clearing = true
    button.textContent = '¿Seguro? Pulsa otra vez'
    setTimeout(() => {
      state.clearing = false
      button.textContent = 'Borrar conversación'
    }, 3200)
    return
  }
  state.clearing = false
  button.textContent = 'Borrar conversación'
  host.clearChat()
  showSaveNote('Conversación borrada')
})

/* ------------------------------- Arranque --------------------------------- */

;(async () => {
  try {
    const data = await host.bootstrap()
    state.config = data.config || {}
    state.isPackaged = Boolean(data.isPackaged)
    state.version = data.version || '—'
    state.update = data.updateState || { status: 'idle', version: null, percent: 0, message: null }
    applyConfigToUi()
    renderUpdate()

    const history = Array.isArray(data.history) ? data.history : []
    for (const message of history) {
      appendMessage(message, { scroll: false })
    }
    updateWelcome()

    if (history.length) {
      state.nearBottom = true
      scrollToBottom(true)
    } else {
      inputEl.focus()
    }

    fillProviderOptions()
    fillSettingsForm()
  } catch (error) {
    appendNotice(`No se pudo cargar la app: ${error.message}`, 'error')
  }
})()
