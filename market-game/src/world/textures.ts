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
          ctx.fillStyle = '#5a3428'
          ctx.fillRect(0, 0, w, h)
          const bw = 28
          const bh = 12
          for (let y = 0, row = 0; y < h; y += bh + 3, row++) {
            const ox = row % 2 === 0 ? 0 : bw / 2
            for (let x = -bw; x < w; x += bw + 3) {
              const soot = Math.random()
              const r = 118 + Math.floor(soot * 40) - (soot > 0.82 ? 28 : 0)
              const g = 58 + Math.floor(soot * 18)
              const b = 38 + Math.floor(soot * 10)
              ctx.fillStyle = `rgb(${r},${g},${b})`
              ctx.fillRect(x + ox, y, bw, bh)
            }
          }
        },
        3,
        2.4,
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
          ctx.fillStyle = '#6a5848'
          ctx.fillRect(0, 0, w, h)
          for (let x = 0; x < w; x += 16) {
            ctx.fillStyle = x % 32 === 0 ? '#7a6854' : '#5e5044'
            ctx.fillRect(x, 0, 14, h)
            ctx.fillStyle = 'rgba(30,16,8,0.35)'
            ctx.fillRect(x + 13, 0, 1, h)
          }
          for (let i = 0; i < 90; i++) {
            ctx.fillStyle = `rgba(${90 + Math.random() * 80},${40 + Math.random() * 30},20,0.28)`
            ctx.fillRect(Math.random() * w, Math.random() * h, 8, 3)
          }
        },
        2.4,
        2,
      ),
    [],
  )
}

export function useAsphaltTexture() {
  return useMemo(
    () =>
      canvasTex(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = '#4a4742'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 2200; i++) {
            const v = 62 + Math.random() * 38
            ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
          }
          ctx.fillStyle = 'rgba(18,12,8,0.35)'
          for (let i = 0; i < 12; i++) {
            ctx.beginPath()
            ctx.ellipse(Math.random() * w, Math.random() * h, 18 + Math.random() * 22, 8, Math.random(), 0, Math.PI * 2)
            ctx.fill()
          }
        },
        4,
        4,
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
          ctx.fillStyle = '#8a8074'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 1100; i++) {
            const v = 110 + Math.random() * 50
            ctx.fillStyle = `rgba(${v},${v - 10},${v - 22},0.45)`
            ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
          }
          ctx.fillStyle = 'rgba(20,12,8,0.28)'
          for (let i = 0; i < 8; i++) {
            ctx.beginPath()
            ctx.ellipse(Math.random() * w, Math.random() * h, 22, 10, 0.4, 0, Math.PI * 2)
            ctx.fill()
          }
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
          ctx.fillStyle = '#4a6a32'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 1600; i++) {
            const g = 70 + Math.random() * 55
            ctx.fillStyle = `rgb(${g - 28},${g},${g - 42})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
          }
          ctx.fillStyle = '#6a5438'
          for (let i = 0; i < 18; i++) {
            ctx.fillRect(Math.random() * w, Math.random() * h, 18, 10)
          }
        },
        6,
        6,
      ),
    [],
  )
}

export function useDirtTexture() {
  return useMemo(
    () =>
      canvasTex(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = '#6a5238'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 1400; i++) {
            const v = 70 + Math.random() * 50
            ctx.fillStyle = `rgb(${v},${v - 18},${v - 36})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 4, 3)
          }
        },
        4,
        4,
      ),
    [],
  )
}

export function makeFasciaTexture(title: string, paint: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 96
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#2a2218'
  ctx.fillRect(0, 0, 512, 96)
  ctx.fillStyle = '#3a3024'
  ctx.fillRect(6, 6, 500, 84)
  ctx.strokeStyle = paint
  ctx.lineWidth = 4
  ctx.strokeRect(10, 10, 492, 76)
  ctx.fillStyle = '#f0e6d4'
  ctx.font = 'bold 42px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, 256, 50)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

export function makeStencilTexture(word: string, ink: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, 1024, 256)
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.55
  ctx.font = 'bold 92px "Bebas Neue", "IBM Plex Mono", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(word, 512, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

export function makeChalkTexture(price: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 384
  c.height = 192
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#24382c'
  ctx.fillRect(0, 0, 384, 192)
  ctx.fillStyle = '#1a2a22'
  ctx.fillRect(10, 10, 364, 172)
  ctx.strokeStyle = '#c4a046'
  ctx.lineWidth = 4
  ctx.strokeRect(16, 16, 352, 160)
  ctx.fillStyle = '#e8e0c8'
  ctx.font = 'bold 54px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(price, 192, 100)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

export function makeCalloutTexture(title: string, price: string, hex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#1c1810'
  ctx.fillRect(0, 0, 512, 160)
  ctx.strokeStyle = hex
  ctx.lineWidth = 6
  ctx.strokeRect(8, 8, 496, 144)
  ctx.fillStyle = '#e8dcc8'
  ctx.font = 'bold 36px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.fillText(title, 256, 58)
  ctx.fillStyle = hex
  ctx.font = 'bold 52px "IBM Plex Mono", monospace'
  ctx.fillText(price, 256, 118)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}
