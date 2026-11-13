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

module.exports = { streamChat, testConnection, isLocalURL }
