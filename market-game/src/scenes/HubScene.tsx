import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import { enterDow, getGame } from '../game/gameStore'
import { DOW_GATE, LOCKED_MARKETS } from '../game/stores'
import { bindPlayerKeys, Player } from '../world/Player'
import { HubWorld } from '../world/HubWorld'
import { CinematicFx } from '../world/CinematicFx'

function HubInteract() {
  useEffect(() => bindPlayerKeys(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e') return
      const p = getGame().player
      const dDow = Math.hypot(p.x - DOW_GATE[0], p.z - DOW_GATE[2])
      if (dDow < 7) {
        enterDow()
        return
      }
      for (const m of LOCKED_MARKETS) {
        const d = Math.hypot(p.x - m.position[0], p.z - m.position[2])
        if (d < 6.5) {
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
      camera={{ position: [0, 6, 18], fov: 50, near: 0.1, far: 180 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.setClearColor('#08090e')
        gl.toneMappingExposure = 1.05
      }}
    >
      <Suspense fallback={null}>
        <HubWorld />
        <HubInteract />
        <Player
          spawn={[0, 0, 6]}
          camDist={8.2}
          collide={false}
          bounds={{ minX: -28, maxX: 28, minZ: -28, maxZ: 28 }}
        />
        <CinematicFx />
      </Suspense>
    </Canvas>
  )
}
