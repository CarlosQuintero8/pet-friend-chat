'use strict'

/**
 * Cliente de IA compatible con la API de OpenAI.
 * Funciona con Gemini, OpenAI, OpenRouter, DeepSeek, Groq y Ollama local.
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1']

function isLocalURL(baseURL) {
  try {
    const url = new URL(baseURL)
    return LOCAL_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

function endpoint(baseURL, suffix = '') {
  return `${String(baseURL || '').replace(/\/+$/, '')}${suffix}`
}

function extractDetail(body) {
  if (!body) return ''
  try {
    const json = JSON.parse(body)
    const raw = json?.error?.message || json?.message || json?.error
    if (typeof raw === 'string') return raw.slice(0, 220)
  } catch {
    /* el cuerpo no era JSON */
  }
  return String(body).replace(/\s+/g, ' ').trim().slice(0, 220)
}

function httpErrorMessage(status, body) {
  const detail = extractDetail(body)
  if (status === 400) {
    return `La petición no es válida${detail ? `: ${detail}` : '.'} Revisa el modelo en Ajustes.`
  }
  if (status === 401 || status === 403) {
    return 'La clave de API no es válida o no tiene permisos. Revísala en Ajustes.'
  }
  if (status === 404) {
    return `No encuentro ese modelo o la URL base no es correcta${detail ? `: ${detail}` : '.'}`
  }
  if (status === 429) {
    return 'Demasiadas peticiones o cuota agotada. Espera unos segundos y vuelve a intentarlo.'
  }
  if (status >= 500) {
    return 'El servicio de IA está teniendo problemas. Inténtalo de nuevo en un momento.'
  }
  return `Error ${status}${detail ? `: ${detail}` : ''}`
}

function networkErrorMessage(err) {
  if (err?.name === 'TimeoutError') {
    return 'La IA ha tardado demasiado en responder. Comprueba tu conexión e inténtalo de nuevo.'
  }
  if (err?.name === 'AbortError') return 'Respuesta cancelada.'
  const msg = String(err?.message || err)
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ERR_INTERNET/i.test(msg)) {
    return 'No puedo conectar con el servicio de IA. Revisa tu conexión, la URL base o si Ollama está en marcha.'
  }
  return msg
}

function headersFor(config) {
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  return headers
}

function timeoutSignal(signal, ms) {
  const timeout = AbortSignal.timeout(ms)
  if (!signal) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  return signal
}

function extractText(json) {
  const choice = json?.choices?.[0]
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
  }
  return ''
}

/**
 * Lanza una petición de chat en streaming y va emitiendo los trozos de texto.
 * @returns {Promise<string>} texto completo
 */
async function streamChat(config, messages, onDelta, signal) {
  if (!config?.baseURL || !config?.model) {
    throw new Error('Falta configurar la URL base o el modelo en Ajustes.')
  }
  if (!config.apiKey && !isLocalURL(config.baseURL)) {
    throw new Error('Falta la clave de API. Ábrela en Ajustes para conectar la IA.')
  }

  const payload = {
    model: config.model,
    messages,
    stream: true,
    temperature: Math.min(1.4, Math.max(0, Number(config.temperature) || 0.85)),
    max_tokens: 800,
  }

  let res
  try {
    res = await fetch(endpoint(config.baseURL, '/chat/completions'), {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify(payload),
      signal: timeoutSignal(signal, 120000),
    })
  } catch (err) {
    throw new Error(networkErrorMessage(err))
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(httpErrorMessage(res.status, body))
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    // Algunos proveedores ignoran "stream": true.
    const json = await res.json()
    const text = extractText(json)
    if (text) onDelta(text)
    return text
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const handleLine = (line) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let json
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    const delta = extractText(json)
    if (delta) {
      full += delta
      onDelta(delta)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, index).trim())
        buffer = buffer.slice(index + 1)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) handleLine(buffer.trim())
  } catch (err) {
    if (signal?.aborted) throw new Error('Respuesta cancelada.')
    throw new Error(networkErrorMessage(err))
  }

  return full
}

/* ------------------------------ Dictado por voz ---------------------------- */

const ASR_MODELS = {
  openai: 'whisper-1',
  groq: 'whisper-large-v3-turbo',
  custom: 'whisper-1',
}

function transcriptFromGemini(json) {
  const parts = json?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim()
}

async function transcribeWithGemini(config, audioBase64, mimeType) {
  if (!config.apiKey) {
    throw new Error('Falta la clave de API para transcribir el audio.')
  }
  const base = endpoint(config.baseURL).replace(/\/openai$/i, '')
  const url = `${base}/models/${encodeURIComponent(config.model)}:generateContent`

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcribe literalmente el audio en su idioma original. Devuelve solo el texto hablado, sin comillas, sin etiquetas y sin comentarios. Si no se oye ninguna voz, devuelve una cadena vacía.',
              },
              { inline_data: { mime_type: mimeType, data: audioBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(60000),
    })
  } catch (err) {
    throw new Error(networkErrorMessage(err))
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(httpErrorMessage(res.status, body))
  }

  const json = await res.json().catch(() => ({}))
  return transcriptFromGemini(json)
    .replace(/^["'«“]+/, '')
    .replace(/["'»”]+$/, '')
    .trim()
}

async function transcribeWithOpenAI(config, audioBase64, mimeType, model) {
  if (!config.apiKey && !isLocalURL(config.baseURL)) {
    throw new Error('Falta la clave de API para transcribir el audio.')
  }

  const bytes = Buffer.from(audioBase64, 'base64')
  if (!bytes.length) throw new Error('El audio llegó vacío.')

  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mimeType }), 'michi.wav')
  form.append('model', model)
  form.append('response_format', 'json')

  let res
  try {
    res = await fetch(endpoint(config.baseURL, '/audio/transcriptions'), {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
      body: form,
      signal: AbortSignal.timeout(60000),
    })
  } catch (err) {
    throw new Error(networkErrorMessage(err))
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 404) {
      throw new Error('Este proveedor no tiene servicio de transcripción de audio.')
    }
    throw new Error(httpErrorMessage(res.status, body))
  }

  const json = await res.json().catch(() => ({}))
  return String(json?.text || json?.transcription || '').trim()
}

/**
 * Transcribe una grabación de micrófono (WAV en base64) con el proveedor
 * configurado. Devuelve el texto dictado.
 */
async function transcribe(config, audioBase64, mimeType = 'audio/wav') {
  const audio = String(audioBase64 || '')
  if (!audio) throw new Error('No se ha grabado nada.')
  if (!config?.baseURL) throw new Error('Falta configurar la URL base en Ajustes.')

  const provider = config.provider || 'custom'
  if (provider === 'gemini') return transcribeWithGemini(config, audio, mimeType)

  const model = ASR_MODELS[provider]
  if (model) return transcribeWithOpenAI(config, audio, mimeType, model)

  throw new Error(
    'Este proveedor no admite dictado por voz. Usa Google Gemini, OpenAI o Groq en Ajustes.',
  )
}

/** Prueba rápida para el botón "Probar conexión". */
async function testConnection(config) {
  if (!config?.apiKey && !isLocalURL(config.baseURL)) {
    return { ok: false, message: 'Escribe primero tu clave de API.' }
  }
  if (!config?.baseURL || !config?.model) {
    return { ok: false, message: 'Faltan la URL base o el modelo.' }
  }
  try {
    const res = await fetch(endpoint(config.baseURL, '/chat/completions'), {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Responde solo con la palabra: miau' }],
        stream: false,
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, message: httpErrorMessage(res.status, body) }
    }
    const json = await res.json()
    const text = extractText(json)
    return {
      ok: true,
      message: text ? `¡Conexión perfecta! La IA responde: “${text.trim().slice(0, 60)}”` : 'Conexión correcta.',
    }
  } catch (err) {
    return { ok: false, message: networkErrorMessage(err) }
  }
}

module.exports = { streamChat, testConnection, transcribe, isLocalURL }
