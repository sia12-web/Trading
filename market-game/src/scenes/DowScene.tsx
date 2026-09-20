import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import { tickGame } from '../game/gameStore'
import { STORES } from '../game/stores'
import { CinematicFx } from '../world/CinematicFx'
import { District } from '../world/District'
import { NPCs } from '../world/NPCs'
import { bindPlayerKeys, Player } from '../world/Player'
import { StoreBuilding } from '../world/StoreBuilding'

export function DowScene() {
  useEffect(() => bindPlayerKeys(), [])
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      tickGame(Math.min(0.05, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [8, 5, 22], fov: 48, near: 0.1, far: 220 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor('#241c16')
        gl.toneMappingExposure = 1.35
      }}
    >
      <Suspense fallback={null}>
        <District />
        {STORES.map((s) => (
          <StoreBuilding key={s.id} store={s} />
        ))}
        <NPCs />
        <Player spawn={[0, 0, 14]} camDist={7.8} />
        <CinematicFx />
      </Suspense>
    </Canvas>
  )
}
