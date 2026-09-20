import { OrthographicCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { OrthographicCamera as OrthoCam } from 'three'

/** One packed Clash shot for preopen and live: walls + trees + cliff bezel, no dirt/sky void. */
export function IsoCamera({ mode }: { mode: 'hub' | 'dow' }) {
  const ref = useRef<OrthoCam>(null)

  useFrame(() => {
    const cam = ref.current
    if (!cam) return
    const height = mode === 'hub' ? 10.9 : 14.25
    const zoom = mode === 'hub' ? 50 : 45
    const dist = mode === 'hub' ? 13.5 : 18.5
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
