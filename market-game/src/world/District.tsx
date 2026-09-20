import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { closeInspect, inspectStore, setWalkTarget } from '../game/gameStore'
import { storeAtPoint, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'
import { useAsphaltTexture, useBrickTexture, useConcreteTexture, useMetalTexture } from './textures'

export function District() {
  const g = useGame()
  const asphalt = useAsphaltTexture()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const concrete = useConcreteTexture()
  const lit = g.phase === 'preopen' ? 0.7 : 1

  return (
    <>
      <hemisphereLight args={['#ffe2b8', '#2a241c', 0.9 * lit]} />
      <ambientLight intensity={0.5 * lit} />
      <directionalLight
        position={[28, 42, 18]}
        intensity={1.9 * lit}
        color={g.phase === 'preopen' ? '#c5d4ee' : '#ffe0b0'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={4}
        shadow-camera-far={90}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
      />
      <fog attach="fog" args={[g.phase === 'preopen' ? '#1a1c24' : '#2c241c', 70, 160]} />
      <color attach="background" args={[g.phase === 'preopen' ? '#151820' : '#2a2018']} />

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation()
          const hit = storeAtPoint(e.point.x, e.point.z, 2.8)
          if (hit) inspectStore(hit.id)
          else {
            closeInspect()
            setWalkTarget(e.point.x, e.point.z)
          }
        }}
      >
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial map={asphalt} roughness={0.92} color="#5a564c" />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <circleGeometry args={[YARD - 0.4, 48]} />
        <meshStandardMaterial map={concrete} color="#8a8478" roughness={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[3.4, 3.75, 48]} />
        <meshStandardMaterial color="#d4a046" metalness={0.7} roughness={0.3} />
      </mesh>

      <YardWalls brick={brick} />
      <BellTower metal={metal} brick={brick} ringing={g.phase === 'opening'} />
      <Crates />
      <Lamps on={g.shutter} />
      <pointLight position={[0, 6, 0]} color="#ffd27a" intensity={10 * lit} distance={16} />
      {g.phase !== 'preopen' && <Dust alive={g.floorAlive} />}
    </>
  )
}

function YardWalls({ brick }: { brick: THREE.Texture }) {
  const t = YARD
  const h = 1.35
  const segs: Array<[number, number, number, number]> = [
    [0, -t, t * 2 + 1.2, 0.7],
    [0, t, t * 2 + 1.2, 0.7],
    [-t, 0, 0.7, t * 2],
    [t, 0, 0.7, t * 2],
  ]
  return (
    <group>
      {segs.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial map={brick} color="#6a5348" roughness={0.9} />
        </mesh>
      ))}
      {([
        [-t, -t],
        [t, -t],
        [-t, t],
        [t, t],
      ] as Array<[number, number]>).map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 1.7, z]} castShadow>
          <boxGeometry args={[1.3, 3.4, 1.3]} />
          <meshStandardMaterial map={brick} color="#4a3a34" roughness={0.88} />
        </mesh>
      ))}
    </group>
  )
}

function BellTower({
  metal,
  brick,
  ringing,
}: {
  metal: THREE.Texture
  brick: THREE.Texture
  ringing: boolean
}) {
  const bell = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (!bell.current) return
    bell.current.rotation.z = ringing ? Math.sin(s.clock.elapsedTime * 9) * 0.28 : 0
  })
  return (
    <group scale={0.55}>
      <mesh position={[0, 3.4, 0]} castShadow>
        <boxGeometry args={[3.2, 6.8, 3.2]} />
        <meshStandardMaterial map={brick} roughness={0.9} />
      </mesh>
      <mesh position={[0, 7.2, 0]} castShadow>
        <boxGeometry args={[4, 1.1, 4]} />
        <meshStandardMaterial map={metal} color="#2c241c" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh ref={bell} position={[0, 6.2, 0]} castShadow>
        <sphereGeometry args={[0.75, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
        <meshPhysicalMaterial color="#c9a227" metalness={0.9} roughness={0.25} />
      </mesh>
      <pointLight color="#ffd27a" intensity={ringing ? 16 : 5} distance={12} position={[0, 6.4, 0]} />
    </group>
  )
}

function Crates() {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  const spots = useMemo(() => {
    const a: Array<[number, number, number]> = []
    const pts: Array<[number, number]> = [
      [4.2, 3.4],
      [-3.6, 4],
      [4.8, -3.2],
      [-4.2, -3.6],
    ]
    for (const [x, z] of pts) {
      for (let i = 0; i < 4; i++) {
        a.push([x + (i % 2) * 0.7, 0.32 + Math.floor(i / 2) * 0.65, z])
      }
    }
    return a
  }, [])
  useFrame(() => {
    if (!ref.current) return
    spots.forEach((p, i) => {
      dummy.position.set(p[0]!, p[1]!, p[2]!)
      dummy.rotation.set(0, i * 0.2, 0)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} castShadow>
      <boxGeometry args={[0.65, 0.65, 0.65]} />
      <meshStandardMaterial color="#8a5a28" roughness={0.7} />
    </instancedMesh>
  )
}

function Lamps({ on }: { on: number }) {
  const spots: Array<[number, number]> = [
    [-5, 5],
    [5, 5],
    [-5, -5],
    [5, -5],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.7, 0]}>
            <cylinderGeometry args={[0.06, 0.09, 3.4, 8]} />
            <meshStandardMaterial color="#2a2a28" metalness={0.7} />
          </mesh>
          <mesh position={[0, 3.45, 0.15]}>
            <boxGeometry args={[0.35, 0.14, 0.55]} />
            <meshStandardMaterial color="#1a1208" emissive="#ffb24a" emissiveIntensity={0.5 + on * 2} />
          </mesh>
          <pointLight color="#ffb45a" intensity={on * 5} distance={8} position={[0, 3.3, 0.2]} />
        </group>
      ))}
    </group>
  )
}

function Dust({ alive }: { alive: number }) {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const n = 180
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28
      pos[i * 3 + 1] = Math.random() * 5
      pos[i * 3 + 2] = (Math.random() - 0.5) * 28
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])
  useFrame((s) => {
    if (!ref.current) return
    ref.current.rotation.y = s.clock.elapsedTime * 0.01
    const m = ref.current.material as THREE.PointsMaterial
    m.opacity = 0.14 * alive
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#d8c4a8" size={0.1} transparent opacity={0.1} depthWrite={false} />
    </points>
  )
}
