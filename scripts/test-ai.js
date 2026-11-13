'use strict'

/* Prueba del cliente de IA con un servidor local integrado. */

const http = require('node:http')
const { streamChat, testConnection } = require('../src/main/ai')

const REPLY =
  '[feliz] ¡Miau! Soy Michi y esta respuesta viene de un servidor de prueba local. ' +
  'Si ves esto, el streaming funciona. 🐾'

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        console.log('[mock] petición recibida:', req.method, req.url)
        let payload = {}
        try {
          payload = JSON.parse(body)
        } catch {
          payload = {}
        }

        if (payload.stream === false) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: 'miau' } }] }))
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
            console.log('[mock] respuesta completada')
            return
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[index] } }] })}\n\n`)
          index += 1
        }, 20)

        res.on('close', () => clearInterval(timer))
      })
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  const server = await startMock()
  const port = server.address().port
  const config = {
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'test',
    model: 'mock-model',
    temperature: 0.8,
  }

  let full = ''
  let chunks = 0
  const text = await streamChat(
    config,
    [{ role: 'user', content: 'Hola Michi' }],
    (delta) => {
      chunks += 1
      full += delta
    },
  )
  console.log('chunks:', chunks)
  console.log('texto:', text.slice(0, 80), '…')
  console.log('acumulado coincide:', full === text)

  const test = await testConnection(config)
  console.log('test conexión:', JSON.stringify(test))

  const bad = await testConnection({
    ...config,
    baseURL: 'http://127.0.0.1:9/v1',
  })
  console.log('error de red:', bad.ok, '-', bad.message)

  server.close()
}

main().catch((error) => {
  console.error('FALLO:', error)
  process.exitCode = 1
})
