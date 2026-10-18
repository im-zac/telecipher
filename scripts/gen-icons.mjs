// 產 PWA icons：ember 底、ember 鑰匙。bun run icons
import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'node:fs'

const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="${pad ? 0 : 14}" fill="#201c1a"/>
  <g transform="translate(${pad ? 8 : 4} ${pad ? 8 : 4}) scale(${pad ? 0.75 : 0.875})" fill="none" stroke="#e8a94a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="22" cy="24" r="11"/>
    <path d="M30 32 L54 56 M44 46 L50 40 M38 40 L44 34"/>
  </g>
</svg>`
const png = (s, pad = false) => new Resvg(svg(s, pad), { fitTo: { mode: 'width', value: s } }).render().asPng()
writeFileSync('public/favicon.svg', svg(64))
writeFileSync('public/icon-192.png', png(192))
writeFileSync('public/icon-512.png', png(512))
writeFileSync('public/icon-512-maskable.png', png(512, true))
writeFileSync('public/apple-touch-icon.png', png(180))
console.log('icons 已產生到 public/')
