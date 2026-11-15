'use strict'

/* Prueba de desarrollo: voz del gato y controles de voz del chat. */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

ipcMain.handle('asset:read-frame', () => '')
ipcMain.handle('app:bootstrap', () => ({
  config: {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    petName: 'Michi',
    personality: 'dulce, juguetona y un poco tragona',
    alwaysOnTop: true,
    windowMode: 'transparent',
    comments: true,
    voiceEnabled: true,
    voiceName: '',
    voiceRate: 1,
    voicePitch: 1,
    voiceVolume: 0.2,
  },
  history: [],
  isPackaged: false,
  solid: false,
  version: '1.3.0',
  updateState: { status: 'idle', version: null, percent: 0 },
}))
ipcMain.handle('config:save', () => ({ ok: true, config: {} }))
ipcMain.on('speech:state', (event, speaking) => {
  console.log('[ipc] speech:state', speaking)
})

const failures = []
function check(name, condition, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail !== undefined ? ` -> ${detail}` : ''}`)
  if (!condition) failures.push(name)
}

async function testPet() {
  const pet = new BrowserWindow({
    width: 248,
    height: 254,
    show: true,
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
    query: { solid: '0' },
  })
  await wait(1500)

  const support = await pet.webContents.executeJavaScript(
    `({ supported: window.MichiSpeech.supported(), voices: window.MichiSpeech.list().length })`,
  )
  check('Web Speech disponible', support.supported === true)
  check('Voces instaladas', support.voices > 0, support.voices)

  await pet.webContents.executeJavaScript(`(() => {
    window.__voiceLog = []
    window.__voiceState = null
    window.MichiSpeech.onState((type) => {
      window.__voiceLog.push(type)
      if (type === 'start') window.__voiceState = document.getElementById('stage').dataset.state
    })
    window.MichiSpeech.speak('Hola, soy Michi. Esta es una prueba de voz.', {
      enabled: true,
      volume: 0.2,
    })
    return true
  })()`)

  let log = []
  for (let i = 0; i < 100; i++) {
    await wait(100)
    log = await pet.webContents.executeJavaScript(`window.__voiceLog.slice()`)
    if (log.includes('start') && log.includes('end')) break
  }

  const stateDuring = await pet.webContents.executeJavaScript(`window.__voiceState`)
  check('La voz arranca', log.includes('start'), JSON.stringify(log))
  check('La voz termina', log.includes('end'), JSON.stringify(log))
  check('El gato entra en estado speak', stateDuring === 'speak', stateDuring)

  // Interrupción: debe detenerse y avisar del final.
  const interrupted = await pet.webContents.executeJavaScript(`(async () => {
    const events = []
    window.MichiSpeech.onState((type) => events.push(type))
    window.MichiSpeech.speak('Una frase bastante larga para poder interrumpirla a mitad. Otra frase más para alargar la locución.', { enabled: true, volume: 0 })
    await new Promise((resolve) => setTimeout(resolve, 400))
    window.MichiSpeech.stop()
    await new Promise((resolve) => setTimeout(resolve, 600))
    return events
  })()`)
  check('La interrupción avisa del final', interrupted.includes('end'), JSON.stringify(interrupted))

  // Canal real: el proceso principal pide hablar a la mascota.
  await pet.webContents.executeJavaScript(`window.__voiceLog = []`)
  pet.webContents.send('speech:speak', {
    text: '[feliz] Hola desde el proceso principal.',
    voice: { enabled: true, volume: 0.2, rate: 1, pitch: 1, name: '' },
  })

  let ipcLog = []
  for (let i = 0; i < 100; i++) {
    await wait(100)
    ipcLog = await pet.webContents.executeJavaScript(`window.__voiceLog.slice()`)
    if (ipcLog.includes('start') && ipcLog.includes('end')) break
  }
  check('Canal speech:speak de main a mascota', ipcLog.includes('start') && ipcLog.includes('end'), JSON.stringify(ipcLog))

  return pet
}

async function testChat() {
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
    query: { solid: '0' },
  })
  await wait(1200)

  const info = await chat.webContents.executeJavaScript(`(async () => {
    document.getElementById('btnSettings').click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    return {
      voiceButton: Boolean(document.getElementById('btnVoice')),
      micButton: Boolean(document.getElementById('btnMic')),
      labels: Array.from(document.querySelectorAll('.switch-text b')).map((el) => el.textContent),
      voiceOptions: document.getElementById('fVoiceName').options.length,
      sliders: ['fVoiceRate', 'fVoicePitch', 'fVoiceVolume'].map((id) => Boolean(document.getElementById(id))),
      switchOn: document.getElementById('fVoice').checked,
      rateLabel: document.getElementById('voiceRateValue').textContent,
    }
  })()`)

  check('Botón de voz en la cabecera', info.voiceButton === true)
  check('Botón de micrófono en el compositor', info.micButton === true)
  check('Interruptor "Hablar las respuestas"', info.labels.includes('Hablar las respuestas'), JSON.stringify(info.labels))
  check('Selector de voces con opciones', info.voiceOptions > 1, info.voiceOptions)
  check('Tres controles deslizantes', info.sliders.every(Boolean), JSON.stringify(info.sliders))
  check('Voz activada por defecto', info.switchOn === true)
  check('Etiqueta de velocidad', info.rateLabel === '1.0×', info.rateLabel)

  return chat
}

app.whenReady().then(async () => {
  try {
    const pet = await testPet()
    const chat = await testChat()
    pet.destroy()
    chat.destroy()
  } catch (error) {
    console.error('FALLO:', error)
    failures.push(error.message)
  }

  console.log(failures.length ? `FALLOS: ${failures.join(', ')}` : 'TODO OK')
  app.exit(failures.length ? 1 : 0)
})
