import { Billboard } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { enterDow } from '../game/gameStore'
import { DOW_GATE, LOCKED_MARKETS } from '../game/stores'
import { useBrickTexture, useConcreteTexture, useMetalTexture } from './textures'

export function HubWorld() {
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const concrete = useConcreteTexture()

  return (
    <>
      <color attach="background" args={['#141820']} />
      <fog attach="fog" args={['#181c26', 60, 140]} />
      <hemisphereLight args={['#9aaccc', '#1a140e', 0.85]} />
      <ambientLight intensity={0.48} />
      <directionalLight position={[22, 34, 16]} intensity={1.7} color="#e4ecf8" castShadow />
      <pointLight position={[0, 8, 0]} color="#d4a046" intensity={12} distance={22} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[22, 64]} />
        <meshStandardMaterial map={concrete} color="#6e6e76" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[2.2, 2.5, 48]} />
        <meshStandardMaterial color="#d4a046" metalness={0.8} roughness={0.25} />
      </mesh>

      <HubWalls brick={brick} />
      <DowGate position={DOW_GATE} brick={brick} metal={metal} />
      {LOCKED_MARKETS.map((m) => (
        <LockedGate key={m.id} market={m} brick={brick} metal={metal} />
      ))}
    </>
  )
}

function HubWalls({ brick }: { brick: THREE.Texture }) {
  const t = 12
  return (
    <group>
      {([
        [0, -t, t * 2, 0.6],
        [0, t, t * 2, 0.6],
        [-t, 0, 0.6, t * 2],
        [t, 0, 0.6, t * 2],
      ] as Array<[number, number, number, number]>).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.7, z]} castShadow>
          <boxGeometry args={[w, 1.4, d]} />
          <meshStandardMaterial map={brick} color="#4a5060" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function DowGate({
  position,
  brick,
  metal,
}: {
  position: [number, number, number]
  brick: THREE.Texture
  metal: THREE.Texture
}) {
  return (
    <group
      position={position}
      scale={0.48}
      onClick={(e) => {
        e.stopPropagation()
        enterDow()
      }}
    >
      <mesh position={[0, 4.4, 0]} castShadow>
        <boxGeometry args={[9, 8.8, 6]} />
        <meshStandardMaterial map={brick} color="#5a3a30" roughness={0.88} />
      </mesh>
      <mesh position={[0, 2.6, 3.1]}>
        <boxGeometry args={[4.6, 5, 0.25]} />
        <meshStandardMaterial color="#120806" emissive="#e11d48" emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[0, 9.2, 0]} castShadow>
        <boxGeometry args={[10, 1.2, 7]} />
        <meshStandardMaterial map={metal} color="#2a241c" metalness={0.6} roughness={0.4} />
      </mesh>
      <Sign text="DOW  ·  OPEN" color="#ffb070" y={10.4} />
      <pointLight color="#ff6a3a" intensity={14} distance={12} position={[0, 4, 4]} />
    </group>
  )
}

function LockedGate({
  market,
  brick,
}: {
  market: (typeof LOCKED_MARKETS)[number]
  brick: THREE.Texture
  metal: THREE.Texture
}) {
  const tint = market.id === 'nasdaq' ? '#224466' : market.id === 'gold' ? '#6a5a20' : '#3a2a18'
  return (
    <group position={market.position} scale={0.42}>
      <mesh position={[0, 3.6, 0]} castShadow>
        <boxGeometry args={[8, 7.2, 5.2]} />
        <meshStandardMaterial map={brick} color={tint} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.2, 2.7]}>
        <boxGeometry args={[3.4, 4, 0.2]} />
        <meshStandardMaterial color="#080808" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.4, 2.85]} rotation={[0, 0, 0.6]}>
        <torusGeometry args={[0.55, 0.07, 8, 20]} />
        <meshStandardMaterial color="#c9a227" metalness={0.9} roughness={0.25} />
      </mesh>
      <Sign text={`${market.name}  ·  LOCKED`} color="#8a90a0" y={8.2} />
    </group>
  )
}

function Sign({ text, color, y }: { text: string; color: string; y: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 180
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#08090c'
    ctx.fillRect(0, 0, 1024, 180)
    ctx.fillStyle = color
    ctx.font = 'bold 72px Bebas Neue, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(text, 512, 115)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [text, color])
  return (
    <Billboard position={[0, y, 0]} follow>
      <mesh>
        <planeGeometry args={[10, 1.6]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Billboard>
  )
}
