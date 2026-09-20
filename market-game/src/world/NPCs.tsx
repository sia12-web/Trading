import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { STORES } from '../game/stores'
import { useGame } from '../ui/useGame'

type Walker = {
  seed: number
  kind: 'worker' | 'broker' | 'welder'
  home: [number, number]
}

const WALKERS: Walker[] = [
  { seed: 1, kind: 'worker', home: [-10, 10] },
  { seed: 2, kind: 'worker', home: [12, 8] },
  { seed: 3, kind: 'broker', home: [2, -6] },
  { seed: 4, kind: 'broker', home: [-4, 4] },
  { seed: 5, kind: 'welder', home: [-22, 26] },
  { seed: 6, kind: 'worker', home: [20, 24] },
  { seed: 7, kind: 'worker', home: [-24, -30] },
  { seed: 8, kind: 'welder', home: [0, -32] },
  { seed: 9, kind: 'broker', home: [8, 2] },
  { seed: 10, kind: 'worker', home: [-40, 6] },
  { seed: 11, kind: 'worker', home: [28, -10] },
  { seed: 12, kind: 'welder', home: [22, -34] },
]

export function NPCs() {
  const g = useGame()
  if (g.floorAlive < 0.05) return null
  return (
    <group>
      {WALKERS.map((w) => (
        <Person key={w.seed} walker={w} alive={g.floorAlive} />
      ))}
      {STORES.map((s) => (
        <group key={s.id} position={[s.position[0] + 3.2, 0, s.position[2] + 4.4]}>
          <Person
            walker={{ seed: s.id.length + 20, kind: s.kind === 'poc' ? 'broker' : 'worker', home: [0, 0] }}
            alive={g.floorAlive}
            idle
          />
        </group>
      ))}
    </group>
  )
}

function Person({
  walker,
  alive,
  idle,
}: {
  walker: Walker
  alive: number
  idle?: boolean
}) {
  const ref = useRef<THREE.Group>(null)
  const color =
    walker.kind === 'broker' ? '#c45c2a' : walker.kind === 'welder' ? '#d4a046' : '#3d6a8a'

  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime * (0.35 + (walker.seed % 5) * 0.05) + walker.seed
    if (idle) {
      ref.current.position.y = 0
      ref.current.rotation.y = Math.sin(t) * 0.4
    } else {
      const r = 6 + (walker.seed % 4)
      ref.current.position.x = walker.home[0] + Math.cos(t) * r
      ref.current.position.z = walker.home[1] + Math.sin(t * 0.8) * r
      ref.current.rotation.y = t + Math.PI / 2
    }
    ref.current.visible = alive > 0.2
    ref.current.scale.setScalar(0.7 + 0.3 * alive)
  })

  const hat = walker.kind !== 'broker'
  const dummy = useMemo(() => walker.seed, [walker.seed])
  void dummy

  return (
    <group ref={ref} position={[walker.home[0], 0, walker.home[1]]}>
      <mesh position={[0, 1.05, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.7, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.72, 0]} castShadow>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color="#e6c8a8" />
      </mesh>
      {hat && (
        <mesh position={[0, 1.9, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.22, 0.16, 10]} />
          <meshStandardMaterial color="#d4a046" />
        </mesh>
      )}
      {walker.kind === 'broker' && (
        <mesh position={[0, 1.15, 0.16]}>
          <boxGeometry args={[0.42, 0.35, 0.08]} />
          <meshStandardMaterial color="#f4efe6" />
        </mesh>
      )}
    </group>
  )
}
