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
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      tickGame(Math.min(0.28, (now - last) / 1000))
      last = now
    }, 50)
    return () => window.clearInterval(id)
  }, [])

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor('#8eccf0')
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.1
        gl.shadowMap.enabled = true
        gl.shadowMap.type = THREE.PCFSoftShadowMap
      }}
    >
      <Suspense fallback={null}>
        <IsoCamera mode="dow" />
        <District />
        {STORES.map((s) => (
          <StoreBuilding key={s.id} store={s} />
        ))}
        <NPCs />
        <Player spawn={[-1.65, 0, 11.55]} />
        <CinematicFx />
      </Suspense>
    </Canvas>
  )
}
