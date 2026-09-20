import { useMemo } from 'react'
import * as THREE from 'three'
import { enterDow } from '../game/gameStore'
import { DOW_GATE, LOCKED_MARKETS, YARD } from '../game/stores'
import { ClashTerrain, ClashWalls, NestedWalls, MorningSun, Pine, Broadleaf, Bush, Cypress, Willow } from './ClashTerrain'
import { useBrickTexture, useDirtTexture, useGrassTexture, useMetalTexture } from './textures'

export function HubWorld() {
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const dirt = useDirtTexture()
  const grass = useGrassTexture()

  return (
    <>
      <color attach="background" args={['#8eccf0']} />
      <MorningSun warm />
      <ClashTerrain wall={YARD} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} receiveShadow>
        <planeGeometry args={[YARD * 2 - 0.55, YARD * 2 - 0.55]} />
        <meshStandardMaterial map={grass} color="#3a8c34" roughness={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 5.2]} receiveShadow>
        <planeGeometry args={[7.4, 9.8]} />
        <meshStandardMaterial map={dirt} color="#8a6840" roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2.8, 0.02, -3.4]} receiveShadow>
        <circleGeometry args={[1.15, 14]} />
        <meshStandardMaterial map={dirt} color="#8a6a40" roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.2, 0.02, 2.1]} receiveShadow>
        <circleGeometry args={[0.95, 12]} />
        <meshStandardMaterial map={dirt} color="#8a6a40" roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 5.4]} receiveShadow>
        <planeGeometry args={[2.6, 8.2]} />
        <meshStandardMaterial map={dirt} color="#a07a4c" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[5.2, 0.022, 1.2]} receiveShadow>
        <planeGeometry args={[2.4, 7.4]} />
        <meshStandardMaterial map={dirt} color="#a07a4c" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[-5.4, 0.022, 1.4]} receiveShadow>
        <planeGeometry args={[2.4, 7.2]} />
        <meshStandardMaterial map={dirt} color="#a07a4c" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, -5.6]} receiveShadow>
        <planeGeometry args={[2.5, 7.6]} />
        <meshStandardMaterial map={dirt} color="#a07a4c" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]} receiveShadow>
        <circleGeometry args={[3.1, 22]} />
        <meshStandardMaterial map={dirt} color="#b08a58" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.4, 0.03, 3.2]} receiveShadow>
        <circleGeometry args={[1.65, 16]} />
        <meshStandardMaterial map={grass} color="#42b838" roughness={0.84} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.6, 0.03, 3.4]} receiveShadow>
        <circleGeometry args={[1.45, 16]} />
        <meshStandardMaterial map={grass} color="#3aaa32" roughness={0.84} />
      </mesh>

      <ClashWalls wall={YARD} brick={brick} />
      <NestedWalls brick={brick} />
      <DowGate position={DOW_GATE} brick={brick} metal={metal} />
      {LOCKED_MARKETS.map((m) => (
        <LockedGate key={m.id} market={m} brick={brick} metal={metal} dirt={dirt} grass={grass} />
      ))}
      <HubDressing />
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
    <group
      position={position}
      rotation={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation()
        enterDow()
      }}
    >
      <mesh position={[0, 2.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.35, 5.1, 5.05]} />
        <meshStandardMaterial map={brick} color="#b84a30" roughness={0.86} />
      </mesh>
      {[-2.15, 0, 2.15].map((x) => (
        <mesh key={x} position={[x, 5.35, 0]} rotation={[0, 0, 0.52]} castShadow>
          <boxGeometry args={[2.85, 0.2, 5.25]} />
          <meshStandardMaterial map={metal} color="#6a5040" roughness={0.62} />
        </mesh>
      ))}
      <mesh position={[0, 5.2, 0]} castShadow>
        <boxGeometry args={[7.65, 0.22, 5.25]} />
        <meshStandardMaterial color="#c45a32" roughness={0.58} />
      </mesh>
      <mesh position={[0, 1.35, 2.58]}>
        <boxGeometry args={[2.15, 2.55, 0.16]} />
        <meshStandardMaterial color="#4a1810" />
      </mesh>
      <mesh position={[0, 1.35, 2.68]}>
        <boxGeometry args={[1.75, 2.15, 0.08]} />
        <meshStandardMaterial color="#3a1008" emissive="#8a4020" emissiveIntensity={0.32} />
      </mesh>
      {[-2.35, -1.15, 1.15, 2.35].map((x) => (
        <group key={x} position={[x, 3.05, 2.55]}>
          <mesh>
            <boxGeometry args={[0.82, 1.05, 0.12]} />
            <meshStandardMaterial color="#f0e6d4" roughness={0.55} />
          </mesh>
          <mesh position={[0, 0, 0.05]}>
            <boxGeometry args={[0.58, 0.78, 0.08]} />
            <meshStandardMaterial color="#2a3a44" roughness={0.28} emissive="#c8a060" emissiveIntensity={0.22} />
          </mesh>
        </group>
      ))}
      <mesh position={[2.35, 7.15, -0.65]} castShadow>
        <cylinderGeometry args={[0.42, 0.55, 4.05, 10]} />
        <meshStandardMaterial map={metal} color="#6a5a48" roughness={0.55} />
      </mesh>
      <mesh position={[2.35, 9.35, -0.65]} castShadow>
        <cylinderGeometry args={[0.52, 0.36, 0.55, 10]} />
        <meshStandardMaterial color="#4a4038" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[1.35, 6.55, -0.85]} castShadow>
        <cylinderGeometry args={[0.28, 0.38, 2.85, 10]} />
        <meshStandardMaterial map={metal} color="#5a4a40" roughness={0.55} />
      </mesh>
      <mesh position={[1.35, 8.15, -0.85]}>
        <cylinderGeometry args={[0.34, 0.24, 0.4, 10]} />
        <meshStandardMaterial color="#4a4038" />
      </mesh>
      {[-3.2, 3.2].map((x) => (
        <group key={x} position={[x, 0, 0.85]}>
          <mesh position={[0, 1.45, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.05, 2.9, 2.35]} />
            <meshStandardMaterial map={brick} color="#a84a32" roughness={0.86} />
          </mesh>
          <mesh position={[0, 3.05, 0]} rotation={[0, 0, x > 0 ? -0.4 : 0.4]} castShadow>
            <boxGeometry args={[2.35, 0.14, 2.55]} />
            <meshStandardMaterial color="#c45a32" roughness={0.58} />
          </mesh>
        </group>
      ))}
      <group position={[0, 0, 3.85]} rotation={[0, 0.08, 0]}>
        <mesh position={[0, 0.28, 0]} receiveShadow>
          <boxGeometry args={[6.4, 0.14, 0.7]} />
          <meshStandardMaterial map={metal} color="#5a5048" metalness={0.4} roughness={0.5} />
        </mesh>
        <mesh position={[1.15, 0.62, 0]} castShadow>
          <boxGeometry args={[1.85, 0.85, 0.85]} />
          <meshStandardMaterial color="#6a4030" roughness={0.7} />
        </mesh>
        <mesh position={[-1.55, 0.62, 0.05]} castShadow>
          <boxGeometry args={[1.55, 0.85, 0.8]} />
          <meshStandardMaterial color="#5a4840" roughness={0.65} />
        </mesh>
        {([-0.55, 0.55, -2.15, -0.95] as const).map((dx) => (
          <mesh key={dx} position={[0.55 + dx, 0.22, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.12, 8]} />
            <meshStandardMaterial color="#1a1a18" />
          </mesh>
        ))}
      </group>
      <mesh position={[2.35, 9.85, -0.65]}>
        <sphereGeometry args={[0.42, 8, 6]} />
        <meshBasicMaterial color="#f4efe4" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <mesh position={[2.55, 10.45, -0.55]}>
        <sphereGeometry args={[0.5, 8, 6]} />
        <meshBasicMaterial color="#f4efe4" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <Sign text="DOW MILL" color="#e8dcc8" y={5.55} z={2.62} w={3.85} />
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
          <meshStandardMaterial map={grass} color="#3aaa32" roughness={0.85} />
        </mesh>
        <mesh position={[-1.25, 2.35, -0.2]} castShadow receiveShadow>
          <boxGeometry args={[2.65, 4.7, 2.35]} />
          <meshStandardMaterial map={brick} color="#d4c4a8" roughness={0.78} />
        </mesh>
        <mesh position={[-1.25, 4.85, -0.2]} rotation={[0, 0, 0.42]} castShadow>
          <boxGeometry args={[3.15, 0.16, 2.55]} />
          <meshStandardMaterial color="#c45a32" roughness={0.58} />
        </mesh>
        <mesh position={[-1.25, 4.85, -0.2]} rotation={[0, 0, -0.42]} castShadow>
          <boxGeometry args={[3.15, 0.16, 2.55]} />
          <meshStandardMaterial color="#c45a32" roughness={0.58} />
        </mesh>
        <mesh position={[1.45, 1.75, 0.25]} castShadow receiveShadow>
          <boxGeometry args={[2.15, 3.5, 2.15]} />
          <meshStandardMaterial map={brick} color="#c8b494" roughness={0.8} />
        </mesh>
        <mesh position={[1.45, 3.62, 0.25]} rotation={[0, 0, 0.4]} castShadow>
          <boxGeometry args={[2.55, 0.14, 2.35]} />
          <meshStandardMaterial color="#c45a32" roughness={0.58} />
        </mesh>
        <mesh position={[0.05, 3.15, -1.65]} castShadow receiveShadow>
          <boxGeometry args={[1.85, 2.1, 1.55]} />
          <meshStandardMaterial map={brick} color="#d8c8ac" roughness={0.78} />
        </mesh>
        <mesh position={[0.05, 4.32, -1.65]} rotation={[0, 0, 0.38]} castShadow>
          <boxGeometry args={[2.2, 0.12, 1.75]} />
          <meshStandardMaterial color="#c45a32" roughness={0.58} />
        </mesh>
        {[-1.85, -0.65].map((x) => (
          <group key={x} position={[x, 2.15, 1.0]}>
            <mesh>
              <boxGeometry args={[0.58, 0.78, 0.08]} />
              <meshStandardMaterial color="#f0e6d4" roughness={0.55} />
            </mesh>
            <mesh position={[0, 0, 0.04]}>
              <boxGeometry args={[0.42, 0.58, 0.05]} />
              <meshStandardMaterial color="#5a88a0" roughness={0.28} />
            </mesh>
          </group>
        ))}
        {[0.85, 1.95].map((x) => (
          <group key={x} position={[x, 1.85, 1.35]}>
            <mesh>
              <boxGeometry args={[0.5, 0.68, 0.08]} />
              <meshStandardMaterial color="#f0e6d4" roughness={0.55} />
            </mesh>
            <mesh position={[0, 0, 0.04]}>
              <boxGeometry args={[0.36, 0.5, 0.05]} />
              <meshStandardMaterial color="#5a88a0" roughness={0.28} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.1, 1.7]} receiveShadow>
          <boxGeometry args={[3.6, 0.12, 2.0]} />
          <meshStandardMaterial color="#d4c4a8" roughness={0.72} />
        </mesh>
        {[-2.05, 2.05].map((x) => (
          <mesh key={x} position={[x, 1.05, 1.95]} castShadow>
            <cylinderGeometry args={[0.09, 0.12, 2.1, 6]} />
            <meshStandardMaterial color="#c4a05a" metalness={0.4} roughness={0.48} />
          </mesh>
        ))}
        <mesh position={[0, 2.25, 1.95]}>
          <boxGeometry args={[4.2, 0.08, 0.08]} />
          <meshStandardMaterial color="#c4a05a" metalness={0.4} />
        </mesh>
        <Lock y={1.15} z={2.15} />
        <Sign text="CAMPUS" color="#e8dcc8" y={4.75} z={1.25} w={1.65} />
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
        <mesh position={[-1.45, 1.55, -1.15]} castShadow receiveShadow>
          <boxGeometry args={[1.85, 3.1, 1.7]} />
          <meshStandardMaterial map={brick} color="#a84a32" roughness={0.86} />
        </mesh>
        <mesh position={[-1.15, 3.15, 0]} rotation={[0, 0, 0.42]} castShadow>
          <boxGeometry args={[0.28, 5.4, 0.28]} />
          <meshStandardMaterial map={metal} color="#6a5a48" roughness={0.55} />
        </mesh>
        <mesh position={[1.15, 3.15, 0]} rotation={[0, 0, -0.42]} castShadow>
          <boxGeometry args={[0.28, 5.4, 0.28]} />
          <meshStandardMaterial map={metal} color="#6a5a48" roughness={0.55} />
        </mesh>
        <mesh position={[0, 5.55, 0]} castShadow>
          <boxGeometry args={[2.9, 0.22, 0.28]} />
          <meshStandardMaterial map={metal} color="#5a5040" roughness={0.55} />
        </mesh>
        <mesh position={[0, 5.85, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.7, 0.1, 8, 16]} />
          <meshStandardMaterial color="#8a7040" metalness={0.45} roughness={0.48} />
        </mesh>
        <mesh position={[0, 1.15, 1.55]} castShadow>
          <boxGeometry args={[1.6, 2.05, 0.18]} />
          <meshStandardMaterial color="#1a1410" />
        </mesh>
        <group position={[1.85, 0, 1.35]} rotation={[0, -0.4, 0]}>
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[0.85, 0.42, 0.55]} />
            <meshStandardMaterial color="#5a4030" roughness={0.7} />
          </mesh>
          {([-0.28, 0.28] as const).map((dx) => (
            <mesh key={dx} position={[dx, 0.16, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.1, 0.1, 0.08, 8]} />
              <meshStandardMaterial color="#2a2a28" />
            </mesh>
          ))}
        </group>
        <group position={[2.45, 0, 1.85]} rotation={[0, 0.5, 0]}>
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[0.85, 0.42, 0.55]} />
            <meshStandardMaterial color="#4a4840" roughness={0.65} />
          </mesh>
        </group>
        <Lock y={1.25} z={1.75} />
        <Sign text="MINES" color="#d4c4a0" y={5.15} z={0.55} w={1.55} />
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
        [-1.45, 1.35, 0.75],
        [1.35, 1.75, 0.95],
        [0.05, 0.95, -1.25],
        [1.85, 0.85, -0.55],
      ] as Array<[number, number, number]>).map(([x, h, z]) => (
        <mesh key={`${x}${z}`} position={[x, h, z]} castShadow receiveShadow>
          <cylinderGeometry args={[h * 0.55, h * 0.65, h * 2, 14]} />
          <meshStandardMaterial map={metal} color="#6a5a48" roughness={0.55} metalness={0.35} />
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
      <Sign text="FIELDS" color="#c4a090" y={4.55} z={1.15} w={1.55} />
    </group>
  )
}

function Lock({ y, z }: { y: number; z: number }) {
  return (
    <mesh position={[0, y, z]} rotation={[0, 0, 0.5]}>
      <torusGeometry args={[0.22, 0.05, 6, 14]} />
      <meshStandardMaterial color="#8a7040" metalness={0.5} roughness={0.48} />
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
          [-13.4, -4.2, 3.8, 'pine'],
          [13.4, -4.0, 3.2, 'oak'],
          [-13.2, 4.4, 4.2, 'cypress'],
          [13.2, 4.6, 2.9, 'willow'],
          [-4.4, 13.2, 3.5, 'oak'],
          [4.6, 13.4, 4.1, 'pine'],
          [-4.2, -13.4, 2.8, 'willow'],
          [4.4, -13.2, 3.6, 'oak'],
          [-10.2, 8.6, 3.1, 'oak'],
          [10.4, 8.8, 2.7, 'cypress'],
          [-9.8, -8.4, 3.4, 'pine'],
          [10.1, -8.2, 2.9, 'oak'],
          [-12.4, 0.6, 3.3, 'willow'],
          [12.6, 0.2, 3.0, 'pine'],
        ] as Array<[number, number, number, 'pine' | 'oak' | 'cypress' | 'willow']>
      ).map(([x, z, h, kind], i) =>
        kind === 'pine' ? (
          <Pine key={i} x={x} z={z} h={h} seed={i + 4} />
        ) : kind === 'cypress' ? (
          <Cypress key={i} x={x} z={z} h={h} seed={i + 6} />
        ) : kind === 'willow' ? (
          <Willow key={i} x={x} z={z} h={h} seed={i + 8} />
        ) : (
          <Broadleaf key={i} x={x} z={z} h={h} seed={i + 5} />
        ),
      )}
      <PlazaYard />
      <MillYard />
      <CampusYard />
      <MineYard />
      <FieldYard />
      <CornerHuts />
    </group>
  )
}

function PlazaYard() {
  return (
    <group>
      <Well />
      <FlowerBed x={2.45} z={0.25} />
      <FlowerBed x={-2.5} z={-0.15} />
      <FlowerBed x={1.25} z={2.15} />
      <FlowerBed x={-1.35} z={2.25} />
      <FlowerBed x={2.15} z={-1.85} />
      <FlowerBed x={-2.05} z={-1.95} />
      <Bush x={2.95} z={1.65} h={0.9} seed={31} />
      <Bush x={-3.05} z={1.55} h={0.95} seed={32} />
      <Bush x={2.75} z={-2.15} h={0.8} seed={33} />
      <Bush x={-2.85} z={-2.05} h={0.85} seed={34} />
      <Broadleaf x={3.35} z={0.85} h={2.45} seed={51} />
      <Willow x={-3.45} z={0.65} h={2.35} seed={52} />
      <Worker x={0.55} z={1.85} rot={0.3} color="#3a6a88" />
      <Worker x={-0.65} z={1.75} rot={-0.4} color="#c4a046" />
      <Worker x={1.15} z={-0.55} rot={1.1} color="#5a7a50" />
    </group>
  )
}

function Well() {
  return (
    <group position={[0.15, 0, -0.35]}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.48, 0.55, 10]} />
        <meshStandardMaterial color="#c8b494" roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.08, 10]} />
        <meshStandardMaterial color="#3a4a50" roughness={0.4} metalness={0.2} />
      </mesh>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.95, 0]} castShadow>
          <boxGeometry args={[0.08, 0.85, 0.08]} />
          <meshStandardMaterial color="#6a4a28" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 1.38, 0]} rotation={[0, 0, 0.2]} castShadow>
        <boxGeometry args={[0.95, 0.08, 0.55]} />
        <meshStandardMaterial color="#c45a32" roughness={0.62} />
      </mesh>
    </group>
  )
}

function MillYard() {
  return (
    <group>
      <MarketStall x={-2.15} z={6.15} rot={0.06} />
      <MarketStall x={2.1} z={6.05} rot={-0.08} />
      <Cart x={0.15} z={6.85} rot={0.1} />
      <Cart x={-1.15} z={8.15} rot={-0.35} />
      <CrateStack x={2.55} z={5.55} />
      <CrateStack x={-2.65} z={5.35} />
      <CrateStack x={3.15} z={7.15} />
      <CrateStack x={-3.05} z={7.45} />
      <Barrel x={-2.45} z={5.45} color="#5a4030" />
      <Barrel x={2.85} z={5.85} color="#3a3a38" />
      <Worker x={0.85} z={5.65} rot={0.2} color="#5a7a50" />
      <Worker x={-0.95} z={5.55} rot={-0.25} color="#8aa0b0" />
      <Worker x={1.55} z={7.25} rot={-0.4} color="#c4a046" />
      <Worker x={-1.65} z={7.15} rot={0.35} color="#3a6a88" />
      <Worker x={0.25} z={8.35} rot={0.1} color="#8aa0b0" />
      <Worker x={2.35} z={8.05} rot={-0.7} color="#5a7a50" />
      <Bush x={-3.15} z={7.15} h={1.05} seed={21} />
      <Bush x={3.05} z={7.05} h={0.95} seed={22} />
    </group>
  )
}

function CampusYard() {
  return (
    <group>
      <MarketStall x={5.55} z={2.85} rot={-Math.PI / 2} />
      <Cart x={5.15} z={0.35} rot={1.2} />
      <CrateStack x={6.05} z={-0.85} />
      <Barrel x={5.45} z={-1.55} color="#3a6a88" />
      <Worker x={5.75} z={1.55} rot={-1.4} color="#8aa0b0" />
      <Worker x={6.15} z={-2.15} rot={2.1} color="#c4a046" />
      <Bush x={7.15} z={3.85} h={1.1} seed={23} />
    </group>
  )
}

function MineYard() {
  return (
    <group>
      <MarketStall x={-1.55} z={-6.25} rot={Math.PI} />
      <MarketStall x={1.45} z={-6.15} rot={Math.PI} />
      <Cart x={0.05} z={-6.85} rot={0.35} />
      <CrateStack x={-2.45} z={-5.55} />
      <Barrel x={2.35} z={-5.45} color="#5a4030" />
      <Worker x={-0.85} z={-5.75} rot={2.8} color="#5a7a50" />
      <Worker x={0.95} z={-5.65} rot={-2.6} color="#3a6a88" />
      <Bush x={-2.85} z={-7.15} h={1.15} seed={24} />
      <Bush x={2.75} z={-6.95} h={1.0} seed={25} />
    </group>
  )
}

function FieldYard() {
  return (
    <group>
      <MarketStall x={-5.65} z={2.65} rot={Math.PI / 2} />
      <Cart x={-5.35} z={0.15} rot={-1.1} />
      <CrateStack x={-6.15} z={-0.95} />
      <Barrel x={-5.55} z={-1.65} color="#3a6a88" />
      <Worker x={-5.85} z={1.35} rot={1.5} color="#8aa0b0" />
      <Worker x={-6.25} z={-2.25} rot={-2.0} color="#c4a046" />
      <group position={[-5.9, 0, -3.15]}>
        <mesh position={[0, 0.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 2.2, 8]} />
          <meshStandardMaterial color="#6a5a48" metalness={0.35} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.5, 0.35]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 2.2, 8]} />
          <meshStandardMaterial color="#5a8aa0" metalness={0.35} roughness={0.52} />
        </mesh>
      </group>
      <Bush x={-7.25} z={3.65} h={1.2} seed={26} />
    </group>
  )
}

function CornerHuts() {
  return (
    <group>
      <Cottage x={-8.55} z={-7.15} rot={0.48} kind={0} />
      <Cottage x={7.35} z={-8.55} rot={-0.18} kind={1} />
      <Cottage x={-11.45} z={-3.85} rot={0.85} kind={2} />
      <Cottage x={10.05} z={-4.85} rot={-0.72} kind={3} />
      <Cottage x={-10.65} z={6.75} rot={0.42} kind={4} />
      <Cottage x={9.85} z={7.15} rot={-0.38} kind={5} />
      <Cottage x={-5.15} z={-10.95} rot={0.08} kind={6} />
      <Cottage x={5.75} z={-11.15} rot={-0.14} kind={7} />
      <Cottage x={-7.65} z={9.15} rot={1.05} kind={8} />
      <Cottage x={7.85} z={8.25} rot={-0.95} kind={9} />
      <Cottage x={-12.15} z={1.85} rot={0.62} kind={7} />
      <Cottage x={11.85} z={2.25} rot={-0.55} kind={0} />
      <Cottage x={-2.15} z={-12.35} rot={0.22} kind={5} />
      <Cottage x={2.45} z={-12.15} rot={-0.28} kind={3} />
      <Cottage x={-12.55} z={8.85} rot={0.9} kind={1} />
      <Cottage x={12.15} z={-7.45} rot={-0.82} kind={6} />
      <StonePath />
      <FenceRun />
      <FlowerBed x={-5.15} z={-8.85} />
      <FlowerBed x={5.25} z={-8.65} />
      <FlowerBed x={-9.15} z={6.55} />
      <FlowerBed x={9.25} z={6.35} />
      <FlowerBed x={-11.2} z={0.4} />
      <FlowerBed x={11.05} z={0.85} />
      <FlowerBed x={-3.4} z={-11.2} />
      <FlowerBed x={3.55} z={-10.95} />
      <FlowerBed x={-8.4} z={4.15} />
      <FlowerBed x={8.55} z={3.85} />
      <Worker x={-7.55} z={-7.25} rot={0.6} color="#5a7a50" />
      <Worker x={7.45} z={-7.05} rot={-0.5} color="#3a6a88" />
      <Worker x={-7.65} z={6.85} rot={1.1} color="#8aa0b0" />
      <Worker x={7.55} z={6.65} rot={-1.2} color="#c4a046" />
      <Worker x={-5.45} z={-9.55} rot={0.4} color="#c4a046" />
      <Worker x={5.55} z={-9.35} rot={-0.35} color="#5a7a50" />
      <Worker x={-8.15} z={5.45} rot={0.2} color="#3a6a88" />
      <Worker x={8.25} z={5.25} rot={-0.15} color="#8aa0b0" />
      <Bush x={-9.45} z={-6.55} h={1.1} seed={41} />
      <Bush x={9.55} z={-6.35} h={1.05} seed={42} />
      <Bush x={-5.65} z={8.85} h={1.15} seed={43} />
      <Bush x={5.75} z={8.65} h={1.0} seed={44} />
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
        <meshStandardMaterial color="#8a5a38" roughness={0.72} />
      </mesh>
    </group>
  )
}

function Cart({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.95, 0.42, 0.62]} />
        <meshStandardMaterial color="#6a4030" roughness={0.7} />
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
  const wood = ['#5a3e28', '#6a767c', '#4a5840']
  return (
    <group position={[x, 0, z]}>
      {[0, 0.22, 0.44].map((y, i) => (
        <mesh key={i} position={[(i % 2) * 0.06, 0.12 + y, 0]} rotation={[0, i * 0.18, 0]} castShadow>
          <boxGeometry args={[0.32, 0.2, 0.28]} />
          <meshStandardMaterial color={wood[i % wood.length]} roughness={0.78} metalness={i === 1 ? 0.3 : 0.04} />
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

function Cottage({ x, z, rot, kind }: { x: number; z: number; rot: number; kind: number }) {
  const cream = '#e4d4b8'
  const terra = '#c45a32'
  const soot = '#8a3a28'
  const sill = '#f0e6d4'
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {kind === 0 && (
        <>
          <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.35, 2.3, 2.05]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[0, 2.55, 0]} rotation={[0, 0, 0.42]} castShadow>
            <boxGeometry args={[2.85, 0.16, 2.35]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <mesh position={[0, 2.55, 0]} rotation={[0, 0, -0.42]} castShadow>
            <boxGeometry args={[2.85, 0.16, 2.35]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <Win x={-0.55} y={1.45} z={1.08} />
          <Win x={0.55} y={1.45} z={1.08} />
          <Door x={0} z={1.1} />
          <Chimney x={0.7} y={3.15} z={-0.2} />
        </>
      )}
      {kind === 1 && (
        <>
          <mesh position={[0, 1.85, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.15, 3.7, 1.95]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[0, 3.85, 0]} rotation={[0, 0, 0.38]} castShadow>
            <boxGeometry args={[2.55, 0.14, 2.2]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <Win x={-0.48} y={2.55} z={1.02} />
          <Win x={0.48} y={2.55} z={1.02} />
          <Win x={-0.48} y={1.35} z={1.02} />
          <Door x={0.35} z={1.04} />
          <mesh position={[0, 2.05, 1.12]} castShadow>
            <boxGeometry args={[1.65, 0.08, 0.45]} />
            <meshStandardMaterial color={sill} roughness={0.7} />
          </mesh>
        </>
      )}
      {kind === 2 && (
        <>
          <mesh position={[0, 1.55, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.85, 3.1, 2.15]} />
            <meshStandardMaterial color={soot} roughness={0.88} />
          </mesh>
          <mesh position={[0, 3.22, 0]} castShadow>
            <boxGeometry args={[3.05, 0.18, 2.35]} />
            <meshStandardMaterial color={cream} roughness={0.55} />
          </mesh>
          <Win x={-0.75} y={2.15} z={1.12} />
          <Win x={0.75} y={2.15} z={1.12} />
          <Door x={0} z={1.14} />
          <Chimney x={-0.85} y={3.85} z={0.15} />
        </>
      )}
      {kind === 3 && (
        <>
          <mesh position={[-0.35, 1.15, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.45, 2.3, 2.25]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[1.15, 0.85, 0.15]} castShadow>
            <boxGeometry args={[1.35, 1.7, 1.65]} />
            <meshStandardMaterial color={soot} roughness={0.86} />
          </mesh>
          <mesh position={[-0.35, 2.45, 0]} rotation={[0, 0, 0.35]} castShadow>
            <boxGeometry args={[2.85, 0.14, 2.45]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <Win x={-0.7} y={1.45} z={1.18} />
          <Door x={0.15} z={1.2} />
        </>
      )}
      {kind === 4 && (
        <>
          <mesh position={[-0.55, 1.35, 0]} castShadow>
            <cylinderGeometry args={[1.05, 1.15, 2.7, 12]} />
            <meshStandardMaterial color={soot} roughness={0.86} />
          </mesh>
          <mesh position={[1.05, 0.95, 0.25]} castShadow receiveShadow>
            <boxGeometry args={[1.55, 1.9, 1.55]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[1.05, 2.05, 0.25]} rotation={[0, 0, 0.4]} castShadow>
            <boxGeometry args={[1.85, 0.12, 1.75]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <Door x={1.05} z={1.08} />
        </>
      )}
      {kind === 5 && (
        <>
          <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
            <boxGeometry args={[3.35, 2.1, 2.25]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[0, 2.35, 0]} rotation={[0, 0, 0.28]} castShadow>
            <boxGeometry args={[3.85, 0.16, 2.55]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <Win x={-1.05} y={1.25} z={1.18} />
          <Win x={0} y={1.25} z={1.18} />
          <Win x={1.05} y={1.25} z={1.18} />
          <Door x={-0.35} z={1.2} />
          <Chimney x={1.25} y={2.95} z={-0.25} />
        </>
      )}
      {kind === 6 && (
        <>
          <mesh position={[0, 2.05, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.95, 4.1, 1.85]} />
            <meshStandardMaterial color={soot} roughness={0.88} />
          </mesh>
          <mesh position={[0, 4.25, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[1.45, 0.85, 4]} />
            <meshStandardMaterial color={terra} roughness={0.62} />
          </mesh>
          <Win x={0} y={2.85} z={0.98} />
          <Win x={0} y={1.65} z={0.98} />
          <Door x={0} z={1.0} />
        </>
      )}
      {kind === 7 && (
        <>
          <mesh position={[-0.45, 1.25, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.25, 2.5, 1.85]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[0.95, 1.05, 0.55]} castShadow>
            <boxGeometry args={[1.55, 2.1, 1.45]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[-0.45, 2.65, 0]} rotation={[0, 0, 0.4]} castShadow>
            <boxGeometry args={[2.65, 0.14, 2.15]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <mesh position={[0.95, 2.25, 0.55]} rotation={[0, 0, -0.35]} castShadow>
            <boxGeometry args={[1.85, 0.12, 1.65]} />
            <meshStandardMaterial color={terra} roughness={0.6} />
          </mesh>
          <Win x={-0.7} y={1.55} z={0.98} />
          <Door x={0.85} z={1.32} />
        </>
      )}
      {kind === 8 && (
        <>
          <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.05, 2.1, 2.05]} />
            <meshStandardMaterial color={cream} roughness={0.8} />
          </mesh>
          <mesh position={[0, 2.35, 0]} castShadow>
            <sphereGeometry args={[1.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={terra} roughness={0.62} />
          </mesh>
          <Win x={-0.45} y={1.25} z={1.08} />
          <Win x={0.45} y={1.25} z={1.08} />
          <Door x={0} z={1.1} />
        </>
      )}
      {kind === 9 && (
        <>
          <mesh position={[0, 1.45, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.55, 2.9, 2.05]} />
            <meshStandardMaterial color={soot} roughness={0.88} />
          </mesh>
          <mesh position={[1.45, 0.85, 0.15]} castShadow>
            <boxGeometry args={[1.15, 1.7, 1.55]} />
            <meshStandardMaterial color={terra} roughness={0.7} />
          </mesh>
          <mesh position={[0, 3.05, 0]} castShadow>
            <boxGeometry args={[2.75, 0.16, 2.25]} />
            <meshStandardMaterial color={cream} roughness={0.55} />
          </mesh>
          <Win x={-0.6} y={1.85} z={1.08} />
          <Win x={0.6} y={1.85} z={1.08} />
          <Door x={-0.2} z={1.1} />
          <Chimney x={0.85} y={3.65} z={-0.35} />
        </>
      )}
    </group>
  )
}

function Win({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh>
        <boxGeometry args={[0.52, 0.62, 0.08]} />
        <meshStandardMaterial color="#f0e6d4" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[0.36, 0.44, 0.05]} />
        <meshStandardMaterial color="#2a3a44" roughness={0.28} />
      </mesh>
    </group>
  )
}

function Door({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.72, z]}>
      <boxGeometry args={[0.55, 1.15, 0.1]} />
      <meshStandardMaterial color="#2a1410" />
    </mesh>
  )
}

function Chimney({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <mesh position={[x, y, z]} castShadow>
      <boxGeometry args={[0.32, 1.05, 0.32]} />
      <meshStandardMaterial color="#4a3028" roughness={0.8} />
    </mesh>
  )
}

function StonePath() {
  const pads: Array<[number, number, number, number, number]> = [
    [0.1, 3.6, 1.35, 5.4, 0],
    [3.4, 1.15, 5.2, 1.15, 0.08],
    [-3.55, 1.05, 5.0, 1.15, -0.06],
    [0.05, -3.8, 1.25, 4.6, 0.04],
  ]
  return (
    <group>
      {pads.map(([x, z, w, d, rot], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, rot]} position={[x, 0.034, z]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color="#c4b49a" roughness={0.82} />
        </mesh>
      ))}
    </group>
  )
}

function FenceRun() {
  const posts: Array<[number, number]> = [
    [-4.8, -8.2],
    [-3.6, -8.6],
    [-2.4, -8.9],
    [4.6, -8.15],
    [3.4, -8.55],
    [2.2, -8.85],
    [-9.8, 4.4],
    [-9.4, 5.5],
    [9.6, 4.2],
    [9.2, 5.35],
  ]
  return (
    <group>
      {posts.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[0.08, 1.1, 0.08]} />
            <meshStandardMaterial color="#6a4a28" roughness={0.8} />
          </mesh>
          <mesh position={[0.45, 0.72, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.06, 0.9, 0.06]} />
            <meshStandardMaterial color="#8a6a40" roughness={0.75} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function FlowerBed({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
        <planeGeometry args={[1.15, 0.85]} />
        <meshStandardMaterial color="#6a4a28" roughness={0.94} />
      </mesh>
      {[-0.28, 0.28].map((dx, i) =>
        [-0.18, 0.18].map((dz, j) => (
          <mesh key={`${i}${j}`} position={[dx, 0.16, dz]} castShadow>
            <sphereGeometry args={[0.12, 6, 5]} />
            <meshStandardMaterial color={i + j === 1 ? '#c45a6a' : '#3a8c34'} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

function Worker({ x, z, rot, color }: { x: number; z: number; rot: number; color: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={1.05}>
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
        <meshBasicMaterial color="#5c3220" toneMapped={false} />
      </mesh>
      <mesh position={[0.26, 0.58, 0.02]} rotation={[0, 0, -0.35]} castShadow>
        <capsuleGeometry args={[0.06, 0.28, 3, 6]} />
        <meshBasicMaterial color="#5c3220" toneMapped={false} />
      </mesh>
    </group>
  )
}
