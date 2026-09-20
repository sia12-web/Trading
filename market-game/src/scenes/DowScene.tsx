import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { tickGame } from '../game/gameStore'
import { STORES } from '../game/stores'
import { CinematicFx } from '../world/CinematicFx'
import { District } from '../world/District'
import { IsoCamera } from '../world/IsoCamera'
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
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor('#7eb8dc')
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.36
      }}
    >
      <Suspense fallback={null}>
        <IsoCamera mode="dow" />
        <District />
        {STORES.map((s) => (
          <StoreBuilding key={s.id} store={s} />
        ))}
        <NPCs />
        <Player spawn={[3.35, 0, 9.35]} />
        <CinematicFx />
      </Suspense>
    </Canvas>
  )
}
