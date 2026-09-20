import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGame } from '../ui/useGame'
import { useAsphaltTexture, useBrickTexture, useConcreteTexture, useMetalTexture } from './textures'

export function District() {
  const g = useGame()
  const asphalt = useAsphaltTexture()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const concrete = useConcreteTexture()
  const sunY = g.phase === 'preopen' ? 3 : 18 + g.floorAlive * 8

  return (
    <>
      <hemisphereLight args={['#ffd9a8', '#1a1c22', g.phase === 'preopen' ? 0.55 : 0.85]} />
      <ambientLight intensity={g.phase === 'preopen' ? 0.32 : 0.42} />
      <directionalLight
        position={[-30, sunY, 20]}
        intensity={g.phase === 'preopen' ? 1.05 : 1.85}
        color={g.phase === 'preopen' ? '#c5d4ee' : '#ffd4a8'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={2}
        shadow-camera-far={140}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
      />
      <fog attach="fog" args={[g.phase === 'preopen' ? '#161820' : '#2a221c', 48, 160]} />
      <color attach="background" args={[g.phase === 'preopen' ? '#12141c' : '#241c16']} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[160, 140]} />
        <meshStandardMaterial map={asphalt} roughness={0.92} color="#4a4844" />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[16, 48]} />
        <meshStandardMaterial map={concrete} color="#9a948c" roughness={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[14.2, 14.7, 64]} />
        <meshStandardMaterial color="#d4a046" metalness={0.7} roughness={0.3} />
      </mesh>

      <pointLight position={[0, 9, 0]} color="#ffd27a" intensity={14} distance={28} />
      <pointLight position={[-22, 6, 32]} color="#e11d48" intensity={10} distance={18} />
      <pointLight position={[0, 6, 34]} color="#f59e0b" intensity={12} distance={20} />
      <pointLight position={[22, 6, 32]} color="#38bdf8" intensity={10} distance={18} />
      <pointLight position={[-50, 12, 0]} color="#22d3ee" intensity={16} distance={26} />
      <BellTower metal={metal} brick={brick} ringing={g.phase === 'opening'} />
      <Backdrop brick={brick} metal={metal} />
      <Crates />
      <Lamps on={g.shutter} />
      <Tracks metal={metal} />
      <WaterTower metal={metal} />
      <Fence metal={metal} />
      {g.phase !== 'preopen' && <Dust alive={g.floorAlive} />}
    </>
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
    <group>
      <mesh position={[0, 4.2, 0]} castShadow>
        <boxGeometry args={[3.4, 8.4, 3.4]} />
        <meshStandardMaterial map={brick} roughness={0.9} />
      </mesh>
      <mesh position={[0, 9.1, 0]} castShadow>
        <boxGeometry args={[4.2, 1.4, 4.2]} />
        <meshStandardMaterial map={metal} color="#2c241c" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh ref={bell} position={[0, 7.6, 0]} castShadow>
        <sphereGeometry args={[0.85, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
        <meshPhysicalMaterial color="#c9a227" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 11.4, 0]}>
        <cylinderGeometry args={[0.12, 0.18, 3.2, 8]} />
        <meshStandardMaterial color="#d4a046" metalness={0.7} />
      </mesh>
      <pointLight color="#ffd27a" intensity={ringing ? 20 : 4} distance={18} position={[0, 8, 0]} />
    </group>
  )
}

function Backdrop({ brick, metal }: { brick: THREE.Texture; metal: THREE.Texture }) {
  const blocks = [
    { x: 48, z: 10, w: 18, h: 16, d: 22, c: '#6a5348' },
    { x: 50, z: -22, w: 16, h: 22, d: 18, c: '#4a3a34' },
    { x: 42, z: 32, w: 12, h: 11, d: 14, c: '#5a433c' },
    { x: -8, z: 52, w: 28, h: 14, d: 10, c: '#3e332e' },
    { x: 22, z: 52, w: 18, h: 18, d: 10, c: '#4c3b34' },
    { x: -40, z: 48, w: 20, h: 12, d: 10, c: '#2f343c' },
  ]
  return (
    <group>
      {blocks.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]}>
          <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial map={brick} color={b.c} roughness={0.92} />
          </mesh>
          {i % 2 === 0 && (
            <mesh position={[b.w * 0.25, b.h + 4, 0]} castShadow>
              <cylinderGeometry args={[0.9, 1.2, 8, 10]} />
              <meshStandardMaterial map={metal} color="#2a3036" metalness={0.65} roughness={0.4} />
            </mesh>
          )}
        </group>
      ))}
      {[-18, -6, 8, 20].map((x) => (
        <mesh key={x} position={[x, 7, -58]} castShadow>
          <boxGeometry args={[10, 14, 8]} />
          <meshStandardMaterial map={brick} color="#352e2a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function Crates() {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  const spots = useMemo(() => {
    const a: Array<[number, number, number]> = []
    const pts: Array<[number, number]> = [
      [-12, 18],
      [12, 18],
      [-14, -18],
      [16, -20],
      [8, 6],
      [-32, 12],
      [30, -6],
    ]
    for (const [x, z] of pts) {
      for (let i = 0; i < 5; i++) {
        a.push([x + (i % 3) * 1.15, 0.55 + Math.floor(i / 3) * 1.1, z + Math.floor(i / 3) * 0.2])
      }
    }
    return a
  }, [])
  useFrame(() => {
    if (!ref.current) return
    spots.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2])
      dummy.rotation.set(0, i * 0.2, 0)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} castShadow>
      <boxGeometry args={[1.1, 1.1, 1.1]} />
      <meshStandardMaterial color="#8a5a28" roughness={0.7} />
    </instancedMesh>
  )
}

function Lamps({ on }: { on: number }) {
  const xs = [-16, 16, -16, 16, -36, 32]
  const zs = [16, 16, -16, -16, 0, 0]
  return (
    <group>
      {xs.map((x, i) => (
        <group key={i} position={[x, 0, zs[i]!]}>
          <mesh position={[0, 3.4, 0]}>
            <cylinderGeometry args={[0.08, 0.12, 6.8, 8]} />
            <meshStandardMaterial color="#2a2a28" metalness={0.7} />
          </mesh>
          <mesh position={[0, 6.9, 0.4]}>
            <boxGeometry args={[0.5, 0.2, 0.9]} />
            <meshStandardMaterial
              color="#1a1208"
              emissive="#ffb24a"
              emissiveIntensity={0.4 + on * 2.2}
            />
          </mesh>
          <pointLight color="#ffb45a" intensity={on * 8} distance={14} position={[0, 6.6, 0.5]} />
        </group>
      ))}
    </group>
  )
}

function Tracks({ metal }: { metal: THREE.Texture }) {
  return (
    <group position={[8, 0.05, -8]} rotation={[0, 0.4, 0]}>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.12, 0.08, 70]} />
          <meshStandardMaterial map={metal} color="#8a93a0" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
    </group>
  )
}

function WaterTower({ metal }: { metal: THREE.Texture }) {
  return (
    <group position={[36, 0, -44]}>
      {([
        [-1.6, -1.6],
        [1.6, -1.6],
        [-1.6, 1.6],
        [1.6, 1.6],
      ] as Array<[number, number]>).map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 6, z]}>
          <cylinderGeometry args={[0.15, 0.18, 12, 8]} />
          <meshStandardMaterial color="#4a4038" metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 13, 0]} castShadow>
        <cylinderGeometry args={[2.6, 2.6, 3.4, 16]} />
        <meshStandardMaterial map={metal} color="#6a2a22" metalness={0.45} roughness={0.4} />
      </mesh>
      <mesh position={[0, 15.2, 0]}>
        <coneGeometry args={[2.7, 1.6, 12]} />
        <meshStandardMaterial color="#3a221c" />
      </mesh>
    </group>
  )
}

function Fence({ metal }: { metal: THREE.Texture }) {
  return (
    <group>
      {Array.from({ length: 18 }, (_, i) => (
        <mesh key={i} position={[-64, 1.4, -50 + i * 6]}>
          <boxGeometry args={[0.12, 2.8, 5.6]} />
          <meshStandardMaterial map={metal} color="#2c3238" metalness={0.7} roughness={0.4} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  )
}

function Dust({ alive }: { alive: number }) {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const n = 400
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90
      pos[i * 3 + 1] = Math.random() * 10
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])
  useFrame((s) => {
    if (!ref.current) return
    ref.current.rotation.y = s.clock.elapsedTime * 0.01
    const m = ref.current.material as THREE.PointsMaterial
    m.opacity = 0.12 * alive
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#d8c4a8" size={0.12} transparent opacity={0.1} depthWrite={false} />
    </points>
  )
}
