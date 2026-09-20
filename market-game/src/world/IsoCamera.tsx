import { OrthographicCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { OrthographicCamera as OrthoCam } from 'three'
import { getGame } from '../game/gameStore'

/** Clash of Clans-style isometric: high 3/4 view of the whole yard. */
export function IsoCamera({ mode }: { mode: 'hub' | 'dow' }) {
  const ref = useRef<OrthoCam>(null)

  useFrame(() => {
    const cam = ref.current
    if (!cam) return
    const g = getGame()
    const opening = g.phase === 'opening'
    const dist = mode === 'hub' ? 18 : 26
    const height = mode === 'hub' ? 22 : 32
    const zoomBase = mode === 'hub' ? 44 : 34
    const zoom = opening ? 24 + g.openElapsed * 1.15 : zoomBase
    cam.position.set(dist, height, dist)
    cam.lookAt(0, 0.4, 0)
    cam.zoom = zoom
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
  })

  return (
    <OrthographicCamera
      ref={ref}
      makeDefault
      near={0.1}
      far={320}
      zoom={34}
      position={[26, 32, 26]}
    />
  )
}
