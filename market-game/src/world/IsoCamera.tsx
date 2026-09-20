import { OrthographicCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, type OrthographicCamera as OrthoCam } from 'three'
import { getGame } from '../game/gameStore'
import { OPEN_CINEMATIC_SEC } from '../game/session'

/** Clash 3/4 ortho. Open is a real settle: dawn wide → packed village. */
export function IsoCamera({ mode }: { mode: 'hub' | 'dow' }) {
  const ref = useRef<OrthoCam>(null)

  useFrame(() => {
    const cam = ref.current
    if (!cam) return
    const g = getGame()
    let height = 12.6
    let zoom = 58
    const dist = mode === 'hub' ? 13.5 : 16.4
    if (mode === 'hub') {
      height = 11.2
      zoom = 52
    } else if (g.phase === 'preopen') {
      height = 16.4
      zoom = 44
    } else if (g.phase === 'opening') {
      const k = Math.min(1, g.openElapsed / OPEN_CINEMATIC_SEC)
      height = MathUtils.lerp(16.4, 12.6, k)
      zoom = MathUtils.lerp(44, 58, k)
    }
    cam.position.set(dist, height, dist)
    cam.lookAt(0, 1.15, 0)
    cam.zoom = zoom
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
  })

  return (
    <OrthographicCamera
      ref={ref}
      makeDefault
      near={0.1}
      far={120}
      zoom={58}
      position={[16.4, 12.6, 16.4]}
    />
  )
}
