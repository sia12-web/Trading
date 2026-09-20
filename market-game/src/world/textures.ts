import { useMemo } from 'react'
import * as THREE from 'three'

function canvasTex(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d')
  paint(ctx, w, h)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

export function useBrickTexture() {
  return useMemo(
    () =>
      canvasTex(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = '#b06048'
          ctx.fillRect(0, 0, w, h)
          const bw = 32
          const bh = 14
          for (let y = 0, row = 0; y < h; y += bh + 3, row++) {
            const ox = row % 2 === 0 ? 0 : bw / 2
            for (let x = -bw; x < w; x += bw + 3) {
              const shade = 168 + Math.floor(Math.random() * 50)
              ctx.fillStyle = `rgb(${shade + 48},${shade - 22},${shade - 48})`
              ctx.fillRect(x + ox, y, bw, bh)
            }
          }
        },
        4,
        3,
      ),
    [],
  )
}

export function useMetalTexture() {
  return useMemo(
    () =>
      canvasTex(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = '#7a8794'
          ctx.fillRect(0, 0, w, h)
          for (let x = 0; x < w; x += 14) {
            ctx.fillStyle = x % 28 === 0 ? '#9aacb8' : '#8a9aa6'
            ctx.fillRect(x, 0, 12, h)
            ctx.fillStyle = 'rgba(0,0,0,0.12)'
            ctx.fillRect(x + 11, 0, 1, h)
          }
          ctx.fillStyle = 'rgba(255,255,255,0.12)'
          for (let i = 0; i < 80; i++) {
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 8)
          }
        },
        3,
        2,
      ),
    [],
  )
}

export function useAsphaltTexture() {
  return useMemo(
    () =>
      canvasTex(
        512,
        512,
        (ctx, w, h) => {
          ctx.fillStyle = '#8a8880'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 4000; i++) {
            const v = 120 + Math.random() * 42
            ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
          }
          ctx.strokeStyle = 'rgba(232, 196, 64, 0.75)'
          ctx.lineWidth = 6
          ctx.setLineDash([28, 22])
          ctx.beginPath()
          ctx.moveTo(w / 2, 0)
          ctx.lineTo(w / 2, h)
          ctx.stroke()
        },
        8,
        8,
      ),
    [],
  )
}

export function useConcreteTexture() {
  return useMemo(
    () =>
      canvasTex(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = '#d8d0c4'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 900; i++) {
            const v = 170 + Math.random() * 50
            ctx.fillStyle = `rgba(${v},${v - 8},${v - 16},0.4)`
            ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.12)'
          ctx.strokeRect(2, 2, w - 4, h - 4)
        },
        2,
        2,
      ),
    [],
  )
}

export function useGrassTexture() {
  return useMemo(
    () =>
      canvasTex(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = '#78aa50'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 1800; i++) {
            const g = 90 + Math.random() * 70
            ctx.fillStyle = `rgb(${g - 20},${g + 20},${g - 40})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
          }
        },
        10,
        10,
      ),
    [],
  )
}

export function makeLedTexture(title: string, price: string, sub: string, hex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 512
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#1c3a58'
  ctx.fillRect(0, 0, 1024, 512)
  ctx.fillStyle = '#2a5074'
  ctx.fillRect(24, 24, 976, 464)
  ctx.strokeStyle = hex
  ctx.lineWidth = 8
  ctx.strokeRect(40, 40, 944, 432)
  ctx.fillStyle = hex
  ctx.font = 'bold 64px "IBM Plex Mono", monospace'
  ctx.fillText(title, 72, 140)
  ctx.font = 'bold 140px "IBM Plex Mono", monospace'
  ctx.fillText(price, 72, 300)
  ctx.globalAlpha = 0.85
  ctx.font = '36px "IBM Plex Mono", monospace'
  ctx.fillText(sub, 72, 380)
  ctx.globalAlpha = 0.12
  for (let y = 48; y < 464; y += 4) {
    ctx.fillRect(48, y, 928, 1)
  }
  ctx.globalAlpha = 1
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}
