import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/** Authored mill dressing packed into leftover gaps — not a prop dump on empty pads. */
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
    </group>
  )
}

function Poplar({ x, z, h = 3.4 }: { x: number; z: number; h?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.16, 1.1, 6]} />
        <meshStandardMaterial color="#5a3a22" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.55, 0]} castShadow>
        <coneGeometry args={[0.55, h * 0.45, 7]} />
        <meshStandardMaterial color="#2e5a28" roughness={0.78} />
      </mesh>
      <mesh position={[0, 2.35, 0]} castShadow>
        <coneGeometry args={[0.42, h * 0.4, 7]} />
        <meshStandardMaterial color="#3a6a30" roughness={0.75} />
      </mesh>
      <mesh position={[0, 3.05, 0]} castShadow>
        <coneGeometry args={[0.28, h * 0.32, 7]} />
        <meshStandardMaterial color="#2a5224" roughness={0.75} />
      </mesh>
    </group>
  )
}

function Poplars() {
  const spots: Array<[number, number]> = [
    [-16.4, -16.2],
    [16.2, -16.4],
    [-16.5, 16.1],
    [16.4, 16.3],
    [-16.6, 0],
    [16.6, 4],
    [0, -16.6],
    [7, 16.5],
    [-8, 16.4],
    [16.5, -6],
    [-12, -16.5],
    [12, -16.4],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <Poplar key={i} x={x} z={z} h={3.1 + (i % 3) * 0.35} />
      ))}
    </group>
  )
}

function PipeRacks() {
  return (
    <group>
      <group position={[2.7, 0, 2.55]}>
        {[-0.35, 0.35].map((z) => (
          <mesh key={z} position={[0, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.11, 0.11, 3.4, 8]} />
            <meshStandardMaterial color="#8a4a30" metalness={0.4} roughness={0.45} />
          </mesh>
        ))}
        {[-1.3, 0, 1.3].map((x) => (
          <mesh key={x} position={[x, 0.35, 0]}>
            <boxGeometry args={[0.08, 0.7, 0.9]} />
            <meshStandardMaterial color="#4a4038" />
          </mesh>
        ))}
      </group>
      <mesh position={[-2.8, 0.7, -2.6]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 3.2, 8]} />
        <meshStandardMaterial color="#4a6a78" metalness={0.4} roughness={0.42} />
      </mesh>
    </group>
  )
}

function Pallet({ x, z, y, rot = 0 }: { x: number; z: number; y: number; rot?: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.04, 0.22]}>
        <boxGeometry args={[0.7, 0.08, 0.1]} />
        <meshStandardMaterial color="#6a4a28" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.04, -0.22]}>
        <boxGeometry args={[0.7, 0.08, 0.1]} />
        <meshStandardMaterial color="#6a4a28" roughness={0.8} />
      </mesh>
      {[-0.25, 0, 0.25].map((sx) => (
        <mesh key={sx} position={[sx, 0.12, 0]}>
          <boxGeometry args={[0.1, 0.06, 0.62]} />
          <meshStandardMaterial color="#8a6234" roughness={0.75} />
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
      [3.15, 3.15],
      [-3.2, 3.05],
      [3.2, -3.1],
      [-3.15, -3.2],
      [2.4, 0.15],
      [-2.35, 0.2],
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
        <meshStandardMaterial color="#7a5230" roughness={0.78} />
      </instancedMesh>
      <Pallet x={3.15} z={3.15} y={0.28} />
      <Pallet x={-3.2} z={3.05} y={0.28} rot={0.3} />
      <Pallet x={2.4} z={0.15} y={0.28} />
    </group>
  )
}

function RailSpur() {
  return (
    <group position={[8.6, 0, 0.4]} rotation={[0, 0.08, 0]}>
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.06, 0]}>
          <boxGeometry args={[0.08, 0.08, 12]} />
          <meshStandardMaterial color="#4a4a48" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} position={[0, 0.04, -5 + i * 1.15]}>
          <boxGeometry args={[1.15, 0.06, 0.18]} />
          <meshStandardMaterial color="#5a3e28" roughness={0.85} />
        </mesh>
      ))}
      <group position={[0, 0, 1.2]}>
        <mesh position={[0, 0.7, 0]} castShadow>
          <boxGeometry args={[1.7, 0.95, 3.4]} />
          <meshStandardMaterial color="#7a3228" roughness={0.55} />
        </mesh>
        {([-1.1, 1.1] as const).map((z) =>
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
          <meshStandardMaterial color="#6a7074" metalness={0.5} />
        </mesh>
      ))}
      <mesh position={[-1.9, 1.7, 0]}>
        <boxGeometry args={[4.4, 0.04, 0.04]} />
        <meshStandardMaterial color="#6a7074" />
      </mesh>
    </group>
  )
}

function HoseReels() {
  return (
    <group>
      {([
        [-2.9, 4.1],
        [4.2, -2.7],
      ] as Array<[number, number]>).map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.32, 0.08, 8, 14]} />
            <meshStandardMaterial color="#4a3028" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.06, 0.08, 0.4, 6]} />
            <meshStandardMaterial color="#3a3834" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function OilStains() {
  const spots: Array<[number, number, number]> = [
    [1.4, 0.6, 1.1],
    [-1.1, 0.45, -1.4],
    [4.1, 0.7, 2.2],
    [-4.2, 0.55, 1.8],
  ]
  return (
    <group>
      {spots.map(([x, sx, z], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0.3]} position={[x, 0.03, z]}>
          <circleGeometry args={[sx, 10]} />
          <meshStandardMaterial color="#2a2218" transparent opacity={0.45} roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function CourtyardFill() {
  return (
    <group>
      {[0, 0.4, 0.8].map((a, i) => (
        <mesh key={i} position={[1.15, 0.22 + i * 0.16, -1.35]} rotation={[0, a, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.2, 0.42, 8]} />
          <meshStandardMaterial color={i % 2 ? '#6a3a28' : '#3a4a58'} roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
      <mesh position={[-1.25, 0.35, 1.4]} castShadow>
        <boxGeometry args={[0.7, 0.55, 0.55]} />
        <meshStandardMaterial color="#5a4030" roughness={0.7} />
      </mesh>
    </group>
  )
}
