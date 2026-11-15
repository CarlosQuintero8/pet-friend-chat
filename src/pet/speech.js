'use strict'

/* Michi — voz con la Web Speech API.
 *
 * Usa las voces instaladas en Windows (SAPI), sin conexión y sin enviar texto
 * a ningún servicio. Trocea las respuestas largas porque algunos motores
 * cortan las locuciones de más de ~15 segundos.
 */

;(() => {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  const listeners = new Set()
  const settings = { enabled: true, name: '', rate: 1, pitch: 1, volume: 1 }

  const MAX_CHUNK = 170
  const START_TIMEOUT = 2500

  let voices = []
  let generation = 0
  let queue = []
  let current = null
  let speaking = false
  let startTimer = null
  let pieceTimer = null
  let started = false

  function emit(type, detail) {
    for (const fn of listeners) {
      try {
        fn(type, detail)
      } catch (error) {
        console.error('No se pudo notificar el estado de la voz', error)
      }
    }
  }

  function onState(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function loadVoices() {
    if (!synth) return []
    try {
      voices = synth.getVoices() || []
    } catch {
      voices = []
    }
    return voices
  }

  if (synth) {
    loadVoices()
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', loadVoices)
    } else {
      synth.onvoiceschanged = loadVoices
    }
  }

  function supported() {
    return Boolean(synth)
  }

  function list() {
    if (!voices.length) loadVoices()
    return voices.map((voice) => ({
      name: voice.name,
      lang: voice.lang,
      local: voice.localService !== false,
    }))
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return Math.min(max, Math.max(min, number))
  }

  function configure(next) {
    if (!next) return
    if (typeof next.enabled === 'boolean') settings.enabled = next.enabled
    if (typeof next.name === 'string') settings.name = next.name
    if (next.rate !== undefined) settings.rate = clamp(next.rate, 0.5, 1.8, 1)
    if (next.pitch !== undefined) settings.pitch = clamp(next.pitch, 0.5, 1.6, 1)
    if (next.volume !== undefined) settings.volume = clamp(next.volume, 0, 1, 1)
  }

  function pickVoice(name) {
    if (!voices.length) loadVoices()
    if (!voices.length) return null

    const wantedName = typeof name === 'string' ? name.trim() : ''
    if (wantedName) {
      const exact = voices.find(
        (voice) => voice.name === wantedName || voice.voiceURI === wantedName,
      )
      if (exact) return exact
    }

    const spanish = voices.filter((voice) => /^es([-_]|$)/i.test(voice.lang || ''))
    if (spanish.length) {
      // Para la voz de Michi preferimos voces femeninas conocidas de Windows.
      const female = ['sabina', 'helena', 'laura', 'elena', 'paulina', 'monica', 'mónica', 'carmen', 'lucia', 'lucía']
      const match = spanish.find((voice) =>
        female.some((name) => String(voice.name || '').toLowerCase().includes(name)),
      )
      if (match) return match
      return (
        spanish.find((voice) => /^es-ES/i.test(voice.lang)) ||
        spanish.find((voice) => /^es[-_](MX|US|AR|CO|CL|PE)/i.test(voice.lang)) ||
        spanish[0]
      )
    }
    return voices.find((voice) => voice.default) || voices[0] || null
  }

  /* La etiqueta de ánimo ([curioso]) y el marcado no deben leerse en voz alta. */
  function sanitize(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
      .replace(/https?:\/\/\S+/gi, 'enlace')
      .replace(/^\s*\[[^\]\n]{1,24}\]\s*/, '')
      .replace(/[*_#>~|]/g, ' ')
      .replace(
        /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim()
  }

  function splitLong(sentence) {
    const parts = []
    let rest = sentence
    while (rest.length > MAX_CHUNK) {
      let cut = rest.lastIndexOf(' ', MAX_CHUNK)
      if (cut < MAX_CHUNK * 0.5) cut = MAX_CHUNK
      parts.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) parts.push(rest)
    return parts
  }

  function chunk(text) {
    const sentences = text.match(/[^.!?…;:\n]+[.!?…;:\n]+|[^.!?…;:\n]+$/g) || [text]
    const parts = []
    let currentPart = ''

    for (const raw of sentences) {
      const sentence = raw.trim()
      if (!sentence) continue
      if (sentence.length > MAX_CHUNK) {
        if (currentPart) {
          parts.push(currentPart)
          currentPart = ''
        }
        parts.push(...splitLong(sentence))
        continue
      }
      if (currentPart && currentPart.length + sentence.length + 1 > MAX_CHUNK) {
        parts.push(currentPart)
        currentPart = sentence
      } else {
        currentPart = currentPart ? `${currentPart} ${sentence}` : sentence
      }
    }
    if (currentPart) parts.push(currentPart)
    return parts
  }

  function clearTimers() {
    clearTimeout(startTimer)
    startTimer = null
    clearTimeout(pieceTimer)
    pieceTimer = null
  }

  function cancel(silent) {
    generation += 1
    queue = []
    clearTimers()
    current = null
    if (synth) {
      try {
        synth.cancel()
      } catch {
        /* el motor ya estaba parado */
      }
    }
    const wasSpeaking = speaking
    speaking = false
    started = false
    if (wasSpeaking && !silent) emit('end')
  }

  function finish() {
    clearTimers()
    current = null
    const wasSpeaking = speaking
    speaking = false
    started = false
    if (wasSpeaking) emit('end')
  }

  function speak(text, override) {
    if (!synth) return false
    const enabled = override?.enabled !== undefined ? Boolean(override.enabled) : settings.enabled
    if (!enabled) return false

    const clean = sanitize(text)
    if (!clean) return false

    cancel(true)

    const options = {
      name: override?.name !== undefined ? String(override.name || '') : settings.name,
      rate: override?.rate !== undefined ? clamp(override.rate, 0.5, 1.8, 1) : settings.rate,
      pitch: override?.pitch !== undefined ? clamp(override.pitch, 0.5, 1.6, 1) : settings.pitch,
      volume: override?.volume !== undefined ? clamp(override.volume, 0, 1, 1) : settings.volume,
    }

    const parts = chunk(clean)
    if (!parts.length) return false

    const myGeneration = generation
    const voice = pickVoice(options.name)

    queue = parts
    speaking = true
    started = false

    const step = () => {
      if (myGeneration !== generation) return
      if (!queue.length) {
        finish()
        return
      }

      const piece = queue.shift()
      const utterance = new SpeechSynthesisUtterance(piece)
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      }
      utterance.rate = options.rate
      utterance.pitch = options.pitch
      utterance.volume = options.volume
      current = utterance

      utterance.onstart = () => {
        if (myGeneration !== generation) return
        clearTimeout(startTimer)
        startTimer = null
        if (!started) {
          started = true
          emit('start', { voice: voice?.name || '', lang: voice?.lang || '' })
        }
        clearTimeout(pieceTimer)
        // Red de seguridad: si el motor no avisa del final, seguimos.
        pieceTimer = setTimeout(
          () => {
            if (myGeneration !== generation) return
            if (current === utterance) {
              current = null
              step()
            }
          },
          Math.max(8000, piece.length * 130),
        )
      }

      utterance.onend = () => {
        if (myGeneration !== generation) return
        clearTimeout(pieceTimer)
        pieceTimer = null
        if (current === utterance) current = null
        step()
      }

      utterance.onerror = (event) => {
        if (myGeneration !== generation) return
        clearTimeout(pieceTimer)
        pieceTimer = null
        if (current === utterance) current = null
        const code = event?.error || 'unknown'
        if (code === 'interrupted' || code === 'canceled') return
        if (code === 'not-allowed' || code === 'audio-busy') {
          emit('error', { code })
          finish()
          return
        }
        // Un trozo problemático no debe cortar toda la respuesta.
        step()
      }

      try {
        synth.speak(utterance)
      } catch (error) {
        emit('error', { code: 'speak-failed', message: String(error?.message || error) })
        finish()
        return
      }

      clearTimeout(startTimer)
      startTimer = setTimeout(() => {
        if (myGeneration !== generation) return
        if (!started) {
          started = true
          emit('start', { voice: voice?.name || '', lang: voice?.lang || '' })
        }
      }, START_TIMEOUT)
    }

    step()
    return true
  }

  function stop() {
    cancel(false)
  }

  window.MichiSpeech = {
    speak,
    stop,
    configure,
    supported,
    list,
    onState,
  }

  window.addEventListener('beforeunload', () => cancel(true))
})()
