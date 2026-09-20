import { Billboard } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fmtPx } from '../game/auction'
import { advertisedPrice, inspectStore } from '../game/gameStore'
import type { StoreDef } from '../game/types'
import { useGame } from '../ui/useGame'
import { makeLedTexture, useBrickTexture, useMetalTexture } from './textures'

export function StoreBuilding({ store }: { store: StoreDef }) {
  const g = useGame()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const price = advertisedPrice(store.id, g)
  const hot = g.nearby === store.id || g.inspecting === store.id
  const lidY = 3.2 + g.shutter * 3.8

  return (
    <group
      position={store.position}
      scale={0.66}
      onClick={(e) => {
        e.stopPropagation()
        inspectStore(store.id)
      }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[6.2, 24]} />
        <meshStandardMaterial color={hot ? store.accent : '#e8dcc8'} roughness={0.88} />
      </mesh>
      {store.building === 'foundry' && <Foundry brick={brick} metal={metal} accent={store.accent} />}
      {store.building === 'hall' && <Hall brick={brick} metal={metal} accent={store.accent} />}
      {store.building === 'dock' && <Dock metal={metal} accent={store.accent} />}
      {store.building === 'yard' && <Yard metal={metal} accent={store.accent} />}
      {store.building === 'mill' && <Mill brick={brick} metal={metal} accent={store.accent} />}
      {store.building === 'alley' && <Alley metal={metal} accent={store.accent} />}
      {store.building === 'spire' && <Spire metal={metal} accent={store.accent} live={g.avwap.vwap} sigma={g.avwap.sigma} />}
      {store.building === 'band' && <Band metal={metal} accent={store.accent} />}
      <Shutter metal={metal} y={lidY} width={store.building === 'hall' || store.building === 'mill' ? 11 : 9.2} />
      <LedSign
        title={store.name}
        price={fmtPx(price)}
        sub={store.subtitle}
        color={store.accent}
        y={store.building === 'spire' ? 17.5 : 9.2}
      />
      {hot && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[5.4, 6.1, 32]} />
          <meshBasicMaterial color={store.accent} transparent opacity={0.95} />
        </mesh>
      )}
      <pointLight color={store.accent} intensity={hot ? 8 : 3.2} distance={12} position={[0, 4.4, 0]} />
    </group>
  )
}

function Shutter({ metal, y, width }: { metal: THREE.Texture; y: number; width: number }) {
  return (
    <mesh position={[0, y, 0]} castShadow>
      <boxGeometry args={[width, 0.28, width * 0.82]} />
      <meshStandardMaterial map={metal} color="#8a96a4" metalness={0.75} roughness={0.38} />
    </mesh>
  )
}

function Foundry({ brick, metal, accent }: { brick: THREE.Texture; metal: THREE.Texture; accent: string }) {
  return (
    <group>
      <mesh position={[0, 3.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[10, 6.4, 8]} />
        <meshStandardMaterial map={brick} color="#eea078" roughness={0.82} />
      </mesh>
      {[-2.6, 2.6].map((x) => (
        <mesh key={x} position={[x, 3.4, 4.05]}>
          <boxGeometry args={[1.6, 2.2, 0.12]} />
          <meshStandardMaterial color="#8ed0ea" roughness={0.18} metalness={0.2} />
        </mesh>
      ))}
      <mesh position={[3.2, 9.2, -1.4]} castShadow>
        <cylinderGeometry args={[0.85, 1.1, 6.5, 10]} />
        <meshStandardMaterial map={metal} color="#8a96a4" metalness={0.65} roughness={0.38} />
      </mesh>
      <mesh position={[0, 1.4, 3.1]}>
        <boxGeometry args={[3.6, 2.8, 0.4]} />
        <meshStandardMaterial color="#120806" emissive={accent} emissiveIntensity={1.8} />
      </mesh>
      <Sparks />
      <SmokeStack x={3.2} z={-1.4} h={12} />
    </group>
  )
}

function Hall({ brick, metal, accent }: { brick: THREE.Texture; metal: THREE.Texture; accent: string }) {
  return (
    <group>
      <mesh position={[0, 3.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[12, 7.2, 9]} />
        <meshStandardMaterial map={brick} color="#f0c8a8" roughness={0.8} />
      </mesh>
      {[-4, -1.3, 1.3, 4].map((x) => (
        <mesh key={x} position={[x, 1.8, 4.2]} castShadow>
          <cylinderGeometry args={[0.28, 0.32, 3.6, 10]} />
          <meshStandardMaterial color="#d4a046" metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[0, 8.1, 0]} castShadow>
        <boxGeometry args={[13, 0.45, 10]} />
        <meshStandardMaterial map={metal} color="#d4a85a" metalness={0.45} roughness={0.42} />
      </mesh>
      <mesh position={[0, 1.6, 3.4]}>
        <boxGeometry args={[4.6, 3.2, 0.2]} />
        <meshStandardMaterial color="#1a0e04" emissive={accent} emissiveIntensity={1.2} />
      </mesh>
    </group>
  )
}

function Dock({ metal, accent }: { metal: THREE.Texture; accent: string }) {
  return (
    <group>
      {[-3.6, 3.6].map((x) => (
        <mesh key={x} position={[x, 3.4, 0]} castShadow>
          <boxGeometry args={[0.45, 6.8, 7.2]} />
          <meshStandardMaterial map={metal} color="#7a92a8" metalness={0.75} roughness={0.32} />
        </mesh>
      ))}
      <mesh position={[0, 6.9, 0]} castShadow>
        <boxGeometry args={[8.2, 0.28, 7.6]} />
        <meshStandardMaterial map={metal} color="#9ab4c8" metalness={0.8} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.3, 4.2]} rotation={[-0.08, 0, 0]} receiveShadow>
        <boxGeometry args={[7, 0.25, 5]} />
        <meshStandardMaterial color="#8a9aa8" metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[2.2, 0.7, 3]}>
        <boxGeometry args={[1.2, 1.1, 1.2]} />
        <meshStandardMaterial color="#8a6a32" />
      </mesh>
      <pointLight color={accent} intensity={6} distance={10} position={[0, 5, 2]} />
    </group>
  )
}

function Yard({ metal, accent }: { metal: THREE.Texture; accent: string }) {
  return (
    <group>
      <mesh position={[0, 2.8, -1]} castShadow>
        <boxGeometry args={[11, 5.6, 7]} />
        <meshStandardMaterial map={metal} color="#d07850" metalness={0.45} roughness={0.42} />
      </mesh>
      {[-2, 0, 2].map((x, i) => (
        <mesh key={x} position={[x, 0.55 + i * 0.15, 3.4]} rotation={[0, 0.2, 0]} castShadow>
          <boxGeometry args={[3.4, 0.22, 0.55]} />
          <meshStandardMaterial color="#8b93a0" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[4.8, 7.4, 1]} castShadow>
        <boxGeometry args={[0.35, 10, 0.35]} />
        <meshStandardMaterial color="#c45c2a" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[1.6, 11.8, 1]} rotation={[0, 0, -0.4]} castShadow>
        <boxGeometry args={[8, 0.28, 0.28]} />
        <meshStandardMaterial color="#c45c2a" metalness={0.4} roughness={0.4} />
      </mesh>
      <pointLight color={accent} intensity={10} distance={12} position={[0, 3, 3]} />
    </group>
  )
}

function Mill({ brick, metal, accent }: { brick: THREE.Texture; metal: THREE.Texture; accent: string }) {
  return (
    <group>
      <mesh position={[0, 3.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[13, 6.8, 9]} />
        <meshStandardMaterial map={brick} color="#eea070" roughness={0.8} />
      </mesh>
      {[-4, 0, 4].map((x) => (
        <mesh key={x} position={[x, 7.6, 0]} rotation={[0, 0, 0.55]} castShadow>
          <boxGeometry args={[5.2, 0.2, 9.2]} />
          <meshStandardMaterial map={metal} color="#c88848" metalness={0.28} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 1.7, 4.1]}>
        <boxGeometry args={[5, 3.4, 0.3]} />
        <meshStandardMaterial color="#140c04" emissive={accent} emissiveIntensity={1.4} />
      </mesh>
    </group>
  )
}

function Alley({ metal, accent }: { metal: THREE.Texture; accent: string }) {
  return (
    <group>
      <mesh position={[-3.4, 4, 0]} castShadow>
        <boxGeometry args={[2.2, 8, 8]} />
        <meshStandardMaterial map={metal} color="#5a7890" metalness={0.62} roughness={0.38} />
      </mesh>
      <mesh position={[3.4, 4, 0]} castShadow>
        <boxGeometry args={[2.2, 8, 8]} />
        <meshStandardMaterial map={metal} color="#5a7890" metalness={0.62} roughness={0.38} />
      </mesh>
      <mesh position={[0, 8.2, 0]}>
        <boxGeometry args={[9, 0.2, 8.4]} />
        <meshStandardMaterial color="#8aa0b4" metalness={0.7} roughness={0.32} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[-1.9, 1 + i * 1.1, 4.1]}>
          <torusGeometry args={[0.08, 0.03, 6, 10]} />
          <meshStandardMaterial color="#8a929c" metalness={0.9} />
        </mesh>
      ))}
      <pointLight color={accent} intensity={7} distance={11} position={[0, 3, 2]} />
    </group>
  )
}

function Spire({
  metal,
  accent,
  live,
  sigma,
}: {
  metal: THREE.Texture
  accent: string
  live: number
  sigma: number
}) {
  const lift = 5 + ((live % 80) / 80) * 6
  const ring = 2.2 + (sigma / 400) * 1.4
  return (
    <group>
      <mesh position={[0, 8, 0]} castShadow>
        <cylinderGeometry args={[1.1, 2.4, 16, 8]} />
        <meshStandardMaterial map={metal} color="#3a8898" metalness={0.68} roughness={0.28} />
      </mesh>
      <mesh position={[0, 16.4, 0]}>
        <coneGeometry args={[1.6, 2.4, 8]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, lift, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[ring, 0.08, 8, 48]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <mesh position={[0, lift, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[ring * 1.45, 0.05, 8, 48]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.7} />
      </mesh>
      <pointLight color={accent} intensity={22} distance={24} position={[0, 10, 0]} />
    </group>
  )
}

function Band({ metal, accent }: { metal: THREE.Texture; accent: string }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (ref.current) ref.current.rotation.y = s.clock.elapsedTime * 0.35
  })
  return (
    <group>
      <mesh position={[0, 2.2, 0]} castShadow>
        <boxGeometry args={[6.2, 4.4, 6.2]} />
        <meshStandardMaterial map={metal} color="#4a7888" metalness={0.62} roughness={0.36} />
      </mesh>
      <mesh ref={ref} position={[0, 5.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.4, 0.1, 8, 40]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <pointLight color={accent} intensity={9} distance={12} position={[0, 4, 2]} />
    </group>
  )
}

function LedSign({
  title,
  price,
  sub,
  color,
  y,
}: {
  title: string
  price: string
  sub: string
  color: string
  y: number
}) {
  const tex = useMemo(() => makeLedTexture(title, price, sub, color), [title, price, sub, color])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <Billboard position={[0, y, 0]} follow>
      <mesh>
        <planeGeometry args={[8.4, 4.2]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Billboard>
  )
}

function Sparks() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeds = useMemo(() => Array.from({ length: 28 }, () => Math.random()), [])
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime
    seeds.forEach((seed, i) => {
      const u = (t * (1.4 + seed) + seed * 10) % 1
      dummy.position.set((seed - 0.5) * 1.6, 1.2 + u * 3.2, 3.2 + (seed - 0.4))
      dummy.scale.setScalar(0.04 + (1 - u) * 0.08)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 28]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color="#ffb070" />
    </instancedMesh>
  )
}

function SmokeStack({ x, z, h }: { x: number; z: number; h: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((s) => {
    if (!ref.current) return
    for (let i = 0; i < 16; i++) {
      const u = (s.clock.elapsedTime * 0.12 + i / 16) % 1
      dummy.position.set(x + Math.sin(i + s.clock.elapsedTime) * 0.3, h + u * 6, z)
      dummy.scale.setScalar(0.4 + u * 1.4)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 16]}>
      <sphereGeometry args={[1, 7, 7]} />
      <meshStandardMaterial color="#d0d4d8" transparent opacity={0.14} depthWrite={false} />
    </instancedMesh>
  )
}
