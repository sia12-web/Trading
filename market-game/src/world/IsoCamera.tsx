import { OrthographicCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { OrthographicCamera as OrthoCam } from 'three'

/** One packed Clash shot for hub and mill: walls + tree belt + cliff, no sky void. */
export function IsoCamera({ mode }: { mode: 'hub' | 'dow' }) {
  const ref = useRef<OrthoCam>(null)
  void mode

  useFrame(() => {
    const cam = ref.current
    if (!cam) return
    cam.position.set(18.5, 14.25, 18.5)
    cam.lookAt(0, 1.05, 0)
    cam.zoom = 45
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
