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
    if (!settingsEl.hidden) closeSettings()
    else host.hideChat()
  }
})

/* Botones de la cabecera */
document.getElementById('btnClose').addEventListener('click', () => host.hideChat())
document.getElementById('btnMin').addEventListener('click', () => host.minimizeChat())
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
