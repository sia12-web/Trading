import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { useGame } from '../ui/useGame'

type Walker = {
  seed: number
  kind: 'worker' | 'broker' | 'welder'
  home: [number, number]
}

const WALKERS: Walker[] = [
  { seed: 1, kind: 'worker', home: [-1.6, 1.7] },
  { seed: 2, kind: 'worker', home: [1.7, 1.4] },
  { seed: 3, kind: 'broker', home: [0.6, -1.5] },
  { seed: 4, kind: 'welder', home: [-1.8, -1.6] },
  { seed: 5, kind: 'worker', home: [1.8, -0.4] },
  { seed: 6, kind: 'welder', home: [-0.4, 1.9] },
]

export function NPCs() {
  const g = useGame()
  if (g.floorAlive < 0.05) return null
  return (
    <group>
      {WALKERS.map((w) => (
        <Person key={w.seed} walker={w} alive={g.floorAlive} />
      ))}
    </group>
  )
}

function Person({ walker, alive }: { walker: Walker; alive: number }) {
  const ref = useRef<THREE.Group>(null)
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const color =
    walker.kind === 'broker' ? '#8a4030' : walker.kind === 'welder' ? '#6a5a28' : '#3a4a58'

  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime * (0.55 + (walker.seed % 4) * 0.08) + walker.seed
    const r = 0.85 + (walker.seed % 3) * 0.2
    ref.current.position.x = walker.home[0] + Math.cos(t) * r
    ref.current.position.z = walker.home[1] + Math.sin(t * 0.85) * r
    ref.current.rotation.y = t + Math.PI / 2
    ref.current.visible = alive > 0.2
    ref.current.scale.setScalar(0.72 + 0.12 * alive)
    const leg = Math.sin(t * 6) * 0.45
    if (left.current) left.current.rotation.x = leg
    if (right.current) right.current.rotation.x = -leg
  })

  return (
    <group ref={ref} position={[walker.home[0], 0, walker.home[1]]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.16, 0.32, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.88, 0]} castShadow>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshStandardMaterial color="#d4b090" />
      </mesh>
      {walker.kind !== 'broker' && (
        <mesh position={[0, 0.98, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.16, 0.1, 8]} />
          <meshStandardMaterial color="#c4a046" />
        </mesh>
      )}
      {walker.kind === 'broker' && (
        <mesh position={[0, 0.58, 0.12]}>
          <boxGeometry args={[0.22, 0.16, 0.04]} />
          <meshStandardMaterial color="#e8dcc8" />
        </mesh>
      )}
      {walker.kind === 'welder' && (
        <mesh position={[0.18, 0.5, 0]}>
          <boxGeometry args={[0.12, 0.18, 0.08]} />
          <meshStandardMaterial color="#4a4a48" />
        </mesh>
      )}
      {walker.kind === 'worker' && (
        <mesh position={[-0.16, 0.48, 0.02]}>
          <boxGeometry args={[0.1, 0.14, 0.1]} />
          <meshStandardMaterial color="#6a3a28" />
        </mesh>
      )}
      <mesh ref={left} position={[-0.08, 0.2, 0]}>
        <capsuleGeometry args={[0.055, 0.2, 3, 6]} />
        <meshStandardMaterial color="#2a241c" />
      </mesh>
      <mesh ref={right} position={[0.08, 0.2, 0]}>
        <capsuleGeometry args={[0.055, 0.2, 3, 6]} />
        <meshStandardMaterial color="#2a241c" />
      </mesh>
    </group>
  )
}
