import { Billboard } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fmtPx } from '../game/auction'
import { advertisedPrice, inspectStore } from '../game/gameStore'
import type { StoreDef } from '../game/types'
import { useGame } from '../ui/useGame'
import { makeCalloutTexture, makeFasciaTexture, useBrickTexture, useMetalTexture } from './textures'

export function StoreBuilding({ store }: { store: StoreDef }) {
  const g = useGame()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const price = advertisedPrice(store.id, g)
  const hot = g.nearby === store.id || g.inspecting === store.id
  const open = g.shutter
  const short = store.name.replace(/^[Y5M+−-]+\s?/, '').split(' ')[0] ?? store.name

  return (
    <group
      position={store.position}
      onClick={(e) => {
        e.stopPropagation()
        inspectStore(store.id)
      }}
    >
      {store.building === 'foundry' && <Foundry brick={brick} metal={metal} open={open} />}
      {store.building === 'hall' && <Hall brick={brick} metal={metal} open={open} />}
      {store.building === 'dock' && <Dock metal={metal} open={open} />}
      {store.building === 'yard' && <Yard metal={metal} brick={brick} open={open} />}
      {store.building === 'mill' && <Mill brick={brick} metal={metal} open={open} />}
      {store.building === 'alley' && <Alley metal={metal} open={open} />}
      {store.building === 'spire' && (
        <Spire metal={metal} live={g.avwap.vwap} sigma={g.avwap.sigma} />
      )}
      {store.building === 'band' && <Band metal={metal} accent={store.accent} />}
      <Fascia title={short} paint={store.accent} y={store.building === 'spire' ? 3.1 : 2.55} z={store.building === 'spire' ? 1.15 : 2.22} />
      {hot && (
        <>
          <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.35, 2.55, 28]} />
            <meshBasicMaterial color="#d4a046" transparent opacity={0.9} />
          </mesh>
          <Callout title={store.name} price={fmtPx(price)} color={store.accent} y={store.building === 'spire' ? 9.4 : 5.6} />
        </>
      )}
    </group>
  )
}

function Fascia({ title, paint, y, z }: { title: string; paint: string; y: number; z: number }) {
  const tex = useMemo(() => makeFasciaTexture(title, paint), [title, paint])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[0, y, z]}>
      <planeGeometry args={[2.15, 0.4]} />
      <meshStandardMaterial map={tex} roughness={0.55} />
    </mesh>
  )
}

function Callout({ title, price, color, y }: { title: string; price: string; color: string; y: number }) {
  const tex = useMemo(() => makeCalloutTexture(title, price, color), [title, price, color])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <Billboard position={[0, y, 0]} follow>
      <mesh>
        <planeGeometry args={[2.4, 0.75]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Billboard>
  )
}

function RollDoor({ width, height, open, z }: { width: number; height: number; open: number; z: number }) {
  const h = height * (1 - open * 0.88)
  return (
    <mesh position={[0, h / 2 + 0.08, z]} castShadow>
      <boxGeometry args={[width, Math.max(0.08, h), 0.08]} />
      <meshStandardMaterial color="#3a3834" metalness={0.35} roughness={0.5} />
    </mesh>
  )
}

function WindowRow({
  xs,
  y,
  z,
  color = '#2c3c46',
}: {
  xs: number[]
  y: number
  z: number
  color?: string
}) {
  return (
    <>
      {xs.map((x) => (
        <mesh key={x} position={[x, y, z]}>
          <boxGeometry args={[0.42, 0.55, 0.06]} />
          <meshStandardMaterial color={color} roughness={0.22} metalness={0.15} />
        </mesh>
      ))}
    </>
  )
}

function Cornice({ w, d, y, color = '#6a4030' }: { w: number; d: number; y: number; color?: string }) {
  return (
    <mesh position={[0, y, 0]} castShadow>
      <boxGeometry args={[w, 0.16, d]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  )
}

function Foundry({ brick, metal, open }: { brick: THREE.Texture; metal: THREE.Texture; open: number }) {
  return (
    <group>
      <mesh position={[0, 1.85, -0.15]} castShadow receiveShadow>
        <boxGeometry args={[5.15, 3.7, 4.15]} />
        <meshStandardMaterial map={brick} color="#a05034" roughness={0.86} />
      </mesh>
      <Cornice w={5.4} d={4.4} y={3.78} />
      <WindowRow xs={[-1.7, -0.85, 0.85, 1.7]} y={2.55} z={2.1} />
      <mesh position={[-1.55, 0.95, 2.05]}>
        <boxGeometry args={[1.5, 1.7, 0.1]} />
        <meshStandardMaterial color="#1a1210" roughness={0.5} />
      </mesh>
      <RollDoor width={1.7} height={1.85} open={open} z={2.12} />
      {[-1.15, 1.15].map((x) => (
        <group key={x} position={[x, 0, 1.55]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.78, 1.4, 10]} />
            <meshStandardMaterial color="#4a3028" metalness={0.35} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.45, 0.15]}>
            <boxGeometry args={[0.7, 0.35, 0.5]} />
            <meshStandardMaterial color="#2a1814" emissive="#c45c2a" emissiveIntensity={0.55 + open * 0.9} />
          </mesh>
        </group>
      ))}
      <mesh position={[1.55, 5.15, -0.85]} castShadow>
        <cylinderGeometry args={[0.38, 0.48, 4.4, 10]} />
        <meshStandardMaterial map={metal} color="#5a4a40" metalness={0.45} roughness={0.48} />
      </mesh>
      <mesh position={[1.55, 7.4, -0.85]}>
        <cylinderGeometry args={[0.52, 0.4, 0.28, 10]} />
        <meshStandardMaterial color="#4a3830" />
      </mesh>
      <mesh position={[1.55, 3.95, -0.85]}>
        <torusGeometry args={[0.5, 0.05, 6, 12]} />
        <meshStandardMaterial color="#3a3028" />
      </mesh>
      <mesh position={[-1.6, 4.05, -0.4]} castShadow>
        <cylinderGeometry args={[0.42, 0.42, 0.7, 10]} />
        <meshStandardMaterial map={metal} color="#6a5040" />
      </mesh>
      <Sparks open={open} />
    </group>
  )
}

function Hall({ brick, metal, open }: { brick: THREE.Texture; metal: THREE.Texture; open: number }) {
  return (
    <group>
      <mesh position={[0, 2.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.05, 4.1, 4.55]} />
        <meshStandardMaterial map={brick} color="#b06040" roughness={0.84} />
      </mesh>
      <mesh position={[0, 4.45, 0]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[6.5, 0.18, 5]} />
        <meshStandardMaterial map={metal} color="#6a4a30" roughness={0.55} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, 0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#7a5434" roughness={0.5} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, -0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#7a5434" roughness={0.5} />
      </mesh>
      {[-2.15, -0.72, 0.72, 2.15].map((x) => (
        <mesh key={x} position={[x, 1.15, 2.45]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 2.3, 8]} />
          <meshStandardMaterial color="#c4a046" metalness={0.45} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 2.35, 2.45]}>
        <boxGeometry args={[5.1, 0.14, 0.55]} />
        <meshStandardMaterial color="#8a6038" />
      </mesh>
      <WindowRow xs={[-2.2, -1.3, 1.3, 2.2]} y={2.85} z={2.3} />
      <mesh position={[0, 1.05, 2.32]}>
        <boxGeometry args={[1.7, 1.9, 0.08]} />
        <meshStandardMaterial color="#1c140e" />
      </mesh>
      <RollDoor width={1.7} height={1.95} open={open} z={2.36} />
    </group>
  )
}

function Dock({ metal, open }: { metal: THREE.Texture; open: number }) {
  return (
    <group>
      {[-2.35, 2.35].map((x) => (
        <mesh key={x} position={[x, 2.15, 0]} castShadow>
          <boxGeometry args={[0.28, 4.3, 4.2]} />
          <meshStandardMaterial map={metal} color="#8a9298" metalness={0.45} roughness={0.42} />
        </mesh>
      ))}
      <mesh position={[0, 4.35, 0]} castShadow>
        <boxGeometry args={[5.1, 0.18, 4.5]} />
        <meshStandardMaterial map={metal} color="#7a8088" metalness={0.5} roughness={0.38} />
      </mesh>
      {[-1.2, 0, 1.2].map((x) => (
        <mesh key={x} position={[x, 2.1, 2.05]}>
          <boxGeometry args={[1.05, 2.5 * (1 - open * 0.15), 0.06]} />
          <meshStandardMaterial color="#2a3038" transparent opacity={0.35 + (1 - open) * 0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0.12, 2.55]} receiveShadow>
        <boxGeometry args={[4.8, 0.18, 2.1]} />
        <meshStandardMaterial color="#5a564e" roughness={0.9} />
      </mesh>
      <Truck x={1.45} z={2.7} />
      <mesh position={[-1.6, 0.55, 2.35]} castShadow>
        <boxGeometry args={[1.1, 0.9, 0.85]} />
        <meshStandardMaterial color="#6a5040" roughness={0.7} />
      </mesh>
    </group>
  )
}

function Truck({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, -0.4, 0]}>
      <mesh position={[0, 0.72, 0]} castShadow>
        <boxGeometry args={[1.55, 0.95, 0.85]} />
        <meshStandardMaterial color="#6a3a28" roughness={0.55} />
      </mesh>
      <mesh position={[-1.05, 0.55, 0]} castShadow>
        <boxGeometry args={[0.55, 0.6, 0.8]} />
        <meshStandardMaterial color="#3a3a38" />
      </mesh>
      {[-0.45, 0.45].map((dx) => (
        <mesh key={dx} position={[dx, 0.22, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.16, 8]} />
          <meshStandardMaterial color="#1a1a18" />
        </mesh>
      ))}
    </group>
  )
}

function Yard({ metal, brick, open }: { metal: THREE.Texture; brick: THREE.Texture; open: number }) {
  return (
    <group>
      <mesh position={[0, 1.75, -0.35]} castShadow receiveShadow>
        <boxGeometry args={[5.25, 3.5, 3.7]} />
        <meshStandardMaterial map={brick} color="#8a4a34" roughness={0.85} />
      </mesh>
      <Cornice w={5.5} d={3.95} y={3.58} />
      <WindowRow xs={[-1.5, 0, 1.5]} y={2.35} z={1.52} />
      <RollDoor width={1.6} height={1.7} open={open} z={1.55} />
      {[-1.35, 0, 1.35].map((x, i) => (
        <IBeam key={x} x={x} z={1.85} y={0.22 + i * 0.18} />
      ))}
      <mesh position={[2.15, 4.35, 0.4]} castShadow>
        <boxGeometry args={[0.18, 5.4, 0.18]} />
        <meshStandardMaterial color="#8a4a28" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[0.35, 7.05, 0.4]} rotation={[0, 0, -0.42]} castShadow>
        <boxGeometry args={[4.2, 0.16, 0.16]} />
        <meshStandardMaterial color="#8a4a28" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[2.15, 5.55, 0.4]}>
        <boxGeometry args={[0.7, 0.45, 0.55]} />
        <meshStandardMaterial map={metal} color="#4a5560" />
      </mesh>
    </group>
  )
}

function IBeam({ x, z, y }: { x: number; z: number; y: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, 0.18, 0]}>
      <mesh>
        <boxGeometry args={[1.7, 0.06, 0.42]} />
        <meshStandardMaterial color="#6a7078" metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[0.08, 0.28, 0.38]} />
        <meshStandardMaterial color="#5a6068" metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[1.7, 0.06, 0.42]} />
        <meshStandardMaterial color="#6a7078" metalness={0.55} roughness={0.35} />
      </mesh>
    </group>
  )
}

function Mill({ brick, metal, open }: { brick: THREE.Texture; metal: THREE.Texture; open: number }) {
  return (
    <group>
      <mesh position={[0, 1.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.15, 3.7, 4.7]} />
        <meshStandardMaterial map={brick} color="#a85a38" roughness={0.84} />
      </mesh>
      {[-2.05, 0, 2.05].map((x) => (
        <group key={x}>
          <mesh position={[x, 4.15, 0]} rotation={[0, 0, 0.62]} castShadow>
            <boxGeometry args={[2.35, 0.14, 4.85]} />
            <meshStandardMaterial map={metal} color="#6a4030" roughness={0.55} />
          </mesh>
          <mesh position={[x + 0.55, 4.45, 2.38]}>
            <boxGeometry args={[0.7, 0.45, 0.08]} />
            <meshStandardMaterial color="#2a3844" roughness={0.25} />
          </mesh>
        </group>
      ))}
      <WindowRow xs={[-2.1, -1.05, 1.05, 2.1]} y={2.45} z={2.38} />
      <RollDoor width={1.85} height={1.9} open={open} z={2.4} />
      <mesh position={[2.55, 0.45, 2.15]} rotation={[0, 0, -0.22]} receiveShadow>
        <boxGeometry args={[1.6, 0.12, 1.4]} />
        <meshStandardMaterial color="#6a5a40" />
      </mesh>
    </group>
  )
}

function Alley({ metal, open }: { metal: THREE.Texture; open: number }) {
  return (
    <group>
      <mesh position={[-1.55, 2.15, 0]} castShadow>
        <boxGeometry args={[1.85, 4.3, 4.15]} />
        <meshStandardMaterial map={metal} color="#6a7a88" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[1.65, 1.75, 0.25]} castShadow>
        <boxGeometry args={[1.7, 3.5, 3.7]} />
        <meshStandardMaterial map={metal} color="#5a6a78" metalness={0.35} roughness={0.52} />
      </mesh>
      <mesh position={[-1.55, 4.4, 0]}>
        <boxGeometry args={[2.05, 0.14, 4.35]} />
        <meshStandardMaterial color="#5a6870" metalness={0.45} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0.05, 0.35 + i * 0.55, 2.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 1.35, 5]} />
          <meshStandardMaterial color="#7a8088" metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[0.05, 1.4, 2.05]}>
        <boxGeometry args={[0.08, 2.6, 0.08]} />
        <meshStandardMaterial color="#6a7078" />
      </mesh>
      <RollDoor width={0.9} height={1.6} open={open} z={2.1} />
    </group>
  )
}

function Spire({ metal, live, sigma }: { metal: THREE.Texture; live: number; sigma: number }) {
  const lift = 3.4 + ((live % 80) / 80) * 3.6
  const ring = 1.05 + (sigma / 400) * 0.55
  return (
    <group>
      {([-0.7, 0.7] as const).map((x) =>
        ([-0.7, 0.7] as const).map((z) => (
          <mesh key={`${x}${z}`} position={[x, 4.1, z]} castShadow>
            <boxGeometry args={[0.12, 8.2, 0.12]} />
            <meshStandardMaterial map={metal} color="#4a5a62" metalness={0.5} roughness={0.4} />
          </mesh>
        )),
      )}
      {[1.6, 3.4, 5.2, 7].map((y) => (
        <group key={y}>
          <mesh position={[0, y, 0]}>
            <boxGeometry args={[1.55, 0.08, 0.08]} />
            <meshStandardMaterial color="#3a4a52" />
          </mesh>
          <mesh position={[0, y, 0]}>
            <boxGeometry args={[0.08, 0.08, 1.55]} />
            <meshStandardMaterial color="#3a4a52" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 8.35, 0]} castShadow>
        <boxGeometry args={[1.7, 0.22, 1.7]} />
        <meshStandardMaterial color="#2a6a78" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 8.85, 0]}>
        <coneGeometry args={[0.28, 0.7, 4]} />
        <meshStandardMaterial color="#c4a046" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, lift, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[ring, 0.05, 8, 28]} />
        <meshStandardMaterial color="#2a6a78" metalness={0.4} roughness={0.3} />
      </mesh>
    </group>
  )
}

function Band({ metal, accent }: { metal: THREE.Texture; accent: string }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (ref.current) ref.current.rotation.y = s.clock.elapsedTime * 0.22
  })
  return (
    <group>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[3.15, 2.5, 3.15]} />
        <meshStandardMaterial map={metal} color="#4a5860" metalness={0.4} roughness={0.45} />
      </mesh>
      <mesh position={[0, 2.6, 0]} castShadow>
        <boxGeometry args={[3.35, 0.14, 3.35]} />
        <meshStandardMaterial color={accent} metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh ref={ref} position={[0, 2.95, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.15, 0.07, 8, 24]} />
        <meshStandardMaterial color={accent} metalness={0.45} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.85, 1.6]}>
        <boxGeometry args={[1.15, 1.5, 0.08]} />
        <meshStandardMaterial color="#2a2420" />
      </mesh>
    </group>
  )
}

function Sparks({ open }: { open: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeds = useMemo(() => Array.from({ length: 18 }, () => Math.random()), [])
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime
    seeds.forEach((seed, i) => {
      const u = (t * (1.2 + seed) + seed * 8) % 1
      dummy.position.set((seed - 0.5) * 1.4, 1.15 + u * 1.8 * open, 1.55)
      dummy.scale.setScalar(open > 0.2 ? 0.035 + (1 - u) * 0.06 : 0.001)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 18]}>
      <sphereGeometry args={[1, 5, 5]} />
      <meshBasicMaterial color="#e07030" />
    </instancedMesh>
  )
}
