// Builds the family map's own base map, shipped with the app: public/atlas/*.json from Natural Earth 1:50m
// (public domain, naturalearthdata.com). Nothing is fetched at run time. Run by hand when the data should change:
//   node scripts/build-atlas.mjs        (needs network once; uses npx mapshaper)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson'
const OUT = path.resolve('public/atlas')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'))
fs.mkdirSync(OUT, { recursive: true })

async function get(name) {
  const file = path.join(tmp, `${name}.geojson`)
  const res = await fetch(`${SRC}/${name}.geojson`)
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}
const shaper = (args) => execFileSync('npx', ['-y', 'mapshaper@0.6', ...args], { stdio: 'inherit' })

// Shapes: simplified, coordinates rounded to ~1 km, only the fields drawn.
shaper(['-i', await get('ne_50m_land'), '-simplify', '35%', 'keep-shapes', '-filter-fields', '', '-o', `${OUT}/land.json`, 'format=geojson', 'precision=0.01'])
shaper(['-i', await get('ne_50m_admin_0_boundary_lines_land'), '-simplify', '40%', '-filter-fields', '', '-o', `${OUT}/borders.json`, 'format=geojson', 'precision=0.01'])
shaper(['-i', await get('ne_50m_lakes'), '-filter', 'scalerank <= 4', '-simplify', '40%', 'keep-shapes', '-filter-fields', '', '-o', `${OUT}/lakes.json`, 'format=geojson', 'precision=0.01'])
shaper(['-i', await get('ne_50m_rivers_lake_centerlines'), '-filter', 'scalerank <= 5', '-simplify', '40%', '-filter-fields', '', '-o', `${OUT}/rivers.json`, 'format=geojson', 'precision=0.01'])

// Labels as compact rows: [name, lat, lon, rank]; a lower rank shows from further out.
const rows = (file, pick) => JSON.parse(fs.readFileSync(file, 'utf8')).features.map(pick).filter(Boolean)
const r2 = (n) => Math.round(n * 100) / 100
const countries = rows(await get('ne_50m_admin_0_countries'), (f) => [f.properties.NAME, r2(f.properties.LABEL_Y), r2(f.properties.LABEL_X), f.properties.LABELRANK])
const cities = rows(await get('ne_50m_populated_places_simple'), (f) => (f.properties.scalerank <= 6 ? [f.properties.name, r2(f.properties.latitude), r2(f.properties.longitude), f.properties.adm0cap ? Math.min(f.properties.scalerank, 2) : f.properties.scalerank] : null))
fs.writeFileSync(`${OUT}/labels.json`, JSON.stringify({ countries, cities }))
fs.writeFileSync(`${OUT}/LICENSE.txt`, 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com (public domain).\nBuilt by scripts/build-atlas.mjs from Natural Earth 1:50m v5.1.2.\n')

for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(14), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0), 'KB')
fs.rmSync(tmp, { recursive: true, force: true })
