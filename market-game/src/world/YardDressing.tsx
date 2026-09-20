import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Pine, Broadleaf, Bush, Cypress, Willow } from './ClashTerrain'

/** Packed mill dressing: pines on the grass, packed courtyard, rail, workers. */
export function YardDressing() {
  return (
    <group>
      <Pines />
      <PipeRacks />
      <PalletRows />
      <RailSpur />
      <ChainLink />
      <HoseReels />
      <OilStains />
      <CourtyardFill />
      <MillBackLot />
      <NorthCourt />
      <WaterTower />
      <OuterBelt />
    </group>
  )
}

function Pines() {
  const spots: Array<[number, number, number, 'pine' | 'oak' | 'cypress' | 'willow' | 'bush']> = [
    [-13.8, -13.6, 3.6, 'pine'],
    [13.6, -13.5, 2.8, 'oak'],
    [-13.7, 13.4, 3.8, 'cypress'],
    [13.8, 13.6, 2.4, 'willow'],
    [-13.9, 6.2, 3.2, 'oak'],
    [13.9, -6.1, 3.3, 'pine'],
    [6.4, 13.7, 2.6, 'oak'],
    [-6.2, -13.8, 3.4, 'pine'],
    [-12.6, 10.4, 3.0, 'willow'],
    [12.8, -10.2, 3.5, 'cypress'],
    [-12.2, -4.8, 1.2, 'bush'],
    [12.4, 5.1, 1.1, 'bush'],
    [-5.4, 13.1, 1.3, 'bush'],
    [4.8, -13.2, 1.15, 'bush'],
    [-14.4, 2.2, 4.2, 'pine'],
    [14.2, 3.4, 3.6, 'oak'],
    [2.2, 14.6, 4.0, 'cypress'],
    [-3.4, 14.8, 3.2, 'willow'],
    [14.6, -2.8, 3.8, 'pine'],
    [-14.5, -8.2, 3.4, 'oak'],
  ]
  return (
    <group>
      {spots.map(([x, z, h, kind], i) =>
        kind === 'bush' ? (
          <Bush key={i} x={x} z={z} h={h} seed={i + 11} />
        ) : kind === 'pine' ? (
          <Pine key={i} x={x} z={z} h={h} seed={i + 9} />
        ) : kind === 'cypress' ? (
          <Cypress key={i} x={x} z={z} h={h} seed={i + 13} />
        ) : kind === 'willow' ? (
          <Willow key={i} x={x} z={z} h={h} seed={i + 15} />
        ) : (
          <Broadleaf key={i} x={x} z={z} h={h} seed={i + 10} />
        ),
      )}
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
            <meshStandardMaterial color="#6a5a48" metalness={0.35} roughness={0.55} />
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
      <group position={[12.55, 0, -1.6]} rotation={[0, 0.08, 0]}>
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
          <meshStandardMaterial color="#c43828" roughness={0.52} />
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
            <meshStandardMaterial color="#6a5a48" roughness={0.65} />
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
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
    </mesh>
  )
}

function Cart({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.95, 0.42, 0.62]} />
        <meshStandardMaterial color="#6a4030" roughness={0.7} />
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
  const wood = ['#5a3e28', '#6a767c', '#4a5840']
  return (
    <group position={[x, 0, z]}>
      {[0, 0.22, 0.44].map((y, i) => (
        <mesh key={i} position={[(i % 2) * 0.06, 0.12 + y, 0]} rotation={[0, i * 0.18, 0]} castShadow>
          <boxGeometry args={[0.32, 0.2, 0.28]} />
          <meshStandardMaterial color={wood[i % wood.length]} roughness={0.78} metalness={i === 1 ? 0.3 : 0.04} />
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
        <meshStandardMaterial color="#8a5a38" roughness={0.72} />
      </mesh>
    </group>
  )
}

function CourtyardFill() {
  return (
    <group>
      <Barrel x={1.55} z={1.65} color="#5a4030" />
      <Barrel x={-1.45} z={1.55} color="#3a6a88" />
      <Barrel x={1.65} z={-1.55} color="#4a5840" />
      <Barrel x={-1.55} z={-1.45} color="#5a4030" />
      <Cart x={1.92} z={1.55} rot={-0.45} />
      <Cart x={-1.82} z={-1.48} rot={1.15} />
      <CrateStack x={1.72} z={-1.68} />
      <CrateStack x={-1.82} z={1.58} />
      <MarketStall x={2.22} z={0.55} rot={Math.PI / 2} />
      <MarketStall x={-2.22} z={-0.55} rot={-Math.PI / 2} />
      <mesh position={[0.15, 0.42, 2.85]} castShadow>
        <cylinderGeometry args={[0.28, 0.34, 0.7, 10]} />
        <meshStandardMaterial color="#6a7068" metalness={0.35} roughness={0.55} />
      </mesh>
      <ApronTruck />
      <Worker x={0.95} z={3.45} rot={0.5} color="#3a6a88" />
      <Worker x={-1.05} z={3.35} rot={-0.4} color="#c4a046" />
      <Worker x={3.15} z={-0.85} rot={1.2} color="#5a7a50" />
      <Worker x={-3.25} z={0.55} rot={-1.1} color="#8aa0b0" />
      <Worker x={1.55} z={-3.15} rot={2.4} color="#3a6a88" />
      <Worker x={-1.65} z={-3.05} rot={-2.2} color="#c4a046" />
      <group position={[-4.4, 0, 0.8]}>
        {[-0.35, 0.35].map((z) => (
          <mesh key={z} position={[0, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 2.4, 8]} />
            <meshStandardMaterial color="#5a8aa0" metalness={0.35} roughness={0.52} />
          </mesh>
        ))}
      </group>
      <group position={[4.5, 0, 1.1]}>
        {[-0.35, 0.35].map((z) => (
          <mesh key={z} position={[0, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 2.4, 8]} />
            <meshStandardMaterial color="#6a5a48" metalness={0.35} roughness={0.55} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function ApronTruck() {
  return (
    <group position={[-0.4, 0, -4.15]} rotation={[0, 0.35, 0]}>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.95, 0.95]} />
        <meshStandardMaterial color="#c44a28" roughness={0.52} />
      </mesh>
      <mesh position={[-1.15, 0.55, 0]} castShadow>
        <boxGeometry args={[0.6, 0.6, 0.88]} />
        <meshStandardMaterial color="#3a3a38" />
      </mesh>
      {([-0.5, 0.5] as const).map((dx) => (
        <mesh key={dx} position={[dx, 0.22, 0.48]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.16, 8]} />
          <meshStandardMaterial color="#1a1a18" />
        </mesh>
      ))}
    </group>
  )
}

function Worker({ x, z, rot, color }: { x: number; z: number; rot: number; color: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={0.7}>
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.38, 0.48, 0.24]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.98, 0]} castShadow>
        <sphereGeometry args={[0.16, 8, 7]} />
        <meshBasicMaterial color="#f0d0a8" toneMapped={false} />
      </mesh>
      <mesh position={[-0.16, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.28, 3, 6]} />
        <meshBasicMaterial color="#2a2218" toneMapped={false} />
      </mesh>
      <mesh position={[0.16, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.28, 3, 6]} />
        <meshBasicMaterial color="#2a2218" toneMapped={false} />
      </mesh>
      <mesh position={[-0.26, 0.58, 0.02]} rotation={[0, 0, 0.35]} castShadow>
        <capsuleGeometry args={[0.06, 0.28, 3, 6]} />
        <meshBasicMaterial color="#5c3220" toneMapped={false} />
      </mesh>
      <mesh position={[0.26, 0.58, 0.02]} rotation={[0, 0, -0.35]} castShadow>
        <capsuleGeometry args={[0.06, 0.28, 3, 6]} />
        <meshBasicMaterial color="#5c3220" toneMapped={false} />
      </mesh>
    </group>
  )
}

function NorthCourt() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.4, 0.028, -5.85]} receiveShadow>
        <planeGeometry args={[12.6, 8.4]} />
        <meshStandardMaterial color="#3aaa32" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.034, -5.55]} receiveShadow>
        <planeGeometry args={[2.05, 8.2]} />
        <meshStandardMaterial color="#8a6a42" roughness={0.92} />
      </mesh>
      <GardenPlot x={-1.85} z={-3.55} w={2.4} d={1.55} />
      <GardenPlot x={2.05} z={-3.45} w={2.5} d={1.5} />
      <GardenPlot x={-1.65} z={-7.55} w={2.2} d={1.4} />
      <GardenPlot x={1.85} z={-7.45} w={2.3} d={1.35} />
      <Shed x={-3.55} z={-6.35} rot={0.12} />
      <Shed x={3.65} z={-6.15} rot={-0.08} />
      <Shed x={-4.05} z={-8.45} rot={-0.18} />
      <Shed x={4.15} z={-8.25} rot={0.14} />
      <BeamRack x={-4.25} z={-4.15} />
      <BeamRack x={4.35} z={-4.05} />
      <BeamRack x={-5.05} z={-6.95} />
      <Cart x={-2.15} z={-4.85} rot={0.4} />
      <Cart x={2.25} z={-4.75} rot={-0.5} />
      <Cart x={-0.15} z={-6.45} rot={0.15} />
      <Cart x={0.35} z={-8.35} rot={-2.8} />
      <CrateStack x={-3.05} z={-7.85} />
      <CrateStack x={3.15} z={-7.65} />
      <CrateStack x={-1.85} z={-8.95} />
      <CrateStack x={1.95} z={-8.85} />
      <CrateStack x={-5.15} z={-5.15} />
      <CrateStack x={5.25} z={-5.05} />
      <Barrel x={-4.55} z={-5.45} color="#5a4030" />
      <Barrel x={4.65} z={-5.35} color="#3a6a88" />
      <Barrel x={-2.65} z={-7.25} color="#4a5840" />
      <Barrel x={2.75} z={-7.15} color="#5a4030" />
      <Barrel x={-0.85} z={-5.05} color="#3a6a88" />
      <Barrel x={0.95} z={-4.95} color="#5a4030" />
      {[-5.4, -2.7, 0, 2.7, 5.4].map((x) => (
        <mesh key={x} position={[x, 0.7, -9.15]} castShadow>
          <cylinderGeometry args={[0.07, 0.09, 1.4, 6]} />
          <meshStandardMaterial color="#c4a05a" metalness={0.35} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 1.42, -9.15]} castShadow>
        <boxGeometry args={[11.4, 0.06, 0.06]} />
        <meshStandardMaterial color="#c4a05a" metalness={0.35} roughness={0.5} />
      </mesh>
      <Worker x={-2.45} z={-5.55} rot={0.3} color="#3a6a88" />
      <Worker x={2.55} z={-5.45} rot={-0.35} color="#c4a046" />
      <Worker x={-1.15} z={-6.85} rot={1.1} color="#5a7a50" />
      <Worker x={1.25} z={-6.75} rot={-1.2} color="#8aa0b0" />
      <Worker x={-3.35} z={-8.05} rot={0.7} color="#c4a046" />
      <Worker x={3.45} z={-7.95} rot={-0.8} color="#3a6a88" />
      <Bush x={-5.15} z={-7.45} h={1.15} seed={31} />
      <Bush x={5.25} z={-7.25} h={1.05} seed={32} />
      <Bush x={-4.35} z={-3.25} h={1.0} seed={33} />
      <Bush x={4.45} z={-3.15} h={1.1} seed={34} />
      <Bush x={-0.55} z={-3.15} h={0.95} seed={35} />
      <Bush x={0.65} z={-8.95} h={1.05} seed={36} />
      <Pine x={-5.55} z={-8.85} h={2.8} seed={41} />
      <Broadleaf x={5.65} z={-8.65} h={2.5} seed={42} />
      <Cypress x={-5.85} z={-3.65} h={3.1} seed={43} />
      <Willow x={5.95} z={-3.55} h={2.7} seed={44} />
    </group>
  )
}

function GardenPlot({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#6a4a28" roughness={0.94} />
      </mesh>
      {[-0.35, 0.35].map((row, i) =>
        [-0.45, 0, 0.45].map((col, j) => (
          <mesh key={`${i}${j}`} position={[col * (w / 2.4), 0.12, row * (d / 1.4)]} castShadow>
            <sphereGeometry args={[0.12, 6, 5]} />
            <meshStandardMaterial color={j % 2 ? '#3a8c34' : '#2a6a28'} roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  )
}

function Shed({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.35, 1.7, 1.85]} />
        <meshStandardMaterial color="#c45a38" roughness={0.84} />
      </mesh>
      <mesh position={[0, 1.82, 0]} rotation={[0, 0, 0.42]} castShadow>
        <boxGeometry args={[2.7, 0.12, 2.05]} />
        <meshStandardMaterial color="#8a5040" roughness={0.6} />
      </mesh>
      <mesh position={[-0.55, 1.15, 0.95]}>
        <boxGeometry args={[0.7, 0.55, 0.06]} />
        <meshStandardMaterial color="#f0e6d4" roughness={0.55} />
      </mesh>
      <mesh position={[-0.55, 1.15, 0.98]}>
        <boxGeometry args={[0.5, 0.38, 0.04]} />
        <meshStandardMaterial color="#5a88a0" roughness={0.25} />
      </mesh>
      <mesh position={[0.45, 0.7, 0.95]}>
        <boxGeometry args={[0.55, 1.05, 0.08]} />
        <meshStandardMaterial color="#3a1810" />
      </mesh>
      <mesh position={[0, 1.95, 0.2]}>
        <boxGeometry args={[0.55, 0.08, 0.12]} />
        <meshStandardMaterial color="#c4a05a" metalness={0.4} roughness={0.45} />
      </mesh>
    </group>
  )
}

function BeamRack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[-0.45, 0.45].map((sz) => (
        <mesh key={sz} position={[0, 0.55, sz]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 2.4, 8]} />
          <meshStandardMaterial color="#6a5a48" metalness={0.35} roughness={0.55} />
        </mesh>
      ))}
      {[-0.7, 0, 0.7].map((sx) => (
        <mesh key={sx} position={[sx, 0.32, 0]}>
          <boxGeometry args={[0.08, 0.64, 1.05]} />
          <meshStandardMaterial color="#c4a05a" metalness={0.32} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function MillBackLot() {
  return (
    <group>
      <CrateStack x={12.35} z={-3.15} />
      <CrateStack x={12.55} z={-1.05} />
      <CrateStack x={12.25} z={0.85} />
      <CrateStack x={11.45} z={-4.85} />
      <CrateStack x={11.7} z={2.15} />
      <Pallet x={12.15} z={-2.15} y={0.08} />
      <Pallet x={12.45} z={0.05} y={0.08} rot={0.25} />
      <Pallet x={11.85} z={1.55} y={0.08} rot={-0.2} />
      <group position={[12.05, 0, -3.85]}>
        {[-0.32, 0.32].map((z) => (
          <mesh key={z} position={[0, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 2.2, 8]} />
            <meshStandardMaterial color="#6a5a48" metalness={0.35} roughness={0.55} />
          </mesh>
        ))}
      </group>
      <group position={[12.15, 0, 1.65]}>
        {[-0.32, 0.32].map((z) => (
          <mesh key={z} position={[0, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 2.2, 8]} />
            <meshStandardMaterial color="#5a8aa0" metalness={0.4} roughness={0.42} />
          </mesh>
        ))}
      </group>
      <group position={[11.55, 0, -0.35]} rotation={[0, 0.55, 0]}>
        <mesh position={[0, 0.72, 0]} castShadow>
          <boxGeometry args={[1.55, 0.9, 0.88]} />
          <meshStandardMaterial color="#c44a28" roughness={0.52} />
        </mesh>
        <mesh position={[-1.05, 0.52, 0]} castShadow>
          <boxGeometry args={[0.55, 0.55, 0.82]} />
          <meshStandardMaterial color="#3a3a38" />
        </mesh>
        {([-0.45, 0.45] as const).map((dx) => (
          <mesh key={dx} position={[dx, 0.22, 0.44]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.14, 8]} />
            <meshStandardMaterial color="#1a1a18" />
          </mesh>
        ))}
      </group>
      <Cart x={11.2} z={-2.55} rot={1.15} />
      <Cart x={11.35} z={2.45} rot={-0.85} />
      <Barrel x={12.7} z={-4.2} color="#5a4030" />
      <Barrel x={12.85} z={-0.15} color="#3a6a88" />
      <Barrel x={12.55} z={1.95} color="#4a5840" />
      <Barrel x={11.15} z={-5.35} color="#5a4030" />
      <Worker x={10.55} z={-2.45} rot={-0.6} color="#3a6a88" />
      <Worker x={10.75} z={-0.55} rot={0.4} color="#c4a046" />
      <Worker x={10.45} z={1.35} rot={1.3} color="#5a7a50" />
      <Worker x={11.85} z={-3.55} rot={-1.5} color="#8aa0b0" />
      <Worker x={7.15} z={-1.85} rot={0.2} color="#3a6a88" />
      <Worker x={7.35} z={0.15} rot={-0.3} color="#c4a046" />
    </group>
  )
}

function WaterTower() {
  return (
    <group position={[12.4, 0, -10.15]}>
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
        <meshStandardMaterial color="#c8d0d6" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 5.55, 0]} castShadow>
        <coneGeometry args={[1.12, 0.7, 8]} />
        <meshStandardMaterial color="#c45a32" roughness={0.55} />
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
          <meshStandardMaterial color="#5a3e28" roughness={0.78} />
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
