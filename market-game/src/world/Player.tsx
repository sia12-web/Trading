import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
  clearWalkTarget,
  closeInspect,
  getGame,
  getWalkTarget,
  skipToOpen,
  backToHub,
  setPlayer,
  takeAuction,
  toggleInspect,
} from '../game/gameStore'
import { COLLISIONS, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'

const SPEED = 4.6
const SPRINT = 7.8

const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  shift: false,
}

function blocked(x: number, z: number, enabled: boolean): boolean {
  if (!enabled) return false
  for (const c of COLLISIONS) {
    if (Math.abs(x - c.x) < c.w / 2 + 0.28 && Math.abs(z - c.z) < c.d / 2 + 0.28) return true
  }
  if (Math.abs(x) > YARD - 0.7 || Math.abs(z) > YARD - 0.7) return true
  return false
}

export function bindPlayerKeys() {
  const down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (k === 'w') keys.w = true
    if (k === 'a') keys.a = true
    if (k === 's') keys.s = true
    if (k === 'd') keys.d = true
    if (e.key === 'Shift') keys.shift = true
    if (k === 'e') toggleInspect()
    if (k === 'escape') closeInspect()
    if (k === 'b' || k === '1') takeAuction('buy')
    if (k === 'f' || k === '2') takeAuction('sell')
    if (k === 'o' && getGame().scene === 'dow') skipToOpen()
    if (k === 'h' && getGame().scene === 'dow') backToHub()
  }
  const up = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (k === 'w') keys.w = false
    if (k === 'a') keys.a = false
    if (k === 's') keys.s = false
    if (k === 'd') keys.d = false
    if (e.key === 'Shift') keys.shift = false
  }
  window.addEventListener('keydown', down, true)
  window.addEventListener('keyup', up)
  return () => {
    window.removeEventListener('keydown', down, true)
    window.removeEventListener('keyup', up)
    keys.w = keys.a = keys.s = keys.d = keys.shift = false
  }
}

/** Price as a Clash-style troop: chunky silhouette, ground ring, no ticker hat. */
export function Player({
  spawn,
  collide = true,
  bounds,
}: {
  spawn: [number, number, number]
  collide?: boolean
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
}) {
  const g = useGame()
  const { camera } = useThree()
  const group = useRef<THREE.Group>(null)
  const yaw = useRef(0)
  const pos = useRef(new THREE.Vector3(...spawn))
  const bob = useRef(0)
  const vel = useRef(0)
  const fwd = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())

  useEffect(() => {
    pos.current.set(spawn[0], spawn[1], spawn[2])
  }, [spawn[0], spawn[1], spawn[2]])

  useFrame((_, dt) => {
    const snap = getGame()
    const frozen = snap.phase === 'opening'
    fwd.current.set(0, 0, -1).applyQuaternion(camera.quaternion)
    fwd.current.y = 0
    if (fwd.current.lengthSq() < 0.0001) fwd.current.set(-1, 0, -1)
    fwd.current.normalize()
    right.current.set(1, 0, 0).applyQuaternion(camera.quaternion)
    right.current.y = 0
    right.current.normalize()

    let mx = 0
    let mz = 0
    if (!frozen) {
      if (keys.w) {
        mx += fwd.current.x
        mz += fwd.current.z
      }
      if (keys.s) {
        mx -= fwd.current.x
        mz -= fwd.current.z
      }
      if (keys.d) {
        mx += right.current.x
        mz += right.current.z
      }
      if (keys.a) {
        mx -= right.current.x
        mz -= right.current.z
      }
      const target = getWalkTarget()
      if (target && mx === 0 && mz === 0) {
        const tx = target.x - pos.current.x
        const tz = target.z - pos.current.z
        const dist = Math.hypot(tx, tz)
        if (dist < 0.28) clearWalkTarget()
        else {
          mx = tx / dist
          mz = tz / dist
        }
      } else if (mx !== 0 || mz !== 0) {
        clearWalkTarget()
      }
    }

    const moving = mx !== 0 || mz !== 0
    const speed = keys.shift ? SPRINT : SPEED
    if (moving) {
      const len = Math.hypot(mx, mz) || 1
      mx /= len
      mz /= len
      const step = speed * dt
      const nx = THREE.MathUtils.clamp(pos.current.x + mx * step, bounds?.minX ?? -YARD, bounds?.maxX ?? YARD)
      const nz = THREE.MathUtils.clamp(pos.current.z + mz * step, bounds?.minZ ?? -YARD, bounds?.maxZ ?? YARD)
      const trapped = blocked(pos.current.x, pos.current.z, collide)
      if (trapped || !blocked(nx, pos.current.z, collide)) pos.current.x = nx
      if (trapped || !blocked(pos.current.x, nz, collide)) pos.current.z = nz
      yaw.current = Math.atan2(mx, mz)
      vel.current = THREE.MathUtils.lerp(vel.current, 1, 0.18)
    } else {
      vel.current = THREE.MathUtils.lerp(vel.current, 0, 0.14)
    }
    bob.current += dt * (5 + vel.current * 8)

    if (group.current) {
      group.current.position.set(pos.current.x, 0, pos.current.z)
      group.current.rotation.y = yaw.current
    }
    setPlayer({ x: pos.current.x, y: 0, z: pos.current.z, yaw: yaw.current })
  })

  const selected = Boolean(g.nearby || g.inspecting)

  return (
    <group ref={group} position={spawn}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.48, 0.68, 24]} />
        <meshBasicMaterial color={selected ? '#e8c04a' : '#f4efe6'} transparent opacity={0.95} />
      </mesh>
      <PriceBody vel={vel} bob={bob} />
    </group>
  )
}

function PriceBody({
  vel,
  bob,
}: {
  vel: { current: number }
  bob: { current: number }
}) {
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const larm = useRef<THREE.Mesh>(null)
  const rarm = useRef<THREE.Mesh>(null)

  useFrame(() => {
    const walk = vel.current
    const b = bob.current
    const leg = Math.sin(b) * 0.55 * walk
    if (left.current) left.current.rotation.x = leg
    if (right.current) right.current.rotation.x = -leg
    if (larm.current) larm.current.rotation.x = -leg * 0.7
    if (rarm.current) rarm.current.rotation.x = leg * 0.7
  })

  return (
    <group scale={1.35}>
      <mesh position={[0, 0.72, 0]} scale={1.12}>
        <capsuleGeometry args={[0.28, 0.42, 4, 8]} />
        <meshBasicMaterial color="#1a140e" />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.26, 0.4, 5, 10]} />
        <meshStandardMaterial color="#c45c2a" roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <sphereGeometry args={[0.2, 12, 10]} />
        <meshStandardMaterial color="#e6c8a8" roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.32, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.24, 0.14, 10]} />
        <meshStandardMaterial color="#d4a046" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.78, 0.16]}>
        <boxGeometry args={[0.38, 0.22, 0.06]} />
        <meshStandardMaterial color="#2a2218" />
      </mesh>
      <mesh ref={larm} position={[-0.32, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.08, 0.32, 3, 6]} />
        <meshStandardMaterial color="#a04a28" />
      </mesh>
      <mesh ref={rarm} position={[0.32, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.08, 0.32, 3, 6]} />
        <meshStandardMaterial color="#a04a28" />
      </mesh>
      <mesh ref={left} position={[-0.12, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.32, 3, 6]} />
        <meshStandardMaterial color="#2a241c" />
      </mesh>
      <mesh ref={right} position={[0.12, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.32, 3, 6]} />
        <meshStandardMaterial color="#2a241c" />
      </mesh>
    </group>
  )
}
