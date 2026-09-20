import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/** Dense mill-yard dressing — tanks, beams, pallets, barrels, trees, rail, crane. */
export function YardDressing() {
  return (
    <group>
      <Trees />
      <Tanks />
      <Beams />
      <Pallets />
      <Barrels />
      <Pipes />
      <Ramp />
      <WaterTower />
      <RailCar />
      <Bollards />
      <Chevrons />
      <Containers />
      <Gantry />
      <Scaffold />
      <Hedges />
      <CrateStacks />
    </group>
  )
}

function Trees() {
  const spots: Array<[number, number, number]> = [
    [-21.5, -21.5, 1.15],
    [21.5, -21.5, 1.05],
    [-21.5, 21.5, 1.2],
    [21.5, 21.5, 0.98],
    [-18, 2, 1.08],
    [20.5, 5.5, 1.12],
    [2, -21.8, 1],
    [13.5, 20.5, 1.18],
    [-21.8, 10, 0.95],
    [8, -21.4, 1.1],
    [-6, 21.6, 1.05],
    [21.6, -10, 1.15],
  ]
  return (
    <group>
      {spots.map(([x, z, r], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.75, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.32, 1.5, 8]} />
            <meshStandardMaterial color="#8a5530" roughness={0.88} />
          </mesh>
          <mesh position={[0, 2.15, 0]} castShadow>
            <sphereGeometry args={[r, 10, 8]} />
            <meshStandardMaterial color={i % 2 ? '#5cb04a' : '#48a03c'} roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Tanks() {
  return (
    <group>
      <group position={[18.4, 0, -9.2]}>
        <mesh position={[0, 1.55, 0]} castShadow>
          <cylinderGeometry args={[1.25, 1.25, 3.1, 16]} />
          <meshStandardMaterial color="#ef7a38" metalness={0.38} roughness={0.38} />
        </mesh>
        <mesh position={[0, 3.2, 0]}>
          <cylinderGeometry args={[1.28, 1.28, 0.2, 16]} />
          <meshStandardMaterial color="#f7f2e8" metalness={0.3} roughness={0.42} />
        </mesh>
      </group>
      <group position={[18.4, 0, -5.4]}>
        <mesh position={[0, 1.2, 0]} castShadow>
          <cylinderGeometry args={[1.02, 1.02, 2.4, 14]} />
          <meshStandardMaterial color="#f4d45c" metalness={0.32} roughness={0.42} />
        </mesh>
      </group>
      <group position={[-19.2, 0, 13.6]}>
        <mesh position={[0, 1.75, 0]} castShadow>
          <cylinderGeometry args={[1.12, 1.22, 3.5, 14]} />
          <meshStandardMaterial color="#3cb0d8" metalness={0.42} roughness={0.32} />
        </mesh>
      </group>
      <group position={[-19, 0, -13.4]}>
        <mesh position={[0, 1.3, 0]} castShadow>
          <cylinderGeometry args={[0.9, 0.95, 2.6, 14]} />
          <meshStandardMaterial color="#e85840" metalness={0.35} roughness={0.4} />
        </mesh>
      </group>
    </group>
  )
}

function Beams() {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  const n = 12
  useLayoutEffect(() => {
    if (!ref.current) return
    for (let i = 0; i < n; i++) {
      dummy.position.set(16.6, 0.24 + i * 0.3, 9.4)
      dummy.rotation.set(0, 0.18, 0)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [dummy, n])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} castShadow>
      <boxGeometry args={[3.6, 0.24, 0.48]} />
      <meshStandardMaterial color="#e06838" metalness={0.5} roughness={0.34} />
    </instancedMesh>
  )
}

function Pallets() {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  const spots = useMemo(() => {
    const a: Array<[number, number, number]> = []
    const bases: Array<[number, number]> = [
      [5.6, 4.6],
      [-5.4, 5.4],
      [6.8, -4.8],
      [-5, -5.6],
      [3.8, -1.4],
      [-3.2, 3.4],
      [12.2, 3.4],
      [-8, -2.2],
      [4.2, 8.8],
      [-7.2, 8],
    ]
    for (const [x, z] of bases) {
      for (let i = 0; i < 6; i++) {
        a.push([x + (i % 2) * 0.9, 0.3 + Math.floor(i / 2) * 0.58, z])
      }
    }
    return a
  }, [])
  useLayoutEffect(() => {
    if (!ref.current) return
    spots.forEach((p, i) => {
      dummy.position.set(p[0]!, p[1]!, p[2]!)
      dummy.rotation.set(0, i * 0.28, 0)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [dummy, spots])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} castShadow>
      <boxGeometry args={[0.85, 0.52, 0.85]} />
      <meshStandardMaterial color="#d49842" roughness={0.62} />
    </instancedMesh>
  )
}

function Barrels() {
  const spots: Array<[number, number]> = [
    [5.2, 7.4],
    [6, 7.1],
    [-6.8, 3.8],
    [9, -2.6],
    [-3.6, -8],
    [13.6, 11.2],
    [-12, 4.2],
    [2.2, 8.4],
    [17.8, 1.2],
    [-8.4, -8.8],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.58, z]} castShadow>
          <cylinderGeometry args={[0.4, 0.42, 1.16, 10]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? '#ef4e2c' : i % 3 === 1 ? '#3a98dc' : '#f0c84c'}
            roughness={0.42}
            metalness={0.22}
          />
        </mesh>
      ))}
    </group>
  )
}

function Pipes() {
  return (
    <group>
      <mesh position={[-22.4, 1.15, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 32, 8]} />
        <meshStandardMaterial color="#e07848" metalness={0.5} roughness={0.34} />
      </mesh>
      <mesh position={[22.4, 0.95, 5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 26, 8]} />
        <meshStandardMaterial color="#48b0d8" metalness={0.5} roughness={0.34} />
      </mesh>
      <mesh position={[22.4, 1.45, 5.7]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 18, 8]} />
        <meshStandardMaterial color="#f0c84c" metalness={0.45} roughness={0.36} />
      </mesh>
    </group>
  )
}

function Ramp() {
  return (
    <mesh position={[8.2, 0.38, 1]} rotation={[0, 0.42, -0.18]} castShadow receiveShadow>
      <boxGeometry args={[4.6, 0.2, 2.4]} />
      <meshStandardMaterial color="#e0b048" metalness={0.28} roughness={0.48} />
    </mesh>
  )
}

function WaterTower() {
  return (
    <group position={[19.6, 0, 16.2]}>
      {([
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as Array<[number, number]>).map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 3.5, z]}>
          <cylinderGeometry args={[0.12, 0.14, 7, 8]} />
          <meshStandardMaterial color="#9a8070" metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 7.4, 0]} castShadow>
        <cylinderGeometry args={[1.65, 1.65, 2, 14]} />
        <meshStandardMaterial color="#e05040" metalness={0.35} roughness={0.38} />
      </mesh>
      <mesh position={[0, 8.6, 0]}>
        <coneGeometry args={[1.7, 1, 12]} />
        <meshStandardMaterial color="#a83830" />
      </mesh>
    </group>
  )
}

function RailCar() {
  return (
    <group position={[17.2, 0, 2.4]} rotation={[0, 0.52, 0]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <boxGeometry args={[4.8, 1.5, 1.7]} />
        <meshStandardMaterial color="#d43830" roughness={0.48} />
      </mesh>
      <mesh position={[0, 1.55, 0]}>
        <boxGeometry args={[4.4, 0.18, 1.5]} />
        <meshStandardMaterial color="#f0c84c" metalness={0.3} />
      </mesh>
      {([
        [-1.5, 0.75],
        [-1.5, -0.75],
        [1.5, 0.75],
        [1.5, -0.75],
      ] as Array<[number, number]>).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.24, 10]} />
          <meshStandardMaterial color="#3a3a38" />
        </mesh>
      ))}
    </group>
  )
}

function Bollards() {
  const spots: Array<[number, number]> = [
    [2.6, 2.6],
    [-2.6, 2.6],
    [2.6, -2.6],
    [-2.6, -2.6],
    [8.6, 0],
    [0, 6.6],
    [-8.6, 0],
    [0, -6.6],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.48, z]} castShadow>
          <cylinderGeometry args={[0.15, 0.17, 0.96, 8]} />
          <meshStandardMaterial color={i % 2 ? '#f4d24c' : '#2a2a26'} roughness={0.48} />
        </mesh>
      ))}
    </group>
  )
}

function Chevrons() {
  return (
    <group>
      {[-1.4, 0, 1.4].map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0.2]} position={[4.6, 0.045, z]}>
          <planeGeometry args={[2.6, 0.38]} />
          <meshBasicMaterial color={i % 2 ? '#f4d24c' : '#2a2a26'} />
        </mesh>
      ))}
      {[-1.2, 1.2].map((x, i) => (
        <mesh key={`n${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.045, -4.8]}>
          <planeGeometry args={[0.4, 2.2]} />
          <meshBasicMaterial color="#f4d24c" />
        </mesh>
      ))}
    </group>
  )
}

function Containers() {
  const boxes: Array<[number, number, number, string]> = [
    [19.2, 0, 8.4, '#e23a32'],
    [19.2, 1.55, 8.4, '#2a88c8'],
    [16.4, 0, 18.6, '#f0c84c'],
    [-18.6, 0, -6.2, '#2aa878'],
    [-18.6, 1.55, -6.2, '#e07030'],
  ]
  return (
    <group>
      {boxes.map(([x, y, z, color], i) => (
        <mesh key={i} position={[x, y + 0.75, z]} castShadow>
          <boxGeometry args={[3.4, 1.5, 1.55]} />
          <meshStandardMaterial color={color} roughness={0.48} metalness={0.25} />
        </mesh>
      ))}
    </group>
  )
}

function Gantry() {
  return (
    <group position={[19.4, 0, -16]}>
      <mesh position={[-2.4, 4.2, 0]} castShadow>
        <boxGeometry args={[0.28, 8.4, 0.28]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.45} roughness={0.4} />
      </mesh>
      <mesh position={[2.4, 4.2, 0]} castShadow>
        <boxGeometry args={[0.28, 8.4, 0.28]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.45} roughness={0.4} />
      </mesh>
      <mesh position={[0, 8.5, 0]} castShadow>
        <boxGeometry args={[5.4, 0.28, 0.32]} />
        <meshStandardMaterial color="#ef6a32" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0.6, 6.4, 0]}>
        <boxGeometry args={[1.2, 0.7, 0.9]} />
        <meshStandardMaterial color="#3a98dc" metalness={0.3} />
      </mesh>
      <mesh position={[0.6, 3.2, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 6.2, 6]} />
        <meshStandardMaterial color="#4a4a48" />
      </mesh>
    </group>
  )
}

function Scaffold() {
  return (
    <group position={[12.8, 0, -18.4]}>
      {[0, 1.4, 2.8].map((y) => (
        <mesh key={y} position={[0, 0.2 + y, 0]}>
          <boxGeometry args={[3.2, 0.1, 1.4]} />
          <meshStandardMaterial color="#d4a046" metalness={0.4} roughness={0.45} />
        </mesh>
      ))}
      {[-1.5, 1.5].map((x) => (
        <mesh key={x} position={[x, 1.7, 0.6]}>
          <cylinderGeometry args={[0.06, 0.06, 3.4, 6]} />
          <meshStandardMaterial color="#c8d0d8" metalness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

function Hedges() {
  const spots: Array<[number, number]> = [
    [-23.2, -8],
    [-23.2, 8],
    [23.2, -4],
    [23.2, 12],
    [-12, 23.2],
    [12, 23.2],
    [-12, -23.2],
    [12, -23.2],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.55, z]} castShadow>
          <boxGeometry args={[1.8, 1.1, 0.7]} />
          <meshStandardMaterial color={i % 2 ? '#4aa03c' : '#5cb04a'} roughness={0.78} />
        </mesh>
      ))}
    </group>
  )
}

function CrateStacks() {
  return (
    <group>
      {[
        [1.8, 5.6, '#c45c2a'],
        [-1.4, -5.8, '#3a88c0'],
        [9.6, 5.2, '#d4a046'],
      ].map(([x, z, color], i) => (
        <group key={i} position={[x as number, 0, z as number]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1.1, 0.9, 1.1]} />
            <meshStandardMaterial color={color as string} roughness={0.55} />
          </mesh>
          <mesh position={[0.15, 1.25, 0.1]} castShadow>
            <boxGeometry args={[0.95, 0.7, 0.95]} />
            <meshStandardMaterial color="#e8dcc8" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
