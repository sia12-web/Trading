import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/** Packed mill dressing: poplars, courtyard market, water tower, rail — leftover tile is not empty. */
export function YardDressing() {
  return (
    <group>
      <Poplars />
      <PipeRacks />
      <PalletRows />
      <RailSpur />
      <ChainLink />
      <HoseReels />
      <OilStains />
      <CourtyardFill />
      <WaterTower />
      <OuterBelt />
    </group>
  )
}

function Poplar({ x, z, h = 4.2 }: { x: number; z: number; h?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h * 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.18, h * 0.44, 6]} />
        <meshStandardMaterial color="#8a5230" roughness={0.9} />
      </mesh>
      <mesh position={[0, h * 0.55, 0]} scale={[1, 1.45, 1]} castShadow>
        <sphereGeometry args={[0.78, 8, 7]} />
        <meshStandardMaterial color="#2f8a32" roughness={0.76} emissive="#1e5c20" emissiveIntensity={0.16} />
      </mesh>
      <mesh position={[0.22, h * 0.78, 0.08]} scale={[0.82, 1.15, 0.82]} castShadow>
        <sphereGeometry args={[0.58, 8, 7]} />
        <meshStandardMaterial color="#267828" roughness={0.76} emissive="#184c18" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[-0.18, h * 0.92, -0.1]} scale={[0.68, 1.05, 0.68]} castShadow>
        <sphereGeometry args={[0.42, 7, 6]} />
        <meshStandardMaterial color="#3a9c38" roughness={0.74} emissive="#246020" emissiveIntensity={0.1} />
      </mesh>
    </group>
  )
}

function Poplars() {
  const spots: Array<[number, number, number]> = [
    [-16.6, -16.4, 4.4],
    [16.4, -16.5, 4.1],
    [-16.7, 16.2, 4.6],
    [16.6, 16.4, 4.3],
    [-16.8, 0, 4.8],
    [16.8, 4.2, 4.2],
    [16.7, -5.5, 3.9],
    [0, -16.8, 4.5],
    [7.2, 16.6, 4.0],
    [-8.2, 16.5, 4.4],
    [-12.2, -16.7, 3.8],
    [12.1, -16.6, 4.2],
    [-16.5, 8.2, 3.7],
    [16.5, 10.4, 4.0],
    [-4.5, -16.7, 3.9],
    [4.2, -16.8, 4.5],
    [-16.6, -8.4, 4.1],
    [10.4, 16.5, 3.8],
    [-19.2, -10.2, 3.4],
    [19.1, -8.4, 3.6],
    [18.8, 8.2, 3.5],
    [-18.6, 6.4, 3.7],
  ]
  return (
    <group>
      {spots.map(([x, z, h], i) => (
        <Poplar key={i} x={x} z={z} h={h} />
      ))}
    </group>
  )
}

function PipeRacks() {
  return (
    <group>
      <group position={[3.05, 0, 2.35]}>
        {[-0.35, 0.35].map((z) => (
          <mesh key={z} position={[0, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.11, 0.11, 2.6, 8]} />
            <meshStandardMaterial color="#c45a32" metalness={0.4} roughness={0.45} emissive="#8a3018" emissiveIntensity={0.08} />
          </mesh>
        ))}
        {[-1.0, 0, 1.0].map((x) => (
          <mesh key={x} position={[x, 0.35, 0]}>
            <boxGeometry args={[0.08, 0.7, 0.9]} />
            <meshStandardMaterial color="#6a6058" />
          </mesh>
        ))}
      </group>
      <mesh position={[-3.05, 0.7, -2.45]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 2.8, 8]} />
        <meshStandardMaterial color="#5a8aa0" metalness={0.4} roughness={0.42} emissive="#3a5a68" emissiveIntensity={0.1} />
      </mesh>
    </group>
  )
}

function Pallet({ x, z, y, rot = 0 }: { x: number; z: number; y: number; rot?: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.04, 0.22]}>
        <boxGeometry args={[0.7, 0.08, 0.1]} />
        <meshStandardMaterial color="#8a5a30" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.04, -0.22]}>
        <boxGeometry args={[0.7, 0.08, 0.1]} />
        <meshStandardMaterial color="#8a5a30" roughness={0.8} />
      </mesh>
      {[-0.25, 0, 0.25].map((sx) => (
        <mesh key={sx} position={[sx, 0.12, 0]}>
          <boxGeometry args={[0.1, 0.06, 0.62]} />
          <meshStandardMaterial color="#b07a40" roughness={0.75} />
        </mesh>
      ))}
    </group>
  )
}

function PalletRows() {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  const n = 18
  useLayoutEffect(() => {
    if (!ref.current) return
    const bases: Array<[number, number]> = [
      [3.35, 3.25],
      [-3.35, 3.15],
      [3.35, -3.2],
      [-3.3, -3.3],
      [2.55, 0.85],
      [-2.5, -0.9],
    ]
    let i = 0
    for (const [x, z] of bases) {
      for (let k = 0; k < 3; k++) {
        dummy.position.set(x + (k % 2) * 0.22, 0.08 + Math.floor(k / 2) * 0.16, z)
        dummy.rotation.set(0, k * 0.2, 0)
        dummy.updateMatrix()
        ref.current.setMatrixAt(i, dummy.matrix)
        i++
      }
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [dummy])
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, n]} castShadow>
        <boxGeometry args={[0.72, 0.12, 0.62]} />
        <meshStandardMaterial color="#a06a38" roughness={0.78} />
      </instancedMesh>
      <Pallet x={3.35} z={3.25} y={0.28} />
      <Pallet x={-3.35} z={3.15} y={0.28} rot={0.3} />
      <Pallet x={2.55} z={0.85} y={0.28} />
    </group>
  )
}

function RailSpur() {
  return (
      <group position={[12.05, 0, -1.4]} rotation={[0, 0.08, 0]}>
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.06, 0]}>
          <boxGeometry args={[0.08, 0.08, 12]} />
          <meshStandardMaterial color="#6a6a68" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} position={[0, 0.04, -5 + i * 1.15]}>
          <boxGeometry args={[1.15, 0.06, 0.18]} />
          <meshStandardMaterial color="#8a5a30" roughness={0.85} />
        </mesh>
      ))}
      <group position={[0, 0, 1.2]}>
        <mesh position={[0, 0.72, 0]} castShadow>
          <boxGeometry args={[1.75, 0.98, 3.5]} />
          <meshStandardMaterial color="#c43828" roughness={0.52} emissive="#8a1810" emissiveIntensity={0.14} />
        </mesh>
        <mesh position={[0, 1.32, -0.2]}>
          <boxGeometry args={[1.2, 0.12, 2.4]} />
          <meshStandardMaterial color="#3a3a38" />
        </mesh>
        {([-1.15, 1.15] as const).map((z) =>
          ([-0.55, 0.55] as const).map((x) => (
            <mesh key={`${x}${z}`} position={[x, 0.22, z]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.16, 8]} />
              <meshStandardMaterial color="#1a1a18" />
            </mesh>
          )),
        )}
      </group>
    </group>
  )
}

function ChainLink() {
  return (
    <group position={[8.4, 0, -8.2]}>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-i * 0.55, 0.85, 0]}>
          <boxGeometry args={[0.04, 1.7, 0.04]} />
          <meshStandardMaterial color="#8a9094" metalness={0.5} />
        </mesh>
      ))}
      <mesh position={[-1.9, 1.7, 0]}>
        <boxGeometry args={[4.4, 0.04, 0.04]} />
        <meshStandardMaterial color="#8a9094" />
      </mesh>
    </group>
  )
}

function HoseReels() {
  return (
    <group>
      {([
        [-2.95, 3.85],
        [4.15, -2.55],
      ] as Array<[number, number]>).map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.32, 0.08, 8, 14]} />
            <meshStandardMaterial color="#c45a28" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.06, 0.08, 0.4, 6]} />
            <meshStandardMaterial color="#5a5854" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function OilStains() {
  const spots: Array<[number, number, number]> = [
    [1.55, 0.42, 1.25],
    [-1.25, 0.38, -1.55],
    [4.15, 0.55, 2.35],
    [-4.25, 0.42, 1.65],
  ]
  return (
    <group>
      {spots.map(([x, sx, z], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0.3]} position={[x, 0.03, z]}>
          <circleGeometry args={[sx, 10]} />
          <meshStandardMaterial color="#3a2e22" transparent opacity={0.38} roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function Barrel({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <mesh position={[x, 0.32, z]} castShadow>
      <cylinderGeometry args={[0.2, 0.22, 0.62, 8]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} emissive={color} emissiveIntensity={0.08} />
    </mesh>
  )
}

function Cart({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.95, 0.42, 0.62]} />
        <meshStandardMaterial color="#c45a28" roughness={0.55} emissive="#8a3010" emissiveIntensity={0.1} />
      </mesh>
      <mesh position={[0.42, 0.55, 0]}>
        <boxGeometry args={[0.12, 0.55, 0.55]} />
        <meshStandardMaterial color="#8a6a38" />
      </mesh>
      {([-0.28, 0.28] as const).map((dx) => (
        <mesh key={dx} position={[dx, 0.16, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.1, 8]} />
          <meshStandardMaterial color="#2a2a28" />
        </mesh>
      ))}
    </group>
  )
}

function CrateStack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[0, 0.38, 0.76].map((y, i) => (
        <mesh key={i} position={[(i % 2) * 0.08, 0.2 + y * 0.55, 0]} rotation={[0, i * 0.2, 0]} castShadow>
          <boxGeometry args={[0.55, 0.38, 0.5]} />
          <meshStandardMaterial color={i % 2 ? '#c46830' : '#3a6a88'} roughness={0.65} emissive={i % 2 ? '#8a3818' : '#1a3a50'} emissiveIntensity={0.08} />
        </mesh>
      ))}
    </group>
  )
}

function MarketStall({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.15, 0.12, 0.85]} />
        <meshStandardMaterial color="#b07a40" roughness={0.75} />
      </mesh>
      {[-0.48, 0.48].map((sx) => (
        <mesh key={sx} position={[sx, 0.28, 0.32]}>
          <boxGeometry args={[0.08, 0.55, 0.08]} />
          <meshStandardMaterial color="#6a4a28" />
        </mesh>
      ))}
      <mesh position={[0, 1.05, 0]} rotation={[0, 0, 0.35]} castShadow>
        <boxGeometry args={[1.35, 0.08, 0.95]} />
        <meshStandardMaterial color="#d45830" roughness={0.6} emissive="#a03018" emissiveIntensity={0.12} />
      </mesh>
    </group>
  )
}

function CourtyardFill() {
  const ring: Array<[number, string]> = [
    [0.45, '#c45a28'],
    [1.05, '#3a6a88'],
    [2.05, '#c4a046'],
    [2.65, '#8a4030'],
    [3.65, '#c45a28'],
    [4.25, '#3a6a88'],
    [5.2, '#c4a046'],
    [5.8, '#8a4030'],
  ]
  return (
    <group>
      {ring.map(([a, color], i) => (
        <Barrel key={i} x={Math.cos(a) * 1.78} z={Math.sin(a) * 1.78} color={color} />
      ))}
      <Cart x={1.82} z={1.48} rot={-0.45} />
      <Cart x={-1.72} z={-1.42} rot={1.15} />
      <CrateStack x={1.68} z={-1.62} />
      <CrateStack x={-1.78} z={1.52} />
      <MarketStall x={2.12} z={0.55} rot={Math.PI / 2} />
      <MarketStall x={-2.12} z={-0.55} rot={-Math.PI / 2} />
      <mesh position={[0.15, 0.42, 2.05]} castShadow>
        <cylinderGeometry args={[0.28, 0.34, 0.7, 10]} />
        <meshStandardMaterial color="#8a9098" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0.15, 0.82, 2.05]}>
        <cylinderGeometry args={[0.08, 0.12, 0.22, 8]} />
        <meshStandardMaterial color="#c4a046" />
      </mesh>
    </group>
  )
}

function WaterTower() {
  return (
    <group position={[12.55, 0, 12.15]}>
      {([-0.55, 0.55] as const).map((x) =>
        ([-0.55, 0.55] as const).map((z) => (
          <mesh key={`${x}${z}`} position={[x, 2.1, z]} castShadow>
            <cylinderGeometry args={[0.08, 0.1, 4.2, 6]} />
            <meshStandardMaterial color="#8a6a48" metalness={0.25} roughness={0.5} />
          </mesh>
        )),
      )}
      <mesh position={[0, 4.55, 0]} castShadow>
        <cylinderGeometry args={[0.95, 1.05, 1.7, 12]} />
        <meshStandardMaterial color="#c8d0d6" metalness={0.4} roughness={0.4} emissive="#8a949c" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 5.55, 0]} castShadow>
        <coneGeometry args={[1.12, 0.7, 8]} />
        <meshStandardMaterial color="#c45a32" roughness={0.55} emissive="#8a2818" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 3.55, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.55, 8]} />
        <meshStandardMaterial color="#6a6058" />
      </mesh>
    </group>
  )
}

function OuterBelt() {
  return (
    <group>
      <mesh position={[-12.4, 0.06, 8.6]} receiveShadow>
        <boxGeometry args={[3.4, 0.08, 1.1]} />
        <meshStandardMaterial color="#7a9098" metalness={0.35} roughness={0.5} />
      </mesh>
      {[-1.1, 0, 1.1].map((x) => (
        <mesh key={x} position={[-12.4 + x, 0.42, 8.6]} castShadow>
          <boxGeometry args={[0.7, 0.7, 0.7]} />
          <meshStandardMaterial color="#c46830" roughness={0.65} />
        </mesh>
      ))}
      <group position={[-11.6, 0, -8.8]}>
        <mesh position={[0, 2.4, 0]} castShadow>
          <boxGeometry args={[0.22, 4.8, 0.22]} />
          <meshStandardMaterial color="#8a4a28" metalness={0.3} />
        </mesh>
        <mesh position={[1.4, 4.7, 0]} rotation={[0, 0, -0.5]} castShadow>
          <boxGeometry args={[3.2, 0.16, 0.16]} />
          <meshStandardMaterial color="#8a4a28" />
        </mesh>
      </group>
    </group>
  )
}
