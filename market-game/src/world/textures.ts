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
          ctx.fillStyle = '#a0482c'
          ctx.fillRect(0, 0, w, h)
          const bw = 28
          const bh = 12
          for (let y = 0, row = 0; y < h; y += bh + 3, row++) {
            const ox = row % 2 === 0 ? 0 : bw / 2
            for (let x = -bw; x < w; x += bw + 3) {
              const soot = Math.random()
              const r = 198 + Math.floor(soot * 32) - (soot > 0.9 ? 18 : 0)
              const g = 92 + Math.floor(soot * 24)
              const b = 52 + Math.floor(soot * 10)
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
          ctx.fillStyle = '#8a9088'
          ctx.fillRect(0, 0, w, h)
          for (let x = 0; x < w; x += 16) {
            ctx.fillStyle = x % 32 === 0 ? '#9aa098' : '#7a8078'
            ctx.fillRect(x, 0, 14, h)
            ctx.fillStyle = 'rgba(40,36,28,0.28)'
            ctx.fillRect(x + 13, 0, 1, h)
          }
          for (let i = 0; i < 90; i++) {
            ctx.fillStyle = `rgba(${110 + Math.random() * 70},${70 + Math.random() * 40},40,0.22)`
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
          ctx.fillStyle = '#3d9a32'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 1800; i++) {
            const g = 118 + Math.random() * 70
            ctx.fillStyle = `rgb(${g - 62},${g},${g - 88})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
          }
          ctx.fillStyle = '#5a8a30'
          for (let i = 0; i < 10; i++) {
            ctx.fillRect(Math.random() * w, Math.random() * h, 14, 8)
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
  c.width = 768
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#2a2218'
  ctx.fillRect(0, 0, 768, 128)
  ctx.fillStyle = '#3a3024'
  ctx.fillRect(8, 8, 752, 112)
  ctx.strokeStyle = paint
  ctx.lineWidth = 6
  ctx.strokeRect(14, 14, 740, 100)
  ctx.fillStyle = '#f0e6d4'
  ctx.font = 'bold 64px "IBM Plex Mono", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, 384, 68)
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

export function makeOpenBannerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 768
  c.height = 160
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#3a2210'
  ctx.fillRect(0, 0, 768, 160)
  ctx.fillStyle = '#5a3a18'
  ctx.fillRect(10, 10, 748, 140)
  ctx.strokeStyle = '#e8c04a'
  ctx.lineWidth = 8
  ctx.strokeRect(18, 18, 732, 124)
  ctx.fillStyle = '#f4e6c8'
  ctx.font = 'bold 72px "Bebas Neue", "IBM Plex Mono", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('9:30 NYC CASH', 384, 82)
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
