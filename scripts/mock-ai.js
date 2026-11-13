'use strict'

/* Servidor local que imita una API compatible con OpenAI (para pruebas). */

const http = require('node:http')

const REPLY =
  '[feliz] ¡Miau! Soy Michi y esta respuesta viene de un servidor de prueba local. ' +
  'Si ves esto, el streaming funciona. 🐾 Luego puedes poner tu clave real de Gemini en Ajustes.'

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Ruta no encontrada' } }))
      return
    }

    let payload = {}
    try {
      payload = JSON.parse(body)
    } catch {
      payload = {}
    }

    if (payload.stream === false) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'miau' } }],
        }),
      )
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const pieces = REPLY.match(/[\s\S]{1,7}/g) || []
    let index = 0
    const timer = setInterval(() => {
      if (index >= pieces.length) {
        clearInterval(timer)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: pieces[index] } }] })}\n\n`,
      )
      index += 1
    }, 40)

    res.on('close', () => clearInterval(timer))
  })
})

server.listen(8787, '127.0.0.1', () => {
  console.log('Mock de IA escuchando en http://127.0.0.1:8787/v1')
})
