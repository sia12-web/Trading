import { useMemo } from 'react'
import * as THREE from 'three'
import { enterDow } from '../game/gameStore'
import { DOW_GATE, LOCKED_MARKETS, YARD } from '../game/stores'
import { ClashTerrain, MorningSun, Pine } from './ClashTerrain'
import { useBrickTexture, useDirtTexture, useGrassTexture, useMetalTexture } from './textures'

export function HubWorld() {
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const dirt = useDirtTexture()
  const grass = useGrassTexture()

  return (
    <>
      <color attach="background" args={['#6aa8cc']} />
      <MorningSun warm={false} />
      <ClashTerrain wall={YARD} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} receiveShadow>
        <planeGeometry args={[YARD * 2 - 0.55, YARD * 2 - 0.55]} />
        <meshStandardMaterial map={dirt} color="#a88858" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]} receiveShadow>
        <planeGeometry args={[8.4, 8.4]} />
        <meshStandardMaterial map={grass} color="#4aaa38" roughness={0.88} />
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
  const t = YARD
  const h = 1.35
  return (
    <group>
      {([
        [0, -t, t * 2 + 1.2, 0.72],
        [0, t, t * 2 + 1.2, 0.72],
        [-t, 0, 0.72, t * 2],
        [t, 0, 0.72, t * 2],
      ] as Array<[number, number, number, number]>).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial map={brick} color="#c45a38" roughness={0.82} />
        </mesh>
      ))}
      {([
        [-t, -t],
        [t, -t],
        [-t, t],
        [t, t],
      ] as Array<[number, number]>).map(([x, z]) => (
        <group key={`${x}${z}`}>
          <mesh position={[x, 1.7, z]} castShadow receiveShadow>
            <boxGeometry args={[1.35, 3.4, 1.35]} />
            <meshStandardMaterial map={brick} color="#b84a30" roughness={0.82} />
          </mesh>
          <mesh position={[x, 3.5, z]} castShadow>
            <boxGeometry args={[1.55, 0.28, 1.55]} />
            <meshStandardMaterial color="#6a5038" roughness={0.55} metalness={0.25} />
          </mesh>
        </group>
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
      <mesh position={[0, 2.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.2, 4.3, 4.6]} />
        <meshStandardMaterial map={brick} color="#c45432" roughness={0.8} />
      </mesh>
      {[-1.85, 0, 1.85].map((x) => (
        <mesh key={x} position={[x, 4.55, 0]} rotation={[0, 0, 0.58]} castShadow>
          <boxGeometry args={[2.4, 0.16, 4.75]} />
          <meshStandardMaterial map={metal} color="#8a5a38" roughness={0.52} />
        </mesh>
      ))}
      <mesh position={[0, 1.45, 2.35]}>
        <boxGeometry args={[1.9, 2.7, 0.12]} />
        <meshStandardMaterial color="#5a1810" />
      </mesh>
      <mesh position={[0, 1.45, 2.42]}>
        <boxGeometry args={[1.55, 2.15, 0.06]} />
        <meshStandardMaterial color="#3a1008" emissive="#c45828" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 4.55, 0]} castShadow>
        <boxGeometry args={[6.45, 0.18, 4.85]} />
        <meshStandardMaterial color="#c45a32" roughness={0.7} />
      </mesh>
      <mesh position={[2.35, 5.85, -0.55]} castShadow>
        <cylinderGeometry args={[0.32, 0.4, 2.6, 8]} />
        <meshStandardMaterial map={metal} color="#8a6a50" />
      </mesh>
      {[-1.4, 1.4].map((x) => (
        <mesh key={x} position={[x, 2.55, 2.32]}>
          <boxGeometry args={[0.7, 0.85, 0.08]} />
          <meshStandardMaterial color="#2a3a44" roughness={0.25} />
        </mesh>
      ))}
      <Sign text="DOW MILL" color="#e8dcc8" y={5.15} z={2.38} w={3.4} />
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
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
          <circleGeometry args={[4.2, 20]} />
          <meshStandardMaterial map={grass} color="#4aaa40" roughness={0.85} />
        </mesh>
        <mesh position={[-1.15, 2.35, -0.25]} castShadow receiveShadow>
          <boxGeometry args={[2.4, 4.7, 2.15]} />
          <meshStandardMaterial color="#9ac4dc" roughness={0.14} metalness={0.5} />
        </mesh>
        <mesh position={[1.35, 1.75, 0.2]} castShadow receiveShadow>
          <boxGeometry args={[1.9, 3.5, 1.9]} />
          <meshStandardMaterial color="#7aa8c0" roughness={0.16} metalness={0.48} />
        </mesh>
        <mesh position={[0.15, 4.95, -0.1]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[1.55, 1.15, 4]} />
          <meshStandardMaterial color="#6a98b0" />
        </mesh>
        <mesh position={[0, 0.1, 1.55]} receiveShadow>
          <boxGeometry args={[3.2, 0.12, 1.8]} />
          <meshStandardMaterial color="#e8e0d4" roughness={0.7} />
        </mesh>
        {[-1.9, 1.9].map((x) => (
          <mesh key={x} position={[x, 0.9, 1.85]} castShadow>
            <cylinderGeometry args={[0.08, 0.1, 1.8, 6]} />
            <meshStandardMaterial color="#d4d8dc" metalness={0.5} />
          </mesh>
        ))}
        <Lock y={1.15} z={2.05} />
        <Sign text="CAMPUS" color="#8aa0b4" y={4.55} z={1.15} w={2.4} />
      </group>
    )
  }
  if (market.id === 'gold') {
    return (
      <group position={market.position}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
          <circleGeometry args={[4.4, 16]} />
          <meshStandardMaterial map={dirt} color="#c49a50" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.75, -0.5]} castShadow receiveShadow>
          <coneGeometry args={[2.45, 1.5, 7]} />
          <meshStandardMaterial map={dirt} color="#a07838" roughness={0.95} />
        </mesh>
        <mesh position={[-1.15, 3.15, 0]} rotation={[0, 0, 0.42]} castShadow>
          <boxGeometry args={[0.28, 5.4, 0.28]} />
          <meshStandardMaterial color="#e0b060" />
        </mesh>
        <mesh position={[1.15, 3.15, 0]} rotation={[0, 0, -0.42]} castShadow>
          <boxGeometry args={[0.28, 5.4, 0.28]} />
          <meshStandardMaterial color="#e0b060" />
        </mesh>
        <mesh position={[0, 5.55, 0]} castShadow>
          <boxGeometry args={[2.9, 0.22, 0.28]} />
          <meshStandardMaterial color="#c49040" />
        </mesh>
        <mesh position={[0, 5.85, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.7, 0.1, 8, 16]} />
          <meshStandardMaterial color="#e8c04a" metalness={0.55} roughness={0.35} />
        </mesh>
        <mesh position={[0, 1.15, 1.55]} castShadow>
          <boxGeometry args={[1.6, 2.05, 0.18]} />
          <meshStandardMaterial color="#1a1410" />
        </mesh>
        <mesh position={[1.85, 0.72, 1.2]} castShadow>
          <dodecahedronGeometry args={[0.82, 0]} />
          <meshStandardMaterial color="#f0d05a" metalness={0.55} roughness={0.32} />
        </mesh>
        <mesh position={[2.45, 0.48, 1.65]} castShadow>
          <dodecahedronGeometry args={[0.52, 0]} />
          <meshStandardMaterial color="#f4d878" metalness={0.55} roughness={0.3} />
        </mesh>
        <mesh position={[1.2, 0.4, 1.95]} castShadow>
          <dodecahedronGeometry args={[0.36, 0]} />
          <meshStandardMaterial color="#e0b050" metalness={0.5} roughness={0.35} />
        </mesh>
        <Lock y={1.25} z={1.75} />
        <Sign text="MINES" color="#e8d080" y={5.15} z={0.55} w={2.4} />
      </group>
    )
  }
  void brick
  return (
    <group position={market.position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <circleGeometry args={[4.3, 16]} />
        <meshStandardMaterial map={dirt} color="#8a6a40" roughness={0.95} />
      </mesh>
      {([
        [-1.25, 1.15, 0.85],
        [1.25, 1.55, 1.05],
        [0.15, 0.75, -1.15],
      ] as Array<[number, number, number]>).map(([x, h, z]) => (
        <mesh key={`${x}${z}`} position={[x, h, z]} castShadow receiveShadow>
          <cylinderGeometry args={[h * 0.58, h * 0.68, h * 2, 14]} />
          <meshStandardMaterial map={metal} color="#8a6a50" roughness={0.45} metalness={0.4} />
        </mesh>
      ))}
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 2.2, 0.25]} castShadow>
          <boxGeometry args={[0.1, 4.4, 0.1]} />
          <meshStandardMaterial color="#5a5048" metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 4.45, 0.25]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.1, 1.05, 0.1]} />
        <meshStandardMaterial color="#5a5048" />
      </mesh>
      <mesh position={[0, 3.05, 0.7]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 2.8, 8]} />
        <meshStandardMaterial color="#4a4844" metalness={0.5} />
      </mesh>
      <Lock y={1.05} z={1.95} />
      <Sign text="FIELDS" color="#c4a090" y={4.55} z={1.15} w={2.4} />
    </group>
  )
}

function Lock({ y, z }: { y: number; z: number }) {
  return (
    <mesh position={[0, y, z]} rotation={[0, 0, 0.5]}>
      <torusGeometry args={[0.22, 0.05, 6, 14]} />
      <meshStandardMaterial color="#e8c04a" metalness={0.7} roughness={0.3} />
    </mesh>
  )
}

function Sign({ text, color, y, z = 1.62, w = 2.1 }: { text: string; color: string; y: number; z?: number; w?: number }) {
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
    <mesh position={[0, y, z]}>
      <planeGeometry args={[w, 0.45]} />
      <meshStandardMaterial map={tex} roughness={0.55} />
    </mesh>
  )
}

function HubDressing() {
  return (
    <group>
      {(
        [
          [-13.4, -4.2, 3.8],
          [13.4, -4.0, 4.0],
          [-13.2, 4.4, 3.6],
          [13.2, 4.6, 3.9],
          [-4.4, 13.2, 3.5],
          [4.6, 13.4, 3.7],
          [-4.2, -13.4, 3.4],
          [4.4, -13.2, 3.6],
        ] as Array<[number, number, number]>
      ).map(([x, z, h], i) => (
        <Pine key={i} x={x} z={z} h={h} />
      ))}
      {([-2.4, -0.8, 0.8, 2.4] as const).map((x, i) => (
        <MarketStall key={x} x={x} z={2.15} rot={i % 2 ? 0.12 : -0.1} />
      ))}
      <MarketStall x={-3.15} z={0.35} rot={Math.PI / 2} />
      <MarketStall x={3.15} z={-0.25} rot={-Math.PI / 2} />
      <Cart x={1.85} z={3.55} rot={-0.4} />
      <Cart x={-2.05} z={3.35} rot={0.55} />
      <CrateStack x={2.55} z={1.15} />
      <CrateStack x={-2.65} z={1.05} />
      <CrateStack x={0.35} z={-2.85} />
      <Barrel x={1.15} z={-1.85} color="#c45a28" />
      <Barrel x={-1.25} z={-1.65} color="#3a6a88" />
      <Barrel x={0.15} z={-3.35} color="#c4a046" />
      <Barrel x={3.55} z={2.85} color="#8a4030" />
      <Barrel x={-3.45} z={2.65} color="#c45a28" />
      <Worker x={0.85} z={4.15} rot={0.4} color="#ff6a28" />
      <Worker x={-1.15} z={4.05} rot={-0.3} color="#f0c040" />
      <Worker x={2.95} z={-2.15} rot={1.1} color="#e07030" />
      <Worker x={-3.05} z={-1.45} rot={-1.2} color="#8aa0b0" />
      <mesh position={[0.2, 0.42, -1.15]} castShadow>
        <cylinderGeometry args={[0.32, 0.38, 0.72, 10]} />
        <meshStandardMaterial color="#8a9098" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[5.4, 0.12, -2.4]} receiveShadow>
        <boxGeometry args={[2.4, 0.1, 1.1]} />
        <meshStandardMaterial color="#7a9098" metalness={0.35} roughness={0.5} />
      </mesh>
      {[-0.7, 0.1, 0.9].map((x) => (
        <mesh key={x} position={[5.4 + x, 0.48, -2.4]} castShadow>
          <boxGeometry args={[0.65, 0.65, 0.65]} />
          <meshStandardMaterial color="#c46830" roughness={0.65} />
        </mesh>
      ))}
      <group position={[-5.6, 0, -3.2]}>
        <mesh position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 2.8, 8]} />
          <meshStandardMaterial color="#c45a32" metalness={0.4} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.55, 0.4]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 2.8, 8]} />
          <meshStandardMaterial color="#5a8aa0" metalness={0.4} roughness={0.42} />
        </mesh>
      </group>
    </group>
  )
}

function MarketStall({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, 0.12, 0.9]} />
        <meshStandardMaterial color="#b07a40" roughness={0.75} />
      </mesh>
      {[-0.52, 0.52].map((sx) => (
        <mesh key={sx} position={[sx, 0.28, 0.34]}>
          <boxGeometry args={[0.08, 0.55, 0.08]} />
          <meshStandardMaterial color="#6a4a28" />
        </mesh>
      ))}
      <mesh position={[0, 1.08, 0]} rotation={[0, 0, 0.32]} castShadow>
        <boxGeometry args={[1.45, 0.08, 1.0]} />
        <meshStandardMaterial color="#d45830" roughness={0.6} />
      </mesh>
    </group>
  )
}

function Cart({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.95, 0.42, 0.62]} />
        <meshStandardMaterial color="#c45a28" roughness={0.55} />
      </mesh>
      <mesh position={[0.42, 0.55, 0]}>
        <boxGeometry args={[0.12, 0.55, 0.55]} />
        <meshStandardMaterial color="#8a6a38" />
      </mesh>
      {([-0.28, 0.28] as const).map((dx) => (
        <mesh key={dx} position={[dx, 0.16, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.1, 8]} />
          <meshStandardMaterial color="#2a2a28" />
        </mesh>
      ))}
    </group>
  )
}

function CrateStack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[0, 0.38, 0.76].map((y, i) => (
        <mesh key={i} position={[(i % 2) * 0.08, 0.2 + y * 0.55, 0]} rotation={[0, i * 0.2, 0]} castShadow>
          <boxGeometry args={[0.55, 0.38, 0.5]} />
          <meshStandardMaterial color={i % 2 ? '#c46830' : '#3a6a88'} roughness={0.65} />
        </mesh>
      ))}
    </group>
  )
}

function Barrel({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <mesh position={[x, 0.32, z]} castShadow>
      <cylinderGeometry args={[0.2, 0.22, 0.62, 8]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
    </mesh>
  )
}

function Worker({ x, z, rot, color }: { x: number; z: number; rot: number; color: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={0.92}>
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.38, 0.48, 0.24]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.98, 0]} castShadow>
        <sphereGeometry args={[0.16, 8, 7]} />
        <meshBasicMaterial color="#f0d0a8" toneMapped={false} />
      </mesh>
      <mesh position={[-0.16, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.28, 3, 6]} />
        <meshBasicMaterial color="#2a2218" toneMapped={false} />
      </mesh>
      <mesh position={[0.16, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.28, 3, 6]} />
        <meshBasicMaterial color="#2a2218" toneMapped={false} />
      </mesh>
      <mesh position={[-0.26, 0.58, 0.02]} rotation={[0, 0, 0.35]} castShadow>
        <capsuleGeometry args={[0.06, 0.28, 3, 6]} />
        <meshBasicMaterial color="#c44a22" toneMapped={false} />
      </mesh>
      <mesh position={[0.26, 0.58, 0.02]} rotation={[0, 0, -0.35]} castShadow>
        <capsuleGeometry args={[0.06, 0.28, 3, 6]} />
        <meshBasicMaterial color="#c44a22" toneMapped={false} />
      </mesh>
    </group>
  )
}
