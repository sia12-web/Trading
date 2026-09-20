import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { enterDow, getGame } from '../game/gameStore'
import { DOW_GATE, LOCKED_MARKETS } from '../game/stores'
import { CinematicFx } from '../world/CinematicFx'
import { HubWorld } from '../world/HubWorld'
import { IsoCamera } from '../world/IsoCamera'
import { bindPlayerKeys, Player } from '../world/Player'

function HubInteract() {
  useEffect(() => bindPlayerKeys(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e') return
      const p = getGame().player
      const dDow = Math.hypot(p.x - DOW_GATE[0], p.z - DOW_GATE[2])
      if (dDow < 3.6) {
        enterDow()
        return
      }
      for (const m of LOCKED_MARKETS) {
        const d = Math.hypot(p.x - m.position[0], p.z - m.position[2])
        if (d < 2.6) {
          const el = document.getElementById('locked-msg')
          if (el) {
            el.textContent = `${m.name} stays locked until the DOW loop feels like live auction trading.`
            el.style.opacity = '1'
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}

export function HubScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.setClearColor('#6eb4e8')
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.34
      }}
    >
      <Suspense fallback={null}>
        <IsoCamera mode="hub" />
        <HubWorld />
        <HubInteract />
        <Player spawn={[0, 0, 1.1]} collide={false} bounds={{ minX: -7.2, maxX: 7.2, minZ: -7.2, maxZ: 7.2 }} />
        <CinematicFx />
      </Suspense>
    </Canvas>
  )
}
