import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fmtPx } from '../game/auction'
import { closeInspect, getGame, skipToLive, backToHub, setPlayer, setPointerLocked, takeAuction, toggleInspect } from '../game/gameStore'
import { COLLISIONS } from '../game/stores'
import { useGame } from '../ui/useGame'

const SPEED = 9
const SPRINT = 15.5
const BOUNDS = { minX: -62, maxX: 58, minZ: -54, maxZ: 48 }

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
    if (Math.abs(x - c.x) < c.w / 2 + 0.7 && Math.abs(z - c.z) < c.d / 2 + 0.7) return true
  }
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

export function Player({
  spawn,
  bounds,
  camDist = 7.4,
  collide = true,
}: {
  spawn: [number, number, number]
  bounds?: Partial<typeof BOUNDS>
  camDist?: number
  collide?: boolean
}) {
  const g = useGame()
  const { camera, gl } = useThree()
  const group = useRef<THREE.Group>(null)
  const yaw = useRef(g.player.yaw)
  const pos = useRef(new THREE.Vector3(...spawn))
  const bob = useRef(0)
  const vel = useRef(0)
  const lim = { ...BOUNDS, ...bounds }

  useEffect(() => {
    pos.current.set(spawn[0], spawn[1], spawn[2])
    yaw.current = getGame().player.yaw
  }, [spawn[0], spawn[1], spawn[2]])

  useEffect(() => {
    const el = gl.domElement
    const onClick = () => {
      if (document.pointerLockElement !== el) el.requestPointerLock()
    }
    const onLock = () => setPointerLocked(document.pointerLockElement === el)
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return
      yaw.current -= e.movementX * 0.0024
    }
    el.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLock)
    document.addEventListener('mousemove', onMove)
    return () => {
      el.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLock)
      document.removeEventListener('mousemove', onMove)
    }
  }, [gl])

  useFrame((_, dt) => {
    const snap = getGame()
    const frozen = snap.phase === 'opening'
    let ix = 0
    let iz = 0
    if (!frozen) {
      if (keys.w) iz -= 1
      if (keys.s) iz += 1
      if (keys.a) ix -= 1
      if (keys.d) ix += 1
    }
    const moving = ix !== 0 || iz !== 0
    const speed = (keys.shift ? SPRINT : SPEED) * (snap.scene === 'hub' ? 0.85 : 1)
    if (moving) {
      const len = Math.hypot(ix, iz)
      ix /= len
      iz /= len
      const c = Math.cos(yaw.current)
      const s = Math.sin(yaw.current)
      const dx = ix * c + iz * s
      const dz = -ix * s + iz * c
      const step = speed * dt
      const nx = THREE.MathUtils.clamp(pos.current.x + dx * step, lim.minX, lim.maxX)
      const nz = THREE.MathUtils.clamp(pos.current.z + dz * step, lim.minZ, lim.maxZ)
      if (!blocked(nx, pos.current.z, collide)) pos.current.x = nx
      if (!blocked(pos.current.x, nz, collide)) pos.current.z = nz
      vel.current = THREE.MathUtils.lerp(vel.current, 1, 0.15)
    } else {
      vel.current = THREE.MathUtils.lerp(vel.current, 0, 0.12)
    }
    bob.current += dt * (4 + vel.current * 8)

    if (group.current) {
      group.current.position.set(pos.current.x, 0, pos.current.z)
      group.current.rotation.y = yaw.current
    }
    setPlayer({ x: pos.current.x, y: pos.current.y, z: pos.current.z, yaw: yaw.current })

    const behind = new THREE.Vector3(
      pos.current.x + Math.sin(yaw.current) * camDist,
      3.6 + vel.current * 0.4,
      pos.current.z + Math.cos(yaw.current) * camDist,
    )
    if (snap.phase === 'opening') {
      const t = snap.openElapsed / 7.5
      camera.position.lerp(new THREE.Vector3(8 - t * 6, 5.5 - t * 1.2, 22 - t * 8), 0.06)
      camera.lookAt(0, 3 + t, 0)
    } else {
      camera.position.lerp(behind, 1 - Math.pow(0.001, dt))
      camera.lookAt(pos.current.x, 1.55, pos.current.z)
    }
  })

  const ticker = fmtPx(g.livePrice)

  return (
    <group ref={group} position={spawn}>
      <PriceBody vel={vel} bob={bob} label={ticker} />
      <pointLight color="#f4d29a" intensity={1.6} distance={9} position={[0, 2.1, 0]} />
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
  const body = useRef<THREE.Group>(null)
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
    ctx.lineWidth = 8
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
    if (body.current) body.current.position.y = 0
    if (left.current) left.current.rotation.x = leg
    if (right.current) right.current.rotation.x = -leg
  })

  return (
    <group ref={body}>
      <mesh position={[0, 1.15, 0]} castShadow>
        <capsuleGeometry args={[0.32, 0.85, 6, 12]} />
        <meshPhysicalMaterial
          color="#c4a574"
          metalness={0.92}
          roughness={0.18}
          emissive="#3a2a12"
          emissiveIntensity={0.35}
          clearcoat={0.6}
        />
      </mesh>
      <mesh position={[0, 2.05, 0]} castShadow>
        <sphereGeometry args={[0.28, 20, 16]} />
        <meshPhysicalMaterial color="#efe6d6" metalness={0.7} roughness={0.22} emissive="#d4a046" emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={left} position={[-0.18, 0.45, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.55, 4, 8]} />
        <meshStandardMaterial color="#2a241c" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh ref={right} position={[0.18, 0.45, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.55, 4, 8]} />
        <meshStandardMaterial color="#2a241c" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.72, 0.02]}>
        <planeGeometry args={[1.55, 0.48]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, 2.05, 0.18]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshBasicMaterial color="#fff2c4" />
      </mesh>
    </group>
  )
}
