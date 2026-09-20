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
          ctx.fillStyle = '#5a4034'
          ctx.fillRect(0, 0, w, h)
          const bw = 26
          const bh = 11
          const gap = 5
          for (let y = 0, row = 0; y < h; y += bh + gap, row++) {
            const ox = row % 2 === 0 ? 0 : bw / 2
            for (let x = -bw; x < w; x += bw + gap) {
              const soot = Math.random()
              const chip = soot > 0.9
              const r = 142 + Math.floor(soot * 36) - (soot > 0.72 ? 48 : 0) - (chip ? 30 : 0)
              const g = 62 + Math.floor(soot * 16) - (soot > 0.72 ? 24 : 0)
              const b = 40 + Math.floor(soot * 8) - (soot > 0.72 ? 14 : 0)
              ctx.fillStyle = `rgb(${r},${g},${b})`
              ctx.fillRect(x + ox, y, bw, bh)
              ctx.fillStyle = 'rgba(22,12,8,0.38)'
              ctx.fillRect(x + ox, y + bh - 2, bw, 2)
              if (chip) {
                ctx.fillStyle = 'rgba(40,24,16,0.55)'
                ctx.fillRect(x + ox + 4, y + 2, 8, 5)
              }
              if (soot > 0.78) {
                ctx.fillStyle = 'rgba(28,18,12,0.35)'
                ctx.fillRect(x + ox, y, bw, 3)
              }
            }
          }
          ctx.fillStyle = 'rgba(18,10,8,0.22)'
          for (let i = 0; i < 14; i++) {
            ctx.beginPath()
            ctx.ellipse(Math.random() * w, Math.random() * h, 18 + Math.random() * 22, 6, Math.random(), 0, Math.PI * 2)
            ctx.fill()
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
          ctx.fillStyle = '#6a7068'
          ctx.fillRect(0, 0, w, h)
          for (let x = 0; x < w; x += 16) {
            const rust = Math.random()
            ctx.fillStyle = x % 32 === 0 ? '#7a8078' : '#5a6058'
            ctx.fillRect(x, 0, 14, h)
            ctx.fillStyle = 'rgba(28,24,18,0.4)'
            ctx.fillRect(x + 13, 0, 1, h)
            if (rust > 0.45) {
              ctx.fillStyle = `rgba(${110 + rust * 50},${55 + rust * 20},28,0.38)`
              ctx.fillRect(x + 1, Math.random() * h * 0.4, 10, 18 + rust * 40)
            }
          }
          for (let i = 0; i < 70; i++) {
            ctx.fillStyle = `rgba(${90 + Math.random() * 50},${50 + Math.random() * 24},28,0.32)`
            ctx.fillRect(Math.random() * w, Math.random() * h, 10, 4)
          }
          ctx.fillStyle = 'rgba(12,10,8,0.28)'
          for (let i = 0; i < 10; i++) {
            ctx.beginPath()
            ctx.ellipse(Math.random() * w, Math.random() * h, 16, 7, 0.4, 0, Math.PI * 2)
            ctx.fill()
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
          ctx.fillStyle = '#2f8a28'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 2200; i++) {
            const g = 96 + Math.random() * 80
            ctx.fillStyle = `rgb(${g - 70},${g},${g - 96})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 3, 4)
          }
          for (let i = 0; i < 18; i++) {
            ctx.fillStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 24},32,0.45)`
            ctx.beginPath()
            ctx.ellipse(
              Math.random() * w,
              Math.random() * h,
              16 + Math.random() * 28,
              7 + Math.random() * 10,
              Math.random(),
              0,
              Math.PI * 2,
            )
            ctx.fill()
          }
          ctx.strokeStyle = 'rgba(92,70,38,0.35)'
          ctx.lineWidth = 7
          ctx.beginPath()
          ctx.moveTo(0, h * 0.42)
          ctx.quadraticCurveTo(w * 0.5, h * 0.55, w, h * 0.38)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(w * 0.48, 0)
          ctx.quadraticCurveTo(w * 0.4, h * 0.5, w * 0.55, h)
          ctx.stroke()
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
          ctx.fillStyle = '#6e5436'
          ctx.fillRect(0, 0, w, h)
          for (let i = 0; i < 1600; i++) {
            const v = 78 + Math.random() * 48
            ctx.fillStyle = `rgb(${v},${v - 22},${v - 40})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
          }
          for (let i = 0; i < 80; i++) {
            ctx.fillStyle = `rgba(${120 + Math.random() * 40},${100 + Math.random() * 20},70,0.35)`
            ctx.fillRect(Math.random() * w, Math.random() * h, 5, 4)
          }
          for (let i = 0; i < 40; i++) {
            ctx.fillStyle = 'rgba(40,28,16,0.35)'
            ctx.fillRect(Math.random() * w, Math.random() * h, 6, 2)
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
  ctx.fillStyle = '#1a1410'
  ctx.fillRect(0, 0, 1024, 256)
  ctx.fillStyle = ink
  ctx.font = 'bold 110px "Bebas Neue", "IBM Plex Mono", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(word, 512, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

export function makeCourtSignTexture(word: string, ink: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 768
  c.height = 192
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#241810'
  ctx.fillRect(0, 0, 768, 192)
  ctx.fillStyle = '#3a2a1c'
  ctx.fillRect(10, 10, 748, 172)
  ctx.strokeStyle = ink
  ctx.lineWidth = 8
  ctx.strokeRect(18, 18, 732, 156)
  ctx.fillStyle = '#f4ead8'
  ctx.font = 'bold 78px "Bebas Neue", "IBM Plex Mono", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(word, 384, 100)
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
