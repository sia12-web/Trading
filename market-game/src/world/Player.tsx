import { Billboard } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fmtPx } from '../game/auction'
import {
  clearWalkTarget,
  closeInspect,
  getGame,
  getWalkTarget,
  skipToLive,
  backToHub,
  setPlayer,
  takeAuction,
  toggleInspect,
} from '../game/gameStore'
import { COLLISIONS, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'

const SPEED = 6.2
const SPRINT = 10.5

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
    if (Math.abs(x - c.x) < c.w / 2 + 0.45 && Math.abs(z - c.z) < c.d / 2 + 0.45) return true
  }
  if (Math.abs(x) > YARD - 0.8 || Math.abs(z) > YARD - 0.8) return true
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
    if (k === 'o' && getGame().scene === 'dow') skipToLive()
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
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    keys.w = keys.a = keys.s = keys.d = keys.shift = false
  }
}

/** Price as a Clash-style unit on the floor. Camera is owned by IsoCamera. */
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
        if (dist < 0.35) clearWalkTarget()
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
      if (!blocked(nx, pos.current.z, collide)) pos.current.x = nx
      if (!blocked(pos.current.x, nz, collide)) pos.current.z = nz
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

  const ticker = fmtPx(g.livePrice)
  const selected = Boolean(g.nearby || g.inspecting)

  return (
    <group ref={group} position={spawn} scale={0.72}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.55, 0.72, 28]} />
        <meshBasicMaterial color={selected ? '#d4a046' : '#f4efe6'} transparent opacity={0.9} />
      </mesh>
      <PriceBody vel={vel} bob={bob} label={ticker} />
    </group>
  )
}

function PriceBody({
  vel,
  bob,
  label,
}: {
  vel: { current: number }
  bob: { current: number }
  label: string
}) {
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const canvas = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 160
    return c
  }, [])
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [canvas])

  useFrame(() => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#07090d'
    ctx.fillRect(0, 0, 512, 160)
    ctx.strokeStyle = '#d4a046'
    ctx.lineWidth = 10
    ctx.strokeRect(10, 10, 492, 140)
    ctx.fillStyle = '#f4efe6'
    ctx.font = 'bold 72px IBM Plex Mono, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(label, 256, 88)
    ctx.fillStyle = '#d4a046'
    ctx.font = '28px IBM Plex Mono, monospace'
    ctx.fillText('PRICE', 256, 128)
    tex.needsUpdate = true
    const walk = vel.current
    const b = bob.current
    const leg = Math.sin(b) * 0.45 * walk
    if (left.current) left.current.rotation.x = leg
    if (right.current) right.current.rotation.x = -leg
  })

  return (
    <group>
      <mesh position={[0, 1.05, 0]} castShadow>
        <capsuleGeometry args={[0.32, 0.7, 6, 12]} />
        <meshPhysicalMaterial
          color="#c4a574"
          metalness={0.92}
          roughness={0.18}
          emissive="#3a2a12"
          emissiveIntensity={0.45}
          clearcoat={0.6}
        />
      </mesh>
      <mesh position={[0, 1.85, 0]} castShadow>
        <sphereGeometry args={[0.26, 16, 12]} />
        <meshPhysicalMaterial color="#efe6d6" metalness={0.7} roughness={0.22} emissive="#d4a046" emissiveIntensity={0.55} />
      </mesh>
      <mesh ref={left} position={[-0.16, 0.4, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.42, 4, 8]} />
        <meshStandardMaterial color="#2a241c" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh ref={right} position={[0.16, 0.4, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.42, 4, 8]} />
        <meshStandardMaterial color="#2a241c" metalness={0.4} roughness={0.5} />
      </mesh>
      <Billboard position={[0, 2.55, 0]} follow>
        <mesh>
          <planeGeometry args={[1.7, 0.52]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  )
}
