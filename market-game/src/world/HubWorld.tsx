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
      <Sky sunPosition={[22, 40, 16]} turbidity={1.6} rayleigh={0.3} mieCoefficient={0.003} />
      <color attach="background" args={['#74c8f0']} />
      <hemisphereLight args={['#e8f4ff', '#6a9a48', 1.22]} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[22, 40, 16]} intensity={2.7} color="#fff6d0" castShadow />
      <directionalLight position={[14, 14, 14]} intensity={0.72} color="#fff4dc" />
      <directionalLight position={[-16, 12, -8]} intensity={0.62} color="#b5dcff" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <planeGeometry args={[42, 42]} />
        <meshStandardMaterial map={grass} color="#58b03c" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[15.2, 15.2]} />
        <meshStandardMaterial map={dirt} color="#b08a58" roughness={0.9} />
      </mesh>

      <HubCliffs dirt={dirt} grass={grass} />
      <HubWalls brick={brick} />
      <group scale={1.38} position={[0, 0, -0.35]}>
        <DowGate position={DOW_GATE} brick={brick} metal={metal} />
      </group>
      {LOCKED_MARKETS.map((m) => (
        <group key={m.id} scale={1.22}>
          <LockedGate market={m} brick={brick} metal={metal} dirt={dirt} grass={grass} />
        </group>
      ))}
      <HubDressing />
    </>
  )
}

function HubCliffs({ dirt, grass }: { dirt: THREE.Texture; grass: THREE.Texture }) {
  const blocks: Array<[number, number, number, number, number]> = [
    [-16, -8, 5.2, 2.8, 7],
    [-15.5, 7, 4.8, 2.5, 6.5],
    [16, -7, 5, 2.6, 7],
    [16.2, 8, 4.6, 2.4, 6.2],
    [0, -17, 12, 2.2, 4],
    [7, 17, 8, 2.1, 3.8],
    [-8, 17, 7.5, 2.3, 4],
  ]
  return (
    <group>
      {blocks.map(([x, z, w, h, d], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial map={dirt} color="#9a7a54" roughness={0.92} />
          </mesh>
          <mesh position={[0, h + 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w * 0.92, d * 0.92]} />
            <meshStandardMaterial map={grass} color="#4aa832" roughness={0.84} />
          </mesh>
        </group>
      ))}
    </group>
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
        <mesh key={i} position={[x, 0.7, z]} castShadow>
          <boxGeometry args={[w, 1.4, d]} />
          <meshStandardMaterial map={brick} color="#d45c36" roughness={0.8} emissive="#c44a28" emissiveIntensity={0.12} />
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
        <meshStandardMaterial map={brick} color="#d45432" roughness={0.8} emissive="#c44828" emissiveIntensity={0.16} />
      </mesh>
      <mesh position={[0, 1.35, 1.58]}>
        <boxGeometry args={[1.7, 2.5, 0.12]} />
        <meshStandardMaterial color="#5a1810" emissive="#e07030" emissiveIntensity={0.7} />
      </mesh>
      <mesh position={[0, 4.45, 0]} castShadow>
        <boxGeometry args={[4.8, 0.35, 3.5]} />
        <meshStandardMaterial map={metal} color="#c4a046" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[1.4, 5.6, -0.4]} castShadow>
        <cylinderGeometry args={[0.28, 0.35, 2.2, 8]} />
        <meshStandardMaterial map={metal} color="#8a6a50" />
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
          <meshStandardMaterial map={grass} color="#4aaa40" roughness={0.85} />
        </mesh>
        <mesh position={[-0.85, 1.85, -0.2]} castShadow>
          <boxGeometry args={[1.7, 3.7, 1.5]} />
          <meshStandardMaterial color="#9ac4dc" roughness={0.12} metalness={0.55} emissive="#6a90a8" emissiveIntensity={0.12} />
        </mesh>
        <mesh position={[1.05, 1.35, 0.15]} castShadow>
          <boxGeometry args={[1.35, 2.7, 1.35]} />
          <meshStandardMaterial color="#7aa8c0" roughness={0.14} metalness={0.5} emissive="#4a7088" emissiveIntensity={0.1} />
        </mesh>
        <mesh position={[0, 0.08, 1.1]} receiveShadow>
          <boxGeometry args={[2.4, 0.1, 1.4]} />
          <meshStandardMaterial color="#e8e0d4" roughness={0.7} />
        </mesh>
        {[-1.6, 1.6].map((x) => (
          <mesh key={x} position={[x, 0.7, 1.35]}>
            <cylinderGeometry args={[0.06, 0.08, 1.4, 6]} />
            <meshStandardMaterial color="#d4d8dc" metalness={0.5} />
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
          <meshStandardMaterial map={dirt} color="#c49a50" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.55, -0.4]} castShadow>
          <coneGeometry args={[1.8, 1.1, 7]} />
          <meshStandardMaterial map={dirt} color="#a07838" roughness={0.95} />
        </mesh>
        <mesh position={[-0.85, 2.45, 0]} rotation={[0, 0, 0.42]} castShadow>
          <boxGeometry args={[0.22, 4.2, 0.22]} />
          <meshStandardMaterial color="#e0b060" />
        </mesh>
        <mesh position={[0.85, 2.45, 0]} rotation={[0, 0, -0.42]} castShadow>
          <boxGeometry args={[0.22, 4.2, 0.22]} />
          <meshStandardMaterial color="#e0b060" />
        </mesh>
        <mesh position={[0, 4.35, 0]} castShadow>
          <boxGeometry args={[2.2, 0.18, 0.22]} />
          <meshStandardMaterial color="#c49040" />
        </mesh>
        <mesh position={[0, 4.55, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.55, 0.08, 8, 16]} />
          <meshStandardMaterial color="#e8c04a" metalness={0.55} roughness={0.35} emissive="#c4a046" emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[0, 0.85, 1.15]} castShadow>
          <boxGeometry args={[1.2, 1.5, 0.15]} />
          <meshStandardMaterial color="#1a1410" />
        </mesh>
        <mesh position={[1.35, 0.55, 0.9]} castShadow>
          <dodecahedronGeometry args={[0.62, 0]} />
          <meshStandardMaterial color="#f0d05a" metalness={0.55} roughness={0.32} emissive="#c4a046" emissiveIntensity={0.45} />
        </mesh>
        <mesh position={[1.85, 0.38, 1.25]} castShadow>
          <dodecahedronGeometry args={[0.4, 0]} />
          <meshStandardMaterial color="#f4d878" metalness={0.55} roughness={0.3} emissive="#d4a046" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0.9, 0.32, 1.45]} castShadow>
          <dodecahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial color="#e0b050" metalness={0.5} roughness={0.35} />
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
        <meshStandardMaterial map={dirt} color="#8a6a40" roughness={0.95} />
      </mesh>
      {([
        [-0.95, 0.85, 0.7],
        [0.95, 1.15, 0.85],
        [0.15, 0.55, -0.95],
      ] as Array<[number, number, number]>).map(([x, h, z]) => (
        <mesh key={`${x}${z}`} position={[x, h, z]} castShadow>
          <cylinderGeometry args={[h * 0.55, h * 0.62, h * 2, 14]} />
          <meshStandardMaterial map={metal} color="#8a6a50" roughness={0.45} metalness={0.4} emissive="#4a3828" emissiveIntensity={0.1} />
        </mesh>
      ))}
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} position={[x, 1.7, 0.2]}>
          <boxGeometry args={[0.08, 3.4, 0.08]} />
          <meshStandardMaterial color="#5a5048" metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 3.45, 0.2]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.08, 0.85, 0.08]} />
        <meshStandardMaterial color="#5a5048" />
      </mesh>
      <mesh position={[0, 2.4, 0.55]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 2.2, 8]} />
        <meshStandardMaterial color="#4a4844" metalness={0.5} />
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
      <meshStandardMaterial color="#e8c04a" metalness={0.7} roughness={0.3} emissive="#c4a046" emissiveIntensity={0.2} />
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

function HubPoplar({ x, z, h = 3.8 }: { x: number; z: number; h?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h * 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.16, h * 0.44, 6]} />
        <meshStandardMaterial color="#8a5230" />
      </mesh>
      <mesh position={[0, h * 0.55, 0]} scale={[1, 1.4, 1]} castShadow>
        <sphereGeometry args={[0.7, 8, 7]} />
        <meshStandardMaterial color="#2f8a32" roughness={0.76} emissive="#1e5c20" emissiveIntensity={0.16} />
      </mesh>
      <mesh position={[0.18, h * 0.78, 0.08]} scale={[0.8, 1.1, 0.8]} castShadow>
        <sphereGeometry args={[0.5, 8, 7]} />
        <meshStandardMaterial color="#267828" roughness={0.76} emissive="#184c18" emissiveIntensity={0.12} />
      </mesh>
    </group>
  )
}

function HubDressing() {
  return (
    <group>
      {(
        [
          [-7.8, -3.2, 3.6],
          [7.8, -3.2, 3.8],
          [-7.8, 3.2, 4.0],
          [7.8, 3.2, 3.5],
          [-7.6, 0, 4.2],
          [7.6, 0.4, 3.9],
          [0, 7.8, 3.7],
          [3.4, 7.7, 3.4],
          [-3.4, 7.7, 3.8],
          [-12.5, -8.2, 3.3],
          [12.4, -7.4, 3.5],
          [12.6, 8.2, 3.4],
          [-12.2, 7.2, 3.6],
        ] as Array<[number, number, number]>
      ).map(([x, z, h], i) => (
        <HubPoplar key={i} x={x} z={z} h={h} />
      ))}
      <mesh position={[1.8, 0.35, 1.55]} castShadow>
        <boxGeometry args={[0.85, 0.55, 0.7]} />
        <meshStandardMaterial color="#c46830" />
      </mesh>
      <mesh position={[-1.9, 0.32, 1.7]} castShadow>
        <cylinderGeometry args={[0.22, 0.24, 0.62, 8]} />
        <meshStandardMaterial color="#3a6a88" metalness={0.25} />
      </mesh>
      <mesh position={[1.55, 0.32, -1.4]} castShadow>
        <cylinderGeometry args={[0.22, 0.24, 0.62, 8]} />
        <meshStandardMaterial color="#c45a28" metalness={0.2} />
      </mesh>
      <mesh position={[-0.4, 0.38, 2.35]} castShadow>
        <boxGeometry args={[0.95, 0.42, 0.62]} />
        <meshStandardMaterial color="#c45a28" roughness={0.55} />
      </mesh>
    </group>
  )
}
