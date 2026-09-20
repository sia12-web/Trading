import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { stallState } from '../game/gameStore'
import { STORES, storeYaw } from '../game/stores'
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
  const printed = Boolean(g.lastPrint && g.lastPrint.storeId === store.id && performance.now() - g.lastPrint.at < 3600)
  const max = store.kind === 'lvn' ? 4 : store.kind === 'poc' ? 14 : 12
  const n = store.kind === 'lvn' ? (st.clogged ? max : 0) : Math.max(0, Math.round(st.occupancy * max))
  if (n <= 0) return null
  const arrive = Math.min(1, Math.max(0, (g.floorAlive - 0.04) / 0.78))
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <Person
          key={i}
          store={store}
          seed={i + store.id.length}
          slot={i}
          kind={KIND[store.kind]}
          alive={g.floorAlive}
          arrive={arrive}
          hop={printed}
          door={st.door}
          leaving={st.timeOpportunity < 0.38 && st.fairToday}
        />
      ))}
    </group>
  )
}

function Person({
  store,
  seed,
  slot,
  kind,
  alive,
  arrive,
  hop,
  door,
  leaving,
}: {
  store: StoreDef
  seed: number
  slot: number
  kind: Kind
  alive: number
  arrive: number
  hop: boolean
  door: number
  leaving: boolean
}) {
  const ref = useRef<THREE.Group>(null)
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const color = kind === 'broker' ? '#f0c040' : kind === 'welder' ? '#e07030' : '#8aa0b0'
  const yaw = storeYaw(store.range)
  const col = slot % 3
  const row = Math.floor(slot / 3)
  const doorLocal: [number, number] = [(col - 1) * 0.7, 2.75 + row * 0.72]
  const worldDoor = rotate2(doorLocal, yaw)
  const home: [number, number] = [store.position[0] + worldDoor[0], store.position[2] + worldDoor[1]]
  const gate: [number, number] = [0.12 * ((seed % 3) - 1), 0.12 * ((seed % 2) - 0.5)]

  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime * (0.35 + (seed % 4) * 0.05) + seed
    const fidget = door < 0.35 || leaving ? 0.04 : 0.12
    const destX = leaving ? THREE.MathUtils.lerp(home[0], gate[0], 0.62) : home[0] + Math.cos(t) * fidget
    const destZ = leaving ? THREE.MathUtils.lerp(home[1], gate[1], 0.62) : home[1] + Math.sin(t * 0.9) * fidget
    const x = THREE.MathUtils.lerp(gate[0], destX, arrive)
    const z = THREE.MathUtils.lerp(gate[1], destZ, arrive)
    ref.current.position.x = x
    ref.current.position.z = z
    ref.current.position.y = hop ? 0.34 + Math.abs(Math.sin(s.clock.elapsedTime * 16)) * 0.42 : 0
    ref.current.rotation.y = Math.atan2(store.position[0] - x, store.position[2] - z) || t
    ref.current.visible = alive > 0.08
    ref.current.scale.setScalar(2.15 + 0.1 * alive)
    const leg = Math.sin(t * 8) * 0.5
    if (left.current) left.current.rotation.x = leaving || arrive < 0.92 ? leg : 0.08
    if (right.current) right.current.rotation.x = leaving || arrive < 0.92 ? -leg : -0.08
  })

  return (
    <group ref={ref} position={[home[0], 0, home[1]]}>
      <mesh position={[0, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.26, 0.52, 4, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.22, 0]} castShadow>
        <sphereGeometry args={[0.22, 8, 6]} />
        <meshBasicMaterial color="#f0d0a8" />
      </mesh>
      {kind !== 'broker' && (
        <mesh position={[0, 1.34, 0]} castShadow>
          <cylinderGeometry args={[0.21, 0.23, 0.14, 8]} />
          <meshStandardMaterial color="#f0c040" emissive="#c4a046" emissiveIntensity={0.28} />
        </mesh>
      )}
      {kind === 'broker' && (
        <mesh position={[0, 0.76, 0.16]}>
          <boxGeometry args={[0.3, 0.2, 0.06]} />
          <meshStandardMaterial color="#e8dcc8" />
        </mesh>
      )}
      {kind === 'welder' && (
        <mesh position={[0.26, 0.64, 0]}>
          <boxGeometry args={[0.16, 0.22, 0.12]} />
          <meshStandardMaterial color="#4a4a48" />
        </mesh>
      )}
      {kind === 'worker' && (
        <mesh position={[-0.22, 0.62, 0.02]}>
          <boxGeometry args={[0.14, 0.18, 0.14]} />
          <meshStandardMaterial color="#6a3a28" />
        </mesh>
      )}
      <mesh ref={left} position={[-0.12, 0.26, 0]}>
        <capsuleGeometry args={[0.08, 0.26, 3, 6]} />
        <meshStandardMaterial color="#2a241c" />
      </mesh>
      <mesh ref={right} position={[0.12, 0.26, 0]}>
        <capsuleGeometry args={[0.08, 0.26, 3, 6]} />
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
