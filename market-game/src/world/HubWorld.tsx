import { useMemo } from 'react'
import * as THREE from 'three'
import { DOW_GATE, LOCKED_MARKETS } from '../game/stores'
import { useBrickTexture, useConcreteTexture, useMetalTexture } from './textures'

export function HubWorld() {
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const concrete = useConcreteTexture()

  return (
    <>
      <color attach="background" args={['#08090e']} />
      <fog attach="fog" args={['#0b0d14', 18, 80]} />
      <hemisphereLight args={['#6a7a98', '#120c08', 0.45]} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[12, 22, 8]} intensity={0.9} color="#c8d4ea" castShadow />
      <pointLight position={[0, 8, 0]} color="#d4a046" intensity={12} distance={28} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[42, 64]} />
        <meshStandardMaterial map={concrete} color="#3a3a42" roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[11, 11.4, 64]} />
        <meshStandardMaterial color="#d4a046" metalness={0.8} roughness={0.25} />
      </mesh>

      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[3.2, 3.6, 0.4, 8]} />
        <meshStandardMaterial color="#16141c" metalness={0.6} roughness={0.4} />
      </mesh>

      <DowGate position={DOW_GATE} brick={brick} metal={metal} />
      {LOCKED_MARKETS.map((m) => (
        <LockedGate key={m.id} market={m} brick={brick} metal={metal} />
      ))}

      <Skyline brick={brick} />
    </>
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
    <group position={position}>
      <mesh position={[0, 5.5, 0]} castShadow>
        <boxGeometry args={[14, 11, 3.2]} />
        <meshStandardMaterial map={brick} color="#5a3a30" roughness={0.88} />
      </mesh>
      <mesh position={[0, 3.2, 1.7]}>
        <boxGeometry args={[6.5, 6.4, 0.3]} />
        <meshStandardMaterial color="#120806" emissive="#e11d48" emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[0, 12.2, 0]} castShadow>
        <boxGeometry args={[16, 1.6, 4]} />
        <meshStandardMaterial map={metal} color="#2a241c" metalness={0.6} roughness={0.4} />
      </mesh>
      <Sign text="DOW  ·  OPEN" color="#ffb070" y={12.2} />
      <pointLight color="#ff6a3a" intensity={20} distance={22} position={[0, 4, 3]} />
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
  const tint = market.id === 'nasdaq' ? '#224466' : market.id === 'gold' ? '#6a5a20' : '#3a2a18'
  return (
    <group position={market.position}>
      <mesh position={[0, 4.6, 0]} castShadow>
        <boxGeometry args={[11, 9.2, 2.6]} />
        <meshStandardMaterial map={brick} color={tint} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.6, 1.4]}>
        <boxGeometry args={[4.2, 5, 0.25]} />
        <meshStandardMaterial color="#080808" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.8, 1.55]} rotation={[0, 0, 0.6]}>
        <torusGeometry args={[0.7, 0.08, 8, 20]} />
        <meshStandardMaterial color="#c9a227" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 10, 0]}>
        <boxGeometry args={[12, 1.3, 3]} />
        <meshStandardMaterial map={metal} color="#1a1a20" metalness={0.55} />
      </mesh>
      <Sign text={`${market.name}  ·  LOCKED`} color="#8a90a0" y={10} />
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
    <mesh position={[0, y, 1.7]}>
      <planeGeometry args={[10, 1.6]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

function Skyline({ brick }: { brick: THREE.Texture }) {
  const buildings = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        x: -50 + i * 5.2,
        z: -38 - (i % 3) * 4,
        w: 3 + (i % 4),
        h: 10 + (i * 7) % 18,
        d: 4,
      })),
    [],
  )
  return (
    <group>
      {buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, b.z]} castShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial map={brick} color="#1c2230" roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}
