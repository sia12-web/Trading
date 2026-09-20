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

/** Price as the selected Clash troop: cream outline, lime halo, crimson — not crate orange. */
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
  const ring = useRef<THREE.Mesh>(null)

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
    bob.current += dt * (6.5 + vel.current * 10)

    if (group.current) {
      group.current.position.set(pos.current.x, 0, pos.current.z)
      group.current.rotation.y = yaw.current
    }
    if (ring.current) {
      const pulse = 1 + Math.sin(bob.current * 1.4) * 0.04
      ring.current.scale.set(pulse, pulse, 1)
    }
    setPlayer({ x: pos.current.x, y: 0, z: pos.current.z, yaw: yaw.current })
  })

  const selected = Boolean(g.nearby || g.inspecting)

  return (
    <group ref={group} position={spawn}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <circleGeometry args={[0.62, 24]} />
        <meshBasicMaterial color="#0a1808" transparent opacity={0.42} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.58, 0.84, 36]} />
        <meshBasicMaterial color={selected ? '#e8ff6a' : '#9dff3a'} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]}>
        <ringGeometry args={[0.84, 0.96, 36]} />
        <meshBasicMaterial color="#fff8dc" toneMapped={false} />
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
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const larm = useRef<THREE.Group>(null)
  const rarm = useRef<THREE.Group>(null)

  useFrame(() => {
    const walk = vel.current
    const b = bob.current
    const leg = Math.sin(b) * 1.45 * walk
    if (left.current) left.current.rotation.x = leg
    if (right.current) right.current.rotation.x = -leg
    if (larm.current) larm.current.rotation.x = -leg * 1.05
    if (rarm.current) rarm.current.rotation.x = leg * 1.05
  })

  const outline = '#fff6d8'
  const tunic = '#b41820'
  const leather = '#5c3220'
  const skin = '#e8b898'
  const brass = '#c4a05a'
  const pants = '#1e1a16'

  return (
    <group scale={1.62}>
      <mesh position={[0, 0.62, 0]} scale={1.2}>
        <boxGeometry args={[0.48, 0.54, 0.3]} />
        <meshBasicMaterial color={outline} side={THREE.BackSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.48, 0.54, 0.3]} />
        <meshBasicMaterial color={tunic} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.38, 0.02]}>
        <boxGeometry args={[0.5, 0.12, 0.2]} />
        <meshBasicMaterial color="#2a1c12" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.98, 0]} scale={1.22}>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshBasicMaterial color={outline} side={THREE.BackSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.98, 0]} castShadow>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshBasicMaterial color={skin} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.16, 0]} scale={1.2}>
        <cylinderGeometry args={[0.2, 0.24, 0.18, 10]} />
        <meshBasicMaterial color={outline} side={THREE.BackSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.16, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.24, 0.18, 10]} />
        <meshBasicMaterial color={brass} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.26, 0.06]}>
        <boxGeometry args={[0.1, 0.14, 0.2]} />
        <meshBasicMaterial color="#8a6a38" toneMapped={false} />
      </mesh>
      <group ref={larm} position={[-0.42, 0.74, 0]}>
        <mesh position={[0, -0.28, 0]} scale={1.26}>
          <capsuleGeometry args={[0.14, 0.42, 3, 6]} />
          <meshBasicMaterial color={outline} side={THREE.BackSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.28, 0]} castShadow>
          <capsuleGeometry args={[0.14, 0.42, 3, 6]} />
          <meshBasicMaterial color={leather} toneMapped={false} />
        </mesh>
      </group>
      <group ref={rarm} position={[0.42, 0.74, 0]}>
        <mesh position={[0, -0.28, 0]} scale={1.26}>
          <capsuleGeometry args={[0.14, 0.42, 3, 6]} />
          <meshBasicMaterial color={outline} side={THREE.BackSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.28, 0]} castShadow>
          <capsuleGeometry args={[0.14, 0.42, 3, 6]} />
          <meshBasicMaterial color={leather} toneMapped={false} />
        </mesh>
        <mesh position={[0.18, -0.5, 0.06]} rotation={[0, 0, -0.4]} castShadow>
          <boxGeometry args={[0.12, 0.58, 0.12]} />
          <meshBasicMaterial color="#6a7280" toneMapped={false} />
        </mesh>
        <mesh position={[0.32, -0.76, 0.06]} rotation={[0, 0, -0.1]} castShadow>
          <boxGeometry args={[0.24, 0.24, 0.08]} />
          <meshBasicMaterial color="#8a9098" toneMapped={false} />
        </mesh>
      </group>
      <group ref={left} position={[-0.2, 0.42, 0]}>
        <mesh position={[0, -0.28, 0]} scale={1.26}>
          <capsuleGeometry args={[0.15, 0.4, 3, 6]} />
          <meshBasicMaterial color={outline} side={THREE.BackSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.28, 0]} castShadow>
          <capsuleGeometry args={[0.15, 0.4, 3, 6]} />
          <meshBasicMaterial color={pants} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.52, 0.12]} castShadow>
          <boxGeometry args={[0.24, 0.12, 0.34]} />
          <meshBasicMaterial color="#fff6d8" toneMapped={false} />
        </mesh>
      </group>
      <group ref={right} position={[0.2, 0.42, 0]}>
        <mesh position={[0, -0.28, 0]} scale={1.26}>
          <capsuleGeometry args={[0.15, 0.4, 3, 6]} />
          <meshBasicMaterial color={outline} side={THREE.BackSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.28, 0]} castShadow>
          <capsuleGeometry args={[0.15, 0.4, 3, 6]} />
          <meshBasicMaterial color={pants} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.52, 0.12]} castShadow>
          <boxGeometry args={[0.24, 0.12, 0.34]} />
          <meshBasicMaterial color="#fff6d8" toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}
