import { Billboard, Sky } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { enterDow } from '../game/gameStore'
import { DOW_GATE, LOCKED_MARKETS } from '../game/stores'
import { useBrickTexture, useConcreteTexture, useGrassTexture, useMetalTexture } from './textures'

export function HubWorld() {
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const concrete = useConcreteTexture()
  const grass = useGrassTexture()

  return (
    <>
      <Sky sunPosition={[80, 38, 22]} turbidity={3.6} rayleigh={0.6} mieCoefficient={0.004} />
      <color attach="background" args={['#7ec4f0']} />
      <fog attach="fog" args={['#9fd0f0', 70, 180]} />
      <hemisphereLight args={['#d6eeff', '#c8b080', 1.25]} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[22, 38, 16]} intensity={2.4} color="#fff4dc" castShadow />
      <pointLight position={[0, 8, 0]} color="#ffe08a" intensity={6} distance={22} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial map={grass} color="#86b85a" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial map={concrete} color="#ddd4c6" roughness={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[2.4, 2.75, 48]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.7} roughness={0.28} />
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
  const t = 13.5
  return (
    <group>
      {([
        [0, -t, t * 2, 0.7],
        [0, t, t * 2, 0.7],
        [-t, 0, 0.7, t * 2],
        [t, 0, 0.7, t * 2],
      ] as Array<[number, number, number, number]>).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.8, z]} castShadow>
          <boxGeometry args={[w, 1.6, d]} />
          <meshStandardMaterial map={brick} color="#d88860" roughness={0.8} />
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
      scale={0.62}
      onClick={(e) => {
        e.stopPropagation()
        enterDow()
      }}
    >
      <mesh position={[0, 4.4, 0]} castShadow>
        <boxGeometry args={[9, 8.8, 6]} />
        <meshStandardMaterial map={brick} color="#e09068" roughness={0.82} />
      </mesh>
      <mesh position={[0, 2.6, 3.1]}>
        <boxGeometry args={[4.6, 5, 0.25]} />
        <meshStandardMaterial color="#3a140c" emissive="#e11d48" emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[0, 9.2, 0]} castShadow>
        <boxGeometry args={[10, 1.2, 7]} />
        <meshStandardMaterial map={metal} color="#d4a046" metalness={0.55} roughness={0.38} />
      </mesh>
      <Sign text="DOW  ·  OPEN" color="#ffb070" y={10.4} />
      <pointLight color="#ff8a4a" intensity={10} distance={14} position={[0, 4, 4]} />
    </group>
  )
}

function LockedGate({
  market,
  brick,
  metal,
}: {
  market: (typeof LOCKED_MARKETS)[number]
  brick: THREE.Texture
  metal: THREE.Texture
}) {
  const tint = market.id === 'nasdaq' ? '#4a88b0' : market.id === 'gold' ? '#c4a040' : '#a07048'
  return (
    <group position={market.position} scale={0.55}>
      <mesh position={[0, 3.6, 0]} castShadow>
        <boxGeometry args={[8, 7.2, 5.2]} />
        <meshStandardMaterial map={brick} color={tint} roughness={0.86} />
      </mesh>
      <mesh position={[0, 2.2, 2.7]}>
        <boxGeometry args={[3.4, 4, 0.2]} />
        <meshStandardMaterial color="#2a3038" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.4, 2.85]} rotation={[0, 0, 0.6]}>
        <torusGeometry args={[0.55, 0.07, 8, 20]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 9.2, 0]} castShadow>
        <boxGeometry args={[8.6, 0.35, 5.6]} />
        <meshStandardMaterial map={metal} color="#c8a050" metalness={0.5} roughness={0.4} />
      </mesh>
      <Sign text={`${market.name}  ·  LOCKED`} color="#c8d0dc" y={8.2} />
    </group>
  )
}

function Sign({ text, color, y }: { text: string; color: string; y: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 180
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#1a3048'
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
