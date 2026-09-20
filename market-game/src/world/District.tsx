import { Sky } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { closeInspect, inspectStore, setWalkTarget } from '../game/gameStore'
import { storeAtPoint, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'
import {
  useAsphaltTexture,
  useBrickTexture,
  useConcreteTexture,
  useGrassTexture,
  useMetalTexture,
} from './textures'
import { YardDressing } from './YardDressing'

export function District() {
  const g = useGame()
  const asphalt = useAsphaltTexture()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const concrete = useConcreteTexture()
  const grass = useGrassTexture()
  const dawn = g.phase === 'preopen'
  const sun = dawn ? '#ffe8c4' : '#fff6e4'

  return (
    <>
      <Sky sunPosition={dawn ? [60, 18, 28] : [90, 42, 20]} turbidity={dawn ? 8 : 3.4} rayleigh={dawn ? 1.2 : 0.55} mieCoefficient={0.004} mieDirectionalG={0.8} />
      <hemisphereLight args={['#d6eeff', '#c8b080', dawn ? 1.15 : 1.4]} />
      <ambientLight intensity={dawn ? 1.05 : 1.28} />
      <directionalLight
        position={[38, 54, 24]}
        intensity={dawn ? 2.35 : 2.85}
        color={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={4}
        shadow-camera-far={130}
        shadow-camera-left={-42}
        shadow-camera-right={42}
        shadow-camera-top={42}
        shadow-camera-bottom={-42}
      />
      <fog attach="fog" args={[dawn ? '#c4d8ec' : '#9fd0f0', 90, 260]} />
      <color attach="background" args={[dawn ? '#9ec4e4' : '#7ec4f0']} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial map={grass} roughness={0.9} color="#86b85a" />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation()
          const hit = storeAtPoint(e.point.x, e.point.z, 3.8)
          if (hit) inspectStore(hit.id)
          else {
            closeInspect()
            setWalkTarget(e.point.x, e.point.z)
          }
        }}
      >
        <circleGeometry args={[YARD - 0.2, 56]} />
        <meshStandardMaterial map={concrete} roughness={0.86} color="#ddd4c6" />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <ringGeometry args={[6.4, 9.2, 56]} />
        <meshStandardMaterial map={asphalt} color="#9a968c" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[4.4, 4.9, 56]} />
        <meshStandardMaterial color="#f0c84c" metalness={0.5} roughness={0.32} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.028, 0]}>
        <circleGeometry args={[4.2, 44]} />
        <meshStandardMaterial map={asphalt} color="#9c9890" roughness={0.88} />
      </mesh>

      <YardWalls brick={brick} />
      <BellTower metal={metal} brick={brick} ringing={g.phase === 'opening'} />
      <YardDressing />
      <Lamps on={Math.max(0.45, g.shutter)} />
      <pointLight position={[0, 9, 0]} color="#ffe9b8" intensity={4.5} distance={20} />
    </>
  )
}

function YardWalls({ brick }: { brick: THREE.Texture }) {
  const t = YARD
  const h = 1.7
  const segs: Array<[number, number, number, number]> = [
    [0, -t, t * 2 + 1.6, 0.95],
    [0, t, t * 2 + 1.6, 0.95],
    [-t, 0, 0.95, t * 2],
    [t, 0, 0.95, t * 2],
  ]
  return (
    <group>
      {segs.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial map={brick} color="#e09062" roughness={0.78} />
        </mesh>
      ))}
      {([
        [-t, -t],
        [t, -t],
        [-t, t],
        [t, t],
      ] as Array<[number, number]>).map(([x, z]) => (
        <group key={`${x}${z}`}>
          <mesh position={[x, 2.4, z]} castShadow>
            <boxGeometry args={[1.9, 4.8, 1.9]} />
            <meshStandardMaterial map={brick} color="#d06840" roughness={0.76} />
          </mesh>
          <mesh position={[x, 5.05, z]} castShadow>
            <boxGeometry args={[2.2, 0.4, 2.2]} />
            <meshStandardMaterial color="#e8c04a" metalness={0.45} roughness={0.4} />
          </mesh>
        </group>
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
    <group scale={0.92}>
      <mesh position={[0, 3.6, 0]} castShadow>
        <boxGeometry args={[3.4, 7.2, 3.4]} />
        <meshStandardMaterial map={brick} color="#ee9a68" roughness={0.78} />
      </mesh>
      {[-1.1, 1.1].map((x) =>
        [1.8, 3.6, 5.2].map((y) => (
          <mesh key={`${x}${y}`} position={[x, y, 1.75]}>
            <boxGeometry args={[0.7, 1.05, 0.12]} />
            <meshStandardMaterial color="#7ec8ea" roughness={0.2} metalness={0.15} />
          </mesh>
        )),
      )}
      <mesh position={[0, 7.6, 0]} castShadow>
        <boxGeometry args={[4.3, 1.15, 4.3]} />
        <meshStandardMaterial map={metal} color="#e0b050" metalness={0.5} roughness={0.38} />
      </mesh>
      <mesh ref={bell} position={[0, 6.5, 0]} castShadow>
        <sphereGeometry args={[0.82, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
        <meshPhysicalMaterial color="#f6cc4a" metalness={0.82} roughness={0.2} />
      </mesh>
      <pointLight color="#ffe48a" intensity={ringing ? 16 : 5} distance={16} position={[0, 6.6, 0]} />
    </group>
  )
}

function Lamps({ on }: { on: number }) {
  const spots: Array<[number, number]> = [
    [-6.2, 6.2],
    [6.2, 6.2],
    [-6.2, -6.2],
    [6.2, -6.2],
    [0, 6.8],
    [6.8, 0],
    [-6.8, 0],
    [0, -6.8],
    [-20, 8],
    [20, -8],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 2.05, 0]}>
            <cylinderGeometry args={[0.08, 0.12, 4.1, 8]} />
            <meshStandardMaterial color="#8a8074" metalness={0.55} />
          </mesh>
          <mesh position={[0, 4.15, 0.16]}>
            <boxGeometry args={[0.46, 0.18, 0.64]} />
            <meshStandardMaterial color="#fff6d0" emissive="#ffd88a" emissiveIntensity={0.35 + on * 0.7} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
