import { OrthographicCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, type OrthographicCamera as OrthoCam } from 'three'
import { getGame } from '../game/gameStore'
import { OPEN_CINEMATIC_SEC } from '../game/session'

/** One packed Clash shot for preopen and live: walls + trees + cliff bezel, no dirt/sky void. */
export function IsoCamera({ mode }: { mode: 'hub' | 'dow' }) {
  const ref = useRef<OrthoCam>(null)

  useFrame(() => {
    const cam = ref.current
    if (!cam) return
    const g = getGame()
    let height = 14.25
    let zoom = 45
    const dist = mode === 'hub' ? 13.5 : 18.5
    if (mode === 'hub') {
      height = 10.9
      zoom = 50
    } else if (g.phase === 'opening') {
      const k = Math.min(1, g.openElapsed / OPEN_CINEMATIC_SEC)
      height = MathUtils.lerp(14.4, 14.25, k)
      zoom = MathUtils.lerp(44.5, 45, k)
    }
    cam.position.set(dist, height, dist)
    cam.lookAt(0, 1.05, 0)
    cam.zoom = zoom
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
  })

  return (
    <OrthographicCamera
      ref={ref}
      makeDefault
      near={0.1}
      far={160}
      zoom={45}
      position={[18.5, 14.25, 18.5]}
    />
  )
}
