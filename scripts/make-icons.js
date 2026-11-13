'use strict'

/**
 * Empaqueta assets/icon.png (256x256) como assets/icon.ico para Windows.
 * El PNG se genera antes con scripts/make-icons.ps1 a partir del arte del gato.
 */

const fs = require('node:fs')
const path = require('node:path')

const assets = path.join(__dirname, '..', 'assets')
const png = fs.readFileSync(path.join(assets, 'icon.png'))

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
if (!png.subarray(0, 8).equals(signature)) {
  throw new Error('assets/icon.png no es un PNG válido')
}

const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)
if (width !== 256 || height !== 256) {
  throw new Error(`Se esperaba un PNG de 256x256, recibido ${width}x${height}`)
}

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reservado
header.writeUInt16LE(1, 2) // tipo: icono
header.writeUInt16LE(1, 4) // número de imágenes

const entry = Buffer.alloc(16)
entry[0] = 0 // 0 = 256 px
entry[1] = 0
entry[2] = 0
entry[3] = 0
entry.writeUInt16LE(1, 4) // planos
entry.writeUInt16LE(32, 6) // bits por píxel
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12) // offset de los datos

fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, entry, png]))
console.log('assets/icon.ico generado desde assets/icon.png')
