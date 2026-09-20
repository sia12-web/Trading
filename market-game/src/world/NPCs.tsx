import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { PRINT_HOLD_MS } from '../game/auction'
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
  if (g.phase === 'preopen') return null
  return (
    <group>
      {g.phase === 'opening' && <ShiftColumn alive={g.floorAlive} />}
      {STORES.map((store) => (
        <StallCrowd key={store.id} store={store} />
      ))}
    </group>
  )
}

function StallCrowd({ store }: { store: StoreDef }) {
  const g = useGame()
  const st = stallState(store.id, g)
  const printed = Boolean(g.lastPrint && g.lastPrint.storeId === store.id && performance.now() - g.lastPrint.at < PRINT_HOLD_MS)
  const fade = printed && g.lastPrint?.side === 'sell'
  const take = printed && g.lastPrint?.side === 'buy'
  const max = store.kind === 'lvn' ? 6 : store.kind === 'poc' ? 22 : store.kind === 'avwap' ? 16 : 18
  const n = fade
    ? 0
    : store.kind === 'lvn'
      ? st.clogged
        ? max
        : take
          ? 8
          : 0
      : Math.max(0, Math.round(st.occupancy * max) + (take ? 10 : 0))
  if (n <= 0) return null
  const arrive = Math.min(1, Math.max(0, g.floorAlive / 0.92))
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
          hop={take}
          door={st.door}
          leaving={fade || (st.timeOpportunity < 0.38 && st.fairToday)}
        />
      ))}
    </group>
  )
}

function ShiftColumn({ alive }: { alive: number }) {
  return (
    <group>
      {Array.from({ length: 34 }, (_, i) => (
        <ShiftWalker key={i} seed={i} alive={alive} />
      ))}
    </group>
  )
}

function ShiftWalker({ seed, alive }: { seed: number; alive: number }) {
  const ref = useRef<THREE.Group>(null)
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const dests: Array<[number, number]> = [
    [-4.15, 5.4],
    [0, 5.6],
    [6.9, 5.3],
    [6.4, -1.6],
    [-8.7, 4.1],
    [-8.8, -1.3],
    [-8.7, -6.4],
    [6.6, 3.1],
    [6.5, -7.0],
    [3.2, 4.8],
  ]
  const dest = dests[seed % dests.length]!
  const gate: [number, number] = [(seed % 5) * 0.7 - 1.4, 14.35]

  useFrame((s) => {
    if (!ref.current) return
    const t = Math.min(1, Math.max(0, (alive - seed * 0.04) / 0.72))
    const x = THREE.MathUtils.lerp(gate[0], dest[0], t)
    const z = THREE.MathUtils.lerp(gate[1], dest[1], t)
    ref.current.position.set(x, 0, z)
    ref.current.rotation.y = Math.atan2(dest[0] - gate[0], dest[1] - gate[1])
    ref.current.visible = alive > 0.02 && t < 0.98
    const leg = Math.sin(s.clock.elapsedTime * 10 + seed) * 0.55
    if (left.current) left.current.rotation.x = leg
    if (right.current) right.current.rotation.x = -leg
  })

  const color = seed % 3 === 0 ? '#c4a046' : seed % 3 === 1 ? '#5a7a50' : '#8aa0b0'
  return (
    <group ref={ref} position={[gate[0], 0, gate[1]]} scale={0.82}>
      <TroopBody color={color} left={left} right={right} />
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
  const color = kind === 'broker' ? '#c4a046' : kind === 'welder' ? '#3a6a88' : '#5a7a50'
  const yaw = storeYaw(store.range)
  const col = slot % 4
  const row = Math.floor(slot / 4)
  const doorLocal: [number, number] = [(col - 1.5) * 0.62, 2.65 + row * 0.62]
  const worldDoor = rotate2(doorLocal, yaw)
  const home: [number, number] = [store.position[0] + worldDoor[0], store.position[2] + worldDoor[1]]
  const gate: [number, number] = [(seed % 5) * 0.65 - 1.3, 14.35]

  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime * (0.35 + (seed % 4) * 0.05) + seed
    const fidget = door < 0.35 || leaving ? 0.04 : 0.14
    const destX = leaving ? THREE.MathUtils.lerp(home[0], 0.2, 0.45) : home[0] + Math.cos(t) * fidget
    const destZ = leaving ? THREE.MathUtils.lerp(home[1], 2.4, 0.45) : home[1] + Math.sin(t * 0.9) * fidget
    const x = THREE.MathUtils.lerp(gate[0], destX, arrive)
    const z = THREE.MathUtils.lerp(gate[1], destZ, arrive)
    ref.current.position.x = x
    ref.current.position.z = z
    ref.current.position.y = hop ? 0.38 + Math.abs(Math.sin(s.clock.elapsedTime * 14)) * 0.5 : 0
    ref.current.rotation.y = Math.atan2(store.position[0] - x, store.position[2] - z) || t
    ref.current.visible = alive > 0.04
    ref.current.scale.setScalar(1.02 + 0.06 * alive)
    const leg = Math.sin(t * 8) * 0.5
    if (left.current) left.current.rotation.x = leaving || arrive < 0.92 ? leg : 0.08
    if (right.current) right.current.rotation.x = leaving || arrive < 0.92 ? -leg : -0.08
  })

  return (
    <group ref={ref} position={[home[0], 0, home[1]]} scale={0.7}>
      <TroopBody color={color} left={left} right={right} hardhat={kind !== 'broker'} kit={kind} />
    </group>
  )
}

function TroopBody({
  color,
  left,
  right,
  hardhat = true,
  kit,
}: {
  color: string
  left: { current: THREE.Mesh | null }
  right: { current: THREE.Mesh | null }
  hardhat?: boolean
  kit?: Kind
}) {
  return (
    <>
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.36, 0.46, 0.22]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.98, 0]} castShadow>
        <sphereGeometry args={[0.16, 8, 6]} />
        <meshBasicMaterial color="#f0d0a8" />
      </mesh>
      {hardhat && (
        <mesh position={[0, 1.1, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.19, 0.12, 8]} />
          <meshStandardMaterial color="#c4a05a" roughness={0.55} />
        </mesh>
      )}
      {kit === 'broker' && (
        <mesh position={[0, 0.64, 0.12]}>
          <boxGeometry args={[0.22, 0.16, 0.05]} />
          <meshStandardMaterial color="#e8dcc8" />
        </mesh>
      )}
      {kit === 'welder' && (
        <mesh position={[0.22, 0.58, 0]}>
          <boxGeometry args={[0.14, 0.18, 0.1]} />
          <meshStandardMaterial color="#4a4a48" />
        </mesh>
      )}
      {kit === 'worker' && (
        <mesh position={[-0.2, 0.56, 0.02]}>
          <boxGeometry args={[0.12, 0.16, 0.12]} />
          <meshStandardMaterial color="#6a3a28" />
        </mesh>
      )}
      <mesh position={[-0.24, 0.62, 0]} rotation={[0, 0, 0.4]} castShadow>
        <capsuleGeometry args={[0.055, 0.26, 3, 6]} />
        <meshBasicMaterial color="#5c3220" />
      </mesh>
      <mesh position={[0.24, 0.62, 0]} rotation={[0, 0, -0.4]} castShadow>
        <capsuleGeometry args={[0.055, 0.26, 3, 6]} />
        <meshBasicMaterial color="#5c3220" />
      </mesh>
      <mesh ref={left} position={[-0.11, 0.26, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.26, 3, 6]} />
        <meshStandardMaterial color="#2a241c" />
      </mesh>
      <mesh ref={right} position={[0.11, 0.26, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.26, 3, 6]} />
        <meshStandardMaterial color="#2a241c" />
      </mesh>
    </>
  )
}

function rotate2(p: [number, number], yaw: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]
}
