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
      <hemisphereLight args={['#b8cce0', '#5a4834', 0.58]} />
      <ambientLight intensity={0.36} />
      <directionalLight position={[28, 12, 16]} intensity={1.8} color="#ffd39a" castShadow />
      <directionalLight position={[-16, 9, -8]} intensity={0.35} color="#9ab8d0" />
      <fog attach="fog" args={['#8ab4d0', 28, 70]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[28, 28]} />
        <meshStandardMaterial map={dirt} color="#6e563c" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16.4, 16.4]} />
        <meshStandardMaterial map={dirt} color="#8a7058" roughness={0.92} />
      </mesh>

      <HubWalls brick={brick} />
      <DowGate position={DOW_GATE} brick={brick} metal={metal} />
      {LOCKED_MARKETS.map((m) => (
        <LockedGate key={m.id} market={m} brick={brick} metal={metal} dirt={dirt} grass={grass} />
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
      <Sign text="DOW MILL" color="#e8dcc8" y={4.85} />
    </group>
  )
}

function LockedGate({
  market,
  brick,
  metal,
  dirt,
  grass,
}: {
  market: (typeof LOCKED_MARKETS)[number]
  brick: THREE.Texture
  metal: THREE.Texture
  dirt: THREE.Texture
  grass: THREE.Texture
}) {
  if (market.id === 'nasdaq') {
    return (
      <group position={market.position}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
          <circleGeometry args={[3.1, 20]} />
          <meshStandardMaterial map={grass} color="#3a6a40" roughness={0.85} />
        </mesh>
        <mesh position={[-0.85, 1.85, -0.2]} castShadow>
          <boxGeometry args={[1.7, 3.7, 1.5]} />
          <meshStandardMaterial color="#8ab0c8" roughness={0.12} metalness={0.55} />
        </mesh>
        <mesh position={[1.05, 1.35, 0.15]} castShadow>
          <boxGeometry args={[1.35, 2.7, 1.35]} />
          <meshStandardMaterial color="#6a90a8" roughness={0.14} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.08, 1.1]} receiveShadow>
          <boxGeometry args={[2.4, 0.1, 1.4]} />
          <meshStandardMaterial color="#d8d0c4" roughness={0.7} />
        </mesh>
        {[-1.6, 1.6].map((x) => (
          <mesh key={x} position={[x, 0.7, 1.35]}>
            <cylinderGeometry args={[0.06, 0.08, 1.4, 6]} />
            <meshStandardMaterial color="#c4c8cc" metalness={0.5} />
          </mesh>
        ))}
        <Lock y={1.05} z={1.55} />
        <Sign text="CAMPUS" color="#8aa0b4" y={3.85} />
      </group>
    )
  }
  if (market.id === 'gold') {
    return (
      <group position={market.position}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
          <circleGeometry args={[3.2, 16]} />
          <meshStandardMaterial map={dirt} color="#8a6a38" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.55, -0.4]} castShadow>
          <coneGeometry args={[1.8, 1.1, 7]} />
          <meshStandardMaterial map={dirt} color="#6a5030" roughness={0.95} />
        </mesh>
        <mesh position={[-0.85, 2.45, 0]} rotation={[0, 0, 0.42]} castShadow>
          <boxGeometry args={[0.22, 4.2, 0.22]} />
          <meshStandardMaterial color="#c4a070" />
        </mesh>
        <mesh position={[0.85, 2.45, 0]} rotation={[0, 0, -0.42]} castShadow>
          <boxGeometry args={[0.22, 4.2, 0.22]} />
          <meshStandardMaterial color="#c4a070" />
        </mesh>
        <mesh position={[0, 4.35, 0]} castShadow>
          <boxGeometry args={[2.2, 0.18, 0.22]} />
          <meshStandardMaterial color="#a07838" />
        </mesh>
        <mesh position={[0, 4.55, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.55, 0.08, 8, 16]} />
          <meshStandardMaterial color="#c4a046" metalness={0.55} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.85, 1.15]} castShadow>
          <boxGeometry args={[1.2, 1.5, 0.15]} />
          <meshStandardMaterial color="#1a1410" />
        </mesh>
        <mesh position={[1.35, 0.55, 0.9]} castShadow>
          <dodecahedronGeometry args={[0.62, 0]} />
          <meshStandardMaterial color="#e8c04a" metalness={0.55} roughness={0.32} emissive="#c4a046" emissiveIntensity={0.45} />
        </mesh>
        <mesh position={[1.85, 0.38, 1.25]} castShadow>
          <dodecahedronGeometry args={[0.4, 0]} />
          <meshStandardMaterial color="#f0d070" metalness={0.55} roughness={0.3} emissive="#d4a046" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0.9, 0.32, 1.45]} castShadow>
          <dodecahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial color="#c4a046" metalness={0.5} roughness={0.35} />
        </mesh>
        <Lock y={0.95} z={1.35} />
        <Sign text="MINE" color="#e8d080" y={4.05} />
      </group>
    )
  }
  void brick
  return (
    <group position={market.position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[3.15, 16]} />
        <meshStandardMaterial map={dirt} color="#5a4a30" roughness={0.95} />
      </mesh>
      {([
        [-0.95, 0.85, 0.7],
        [0.95, 1.15, 0.85],
        [0.15, 0.55, -0.95],
      ] as Array<[number, number, number]>).map(([x, h, z]) => (
        <mesh key={`${x}${z}`} position={[x, h, z]} castShadow>
          <cylinderGeometry args={[h * 0.55, h * 0.62, h * 2, 14]} />
          <meshStandardMaterial map={metal} color="#6a5040" roughness={0.45} metalness={0.4} />
        </mesh>
      ))}
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} position={[x, 1.7, 0.2]}>
          <boxGeometry args={[0.08, 3.4, 0.08]} />
          <meshStandardMaterial color="#4a4038" metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 3.45, 0.2]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.08, 0.85, 0.08]} />
        <meshStandardMaterial color="#4a4038" />
      </mesh>
      <mesh position={[0, 2.4, 0.55]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 2.2, 8]} />
        <meshStandardMaterial color="#3a3834" metalness={0.5} />
      </mesh>
      <Lock y={0.85} z={1.45} />
      <Sign text="FIELD" color="#c4a090" y={3.55} />
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
