import { Sky } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { enterDow } from '../game/gameStore'
import { DOW_GATE, LOCKED_MARKETS } from '../game/stores'
import { useBrickTexture, useDirtTexture, useGrassTexture, useMetalTexture } from './textures'

export function HubWorld() {
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const dirt = useDirtTexture()
  const grass = useGrassTexture()

  return (
    <>
      <Sky sunPosition={[28, 12, 16]} turbidity={4.4} rayleigh={0.75} mieCoefficient={0.005} />
      <color attach="background" args={['#6a9cc4']} />
      <fog attach="fog" args={['#7aa8c8', 22, 55]} />
      <hemisphereLight args={['#9eb8d4', '#4a3824', 0.4]} />
      <ambientLight intensity={0.24} />
      <directionalLight position={[28, 12, 16]} intensity={2} color="#ffd39a" castShadow />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[28, 28]} />
        <meshStandardMaterial map={dirt} color="#6e563c" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} receiveShadow>
        <ringGeometry args={[9.2, 12.4, 4]} />
        <meshStandardMaterial map={grass} color="#4e6e34" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16.4, 16.4]} />
        <meshStandardMaterial map={dirt} color="#7a6a58" roughness={0.9} />
      </mesh>

      <HubWalls brick={brick} />
      <DowGate position={DOW_GATE} brick={brick} metal={metal} />
      {LOCKED_MARKETS.map((m) => (
        <LockedGate key={m.id} market={m} brick={brick} metal={metal} />
      ))}
      <HubDressing />
    </>
  )
}

function HubWalls({ brick }: { brick: THREE.Texture }) {
  const t = 8.4
  return (
    <group>
      {([
        [0, -t, t * 2, 0.55],
        [0, t, t * 2, 0.55],
        [-t, 0, 0.55, t * 2],
        [t, 0, 0.55, t * 2],
      ] as Array<[number, number, number, number]>).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.65, z]} castShadow>
          <boxGeometry args={[w, 1.3, d]} />
          <meshStandardMaterial map={brick} color="#a05638" roughness={0.85} />
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
      onClick={(e) => {
        e.stopPropagation()
        enterDow()
      }}
    >
      <mesh position={[0, 2.15, 0]} castShadow>
        <boxGeometry args={[4.4, 4.3, 3.1]} />
        <meshStandardMaterial map={brick} color="#a05034" roughness={0.84} />
      </mesh>
      <mesh position={[0, 1.35, 1.58]}>
        <boxGeometry args={[1.7, 2.5, 0.12]} />
        <meshStandardMaterial color="#5a1810" emissive="#c45c2a" emissiveIntensity={0.55} />
      </mesh>
      <mesh position={[0, 4.45, 0]} castShadow>
        <boxGeometry args={[4.8, 0.35, 3.5]} />
        <meshStandardMaterial map={metal} color="#8a6a38" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[1.4, 5.6, -0.4]} castShadow>
        <cylinderGeometry args={[0.28, 0.35, 2.2, 8]} />
        <meshStandardMaterial map={metal} color="#5a4a40" />
      </mesh>
      <Sign text="DOW" color="#e8dcc8" y={4.85} />
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
  if (market.id === 'nasdaq') {
    return (
      <group position={market.position}>
        <mesh position={[0, 1.7, 0]} castShadow>
          <boxGeometry args={[3.4, 3.4, 2.6]} />
          <meshStandardMaterial color="#2a4058" roughness={0.25} metalness={0.45} />
        </mesh>
        <mesh position={[0, 1.1, 1.35]}>
          <boxGeometry args={[1.1, 1.8, 0.08]} />
          <meshStandardMaterial color="#12181e" />
        </mesh>
        <Lock y={1.2} z={1.42} />
        <Sign text="NASDAQ" color="#8aa0b4" y={3.6} />
      </group>
    )
  }
  if (market.id === 'gold') {
    return (
      <group position={market.position}>
        <mesh position={[0, 1.55, 0]} castShadow>
          <boxGeometry args={[3.6, 3.1, 2.8]} />
          <meshStandardMaterial map={brick} color="#b08a40" roughness={0.7} />
        </mesh>
        <mesh position={[0, 3.25, 0]} castShadow>
          <boxGeometry args={[2.2, 0.7, 2.2]} />
          <meshStandardMaterial color="#c4a046" metalness={0.5} roughness={0.35} />
        </mesh>
        <Lock y={1.15} z={1.45} />
        <Sign text="GOLD" color="#e8d080" y={3.85} />
      </group>
    )
  }
  return (
    <group position={market.position}>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 1.15, 0]} castShadow>
          <cylinderGeometry args={[0.7, 0.75, 2.3, 12]} />
          <meshStandardMaterial map={metal} color="#5a4030" roughness={0.5} />
        </mesh>
      ))}
      <Lock y={0.9} z={1.15} />
      <Sign text="OIL" color="#c4a090" y={2.6} />
    </group>
  )
}

function Lock({ y, z }: { y: number; z: number }) {
  return (
    <mesh position={[0, y, z]} rotation={[0, 0, 0.5]}>
      <torusGeometry args={[0.18, 0.04, 6, 14]} />
      <meshStandardMaterial color="#c4a046" metalness={0.7} roughness={0.3} />
    </mesh>
  )
}

function Sign({ text, color, y }: { text: string; color: string; y: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 96
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#2a2218'
    ctx.fillRect(0, 0, 512, 96)
    ctx.fillStyle = color
    ctx.font = 'bold 48px Bebas Neue, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 50)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [text, color])
  return (
    <mesh position={[0, y, 1.62]}>
      <planeGeometry args={[2.1, 0.4]} />
      <meshStandardMaterial map={tex} roughness={0.55} />
    </mesh>
  )
}

function HubDressing() {
  return (
    <group>
      {([-7.6, 7.6] as const).map((x) =>
        ([-3, 3] as const).map((z) => (
          <group key={`${x}${z}`} position={[x, 0, z]}>
            <mesh position={[0, 0.5, 0]} castShadow>
              <cylinderGeometry args={[0.09, 0.14, 1, 6]} />
              <meshStandardMaterial color="#5a3a22" />
            </mesh>
            <mesh position={[0, 1.7, 0]} castShadow>
              <coneGeometry args={[0.45, 2, 7]} />
              <meshStandardMaterial color="#2e5a28" roughness={0.78} />
            </mesh>
          </group>
        )),
      )}
      <mesh position={[2.4, 0.35, 2.2]} castShadow>
        <boxGeometry args={[0.8, 0.55, 0.7]} />
        <meshStandardMaterial color="#6a4a28" />
      </mesh>
    </group>
  )
}
