import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { enterDow, getGame } from '../game/gameStore'
import { DOW_GATE, HUB_WALK, LOCKED_MARKETS } from '../game/stores'
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
      if (dDow < 5.6) {
        enterDow()
        return
      }
      for (const m of LOCKED_MARKETS) {
        const d = Math.hypot(p.x - m.position[0], p.z - m.position[2])
        if (d < 4.4) {
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
      shadows="soft"
      dpr={[1, 1.75]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.setClearColor('#6aa8cc')
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.1
        gl.shadowMap.enabled = true
        gl.shadowMap.type = THREE.PCFSoftShadowMap
      }}
    >
      <Suspense fallback={null}>
        <IsoCamera mode="hub" />
        <HubWorld />
        <HubInteract />
        <Player spawn={[0, 0, 3.4]} collide={false} bounds={{ minX: -HUB_WALK, maxX: HUB_WALK, minZ: -HUB_WALK, maxZ: HUB_WALK }} />
        <CinematicFx />
      </Suspense>
    </Canvas>
  )
}
