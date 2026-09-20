import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { stallState } from '../game/gameStore'
import { STORES } from '../game/stores'
import type { StoreDef } from '../game/types'
import { useGame } from '../ui/useGame'

type Kind = 'worker' | 'broker' | 'welder'

const KIND: Record<StoreDef['kind'], Kind> = {
  hvn: 'welder',
  poc: 'broker',
  lvn: 'worker',
  avwap: 'broker',
}

export function NPCs() {
  const g = useGame()
  if (g.floorAlive < 0.04) return null
  return (
    <group>
      {STORES.map((store) => (
        <StallCrowd key={store.id} store={store} />
      ))}
    </group>
  )
}

function StallCrowd({ store }: { store: StoreDef }) {
  const g = useGame()
  const st = stallState(store.id, g)
  const printed = Boolean(g.lastPrint && g.lastPrint.storeId === store.id && performance.now() - g.lastPrint.at < 1200)
  const max = store.kind === 'lvn' ? 5 : store.kind === 'poc' ? 7 : 5
  const n = store.kind === 'lvn' ? (st.clogged ? max : 0) : Math.round(st.occupancy * max)
  if (n <= 0) return null
  const arrive = Math.min(1, Math.max(0, (g.floorAlive - 0.08) / 0.7))
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <Person
          key={i}
          store={store}
          seed={i + store.id.length}
          kind={KIND[store.kind]}
          alive={g.floorAlive}
          arrive={arrive}
          hop={printed}
          door={st.door}
        />
      ))}
    </group>
  )
}

function Person({
  store,
  seed,
  kind,
  alive,
  arrive,
  hop,
  door,
}: {
  store: StoreDef
  seed: number
  kind: Kind
  alive: number
  arrive: number
  hop: boolean
  door: number
}) {
  const ref = useRef<THREE.Group>(null)
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const color = kind === 'broker' ? '#e07038' : kind === 'welder' ? '#3a7aa0' : '#c4a046'
  const yaw = store.range === 'fiveMonth' ? -Math.PI / 2 : 0
  const doorLocal: [number, number] = [((seed % 5) - 2) * 0.38, 2.15]
  const worldDoor = rotate2(doorLocal, yaw)
  const home: [number, number] = [store.position[0] + worldDoor[0], store.position[2] + worldDoor[1]]
  const gate: [number, number] = [0.2 * ((seed % 3) - 1), 0.2 * ((seed % 2) - 0.5)]

  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime * (0.4 + (seed % 4) * 0.06) + seed
    const wait = door < 0.35 ? 0.15 : 0.55
    const ox = Math.cos(t) * wait
    const oz = Math.sin(t * 0.9) * wait * 0.7
    const x = THREE.MathUtils.lerp(gate[0], home[0] + ox, arrive)
    const z = THREE.MathUtils.lerp(gate[1], home[1] + oz, arrive)
    ref.current.position.x = x
    ref.current.position.z = z
    ref.current.position.y = hop ? 0.18 + Math.abs(Math.sin(s.clock.elapsedTime * 14)) * 0.22 : 0
    ref.current.rotation.y = Math.atan2(home[0] - x, home[1] - z) || t
    ref.current.visible = alive > 0.12
    ref.current.scale.setScalar(0.92 + 0.12 * alive)
    const leg = Math.sin(t * 7) * 0.45
    if (left.current) left.current.rotation.x = leg
    if (right.current) right.current.rotation.x = -leg
  })

  return (
    <group ref={ref} position={[home[0], 0, home[1]]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.16, 0.32, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.55} emissive={color} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 0.88, 0]} castShadow>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshStandardMaterial color="#f0d0a8" emissive="#d4b090" emissiveIntensity={0.12} />
      </mesh>
      {kind !== 'broker' && (
        <mesh position={[0, 0.98, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.16, 0.1, 8]} />
          <meshStandardMaterial color="#f0c040" emissive="#c4a046" emissiveIntensity={0.2} />
        </mesh>
      )}
      {kind === 'broker' && (
        <mesh position={[0, 0.58, 0.12]}>
          <boxGeometry args={[0.22, 0.16, 0.04]} />
          <meshStandardMaterial color="#e8dcc8" />
        </mesh>
      )}
      {kind === 'welder' && (
        <mesh position={[0.18, 0.5, 0]}>
          <boxGeometry args={[0.12, 0.18, 0.08]} />
          <meshStandardMaterial color="#4a4a48" />
        </mesh>
      )}
      {kind === 'worker' && (
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

function rotate2(p: [number, number], yaw: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}
