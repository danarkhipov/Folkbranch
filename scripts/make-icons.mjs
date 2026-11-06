// Renders every icon from the sources in docs/brand. Run it after changing the logo: node scripts/make-icons.mjs
import { copyFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const png = (source, size) => sharp(`docs/brand/${source}.svg`, { density: 72 * Math.ceil(size / 64) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

// An .ico file may simply hold PNG images.
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let at = head.length
  images.forEach(({ size, data }, i) => {
    const row = 6 + i * 16
    head[row] = size
    head[row + 1] = size
    head.writeUInt16LE(1, row + 4)
    head.writeUInt16LE(32, row + 6)
    head.writeUInt32LE(data.length, row + 8)
    head.writeUInt32LE(at, row + 12)
    at += data.length
  })
  return Buffer.concat([head, ...images.map((x) => x.data)])
}

const sizes = [16, 32, 48]
writeFileSync('app/favicon.ico', ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png('favicon', size) })))))
copyFileSync('docs/brand/favicon.svg', 'app/icon.svg')
writeFileSync('app/apple-icon.png', await png('app-icon', 180))
writeFileSync('public/icon-192.png', await png('favicon', 192))
writeFileSync('public/icon-512.png', await png('favicon', 512))
writeFileSync('public/icon-maskable-512.png', await png('maskable', 512))
