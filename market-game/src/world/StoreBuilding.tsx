import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fmtPx, rangeHeight } from '../game/auction'
import { advertisedPrice, inspectStore, marketWorld, stallState } from '../game/gameStore'
import type { AnchoredVwap, StoreDef, VolumeProfile } from '../game/types'
import { useGame } from '../ui/useGame'
import { makeChalkTexture, makeFasciaTexture, useBrickTexture, useMetalTexture } from './textures'

type Stall = ReturnType<typeof stallState>

export function StoreBuilding({ store }: { store: StoreDef }) {
  const g = useGame()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const price = advertisedPrice(store.id, g)
  const st = stallState(store.id, g)
  const hot = g.nearby === store.id || g.inspecting === store.id
  const printed = Boolean(g.lastPrint && g.lastPrint.storeId === store.id && performance.now() - g.lastPrint.at < 1400)
  const range = profileRange(store, g.avwap)
  const short = store.name.split(' ')[0] ?? store.name
  const yaw = store.range === 'fiveMonth' ? -Math.PI / 2 : 0

  return (
    <group
      position={store.position}
      rotation={[0, yaw, 0]}
      onClick={(e) => {
        e.stopPropagation()
        inspectStore(store.id)
      }}
    >
      {store.building === 'foundry' && <Foundry brick={brick} metal={metal} stall={st} />}
      {store.building === 'hall' && <Hall brick={brick} metal={metal} stall={st} />}
      {store.building === 'dock' && <Dock metal={metal} stall={st} />}
      {store.building === 'yard' && <Yard metal={metal} brick={brick} stall={st} />}
      {store.building === 'mill' && <Mill brick={brick} metal={metal} stall={st} />}
      {store.building === 'alley' && <Alley metal={metal} stall={st} />}
      {store.building === 'spire' && <Spire metal={metal} avwap={g.avwap} stall={st} />}
      {store.building === 'loft' && <Loft metal={metal} avwap={g.avwap} stall={st} />}
      {store.building === 'pit' && <Pit metal={metal} avwap={g.avwap} stall={st} />}
      {store.building !== 'spire' && store.building !== 'pit' && (
        <RangeRails range={range} nodePx={price} color={store.accent} width={store.building === 'loft' ? 3.2 : 4.7} />
      )}
      <Fascia
        title={short}
        paint={store.accent}
        y={store.building === 'spire' ? 3.05 : store.building === 'pit' ? 1.55 : store.building === 'loft' ? 2.85 : 2.55}
        z={store.building === 'spire' ? 1.15 : store.building === 'loft' || store.building === 'pit' ? 1.72 : 2.22}
      />
      <ChalkBoard price={fmtPx(price)} y={store.building === 'pit' ? 1.15 : 1.45} z={store.building === 'spire' ? 1.05 : 2.28} pulse={printed} />
      <GoodsPile stall={st} kind={store.kind} z={store.building === 'spire' ? 1.15 : 2.55} />
      {hot && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.15, 2.38, 28]} />
          <meshBasicMaterial color="#d4a046" transparent opacity={0.88} />
        </mesh>
      )}
    </group>
  )
}

function profileRange(store: StoreDef, avwap: AnchoredVwap) {
  if (store.range === 'yesterday') return wingRange(marketWorld.yesterday)
  if (store.range === 'fiveDay') return wingRange(marketWorld.fiveDay)
  return { lo: avwap.lower2, hi: avwap.upper2, val: avwap.lower1, vah: avwap.upper1 }
}

function wingRange(p: VolumeProfile) {
  return { lo: p.low, hi: p.high, val: p.val, vah: p.vah }
}

function RangeRails({
  range,
  nodePx,
  color,
  width,
}: {
  range: { lo: number; hi: number; val: number; vah: number }
  nodePx: number
  color: string
  width: number
}) {
  const yLo = rangeHeight(range.lo, range.lo, range.hi)
  const yHi = rangeHeight(range.hi, range.lo, range.hi)
  const yVal = rangeHeight(range.val, range.lo, range.hi)
  const yVah = rangeHeight(range.vah, range.lo, range.hi)
  const yNode = rangeHeight(nodePx, range.lo, range.hi)
  const bandH = Math.max(0.14, yVah - yVal)
  return (
    <group>
      <mesh position={[0, yHi, 2.08]} castShadow>
        <boxGeometry args={[width, 0.14, 0.14]} />
        <meshStandardMaterial color="#c4a046" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, yLo, 2.08]}>
        <boxGeometry args={[width, 0.14, 0.14]} />
        <meshStandardMaterial color="#4a3428" metalness={0.25} roughness={0.55} />
      </mesh>
      <mesh position={[0, (yVah + yVal) / 2, 2.04]}>
        <boxGeometry args={[width * 0.9, bandH, 0.05]} />
        <meshStandardMaterial color={color} transparent opacity={0.38} roughness={0.55} />
      </mesh>
      <mesh position={[0, yNode, 0.15]} receiveShadow>
        <boxGeometry args={[width * 0.48, 0.07, 2.2]} />
        <meshStandardMaterial color="#8a7a58" roughness={0.6} metalness={0.15} />
      </mesh>
      {([-width / 2, width / 2] as const).map((x) => (
        <mesh key={x} position={[x, (yHi + yLo) / 2, 2.08]}>
          <boxGeometry args={[0.09, yHi - yLo + 0.22, 0.09]} />
          <meshStandardMaterial color="#3a342e" />
        </mesh>
      ))}
    </group>
  )
}

function Fascia({ title, paint, y, z }: { title: string; paint: string; y: number; z: number }) {
  const tex = useMemo(() => makeFasciaTexture(title, paint), [title, paint])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[0, y, z]}>
      <planeGeometry args={[2.85, 0.52]} />
      <meshStandardMaterial map={tex} roughness={0.55} />
    </mesh>
  )
}

function ChalkBoard({ price, y, z, pulse }: { price: string; y: number; z: number; pulse: boolean }) {
  const tex = useMemo(() => makeChalkTexture(price), [price])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group position={[1.15, y, z]}>
      <mesh position={[0, 0, -0.03]}>
        <boxGeometry args={[0.95, 0.62, 0.06]} />
        <meshStandardMaterial color="#3a2a18" roughness={0.8} />
      </mesh>
      <mesh>
        <planeGeometry args={[0.86, 0.52]} />
        <meshStandardMaterial map={tex} roughness={0.7} />
      </mesh>
      {pulse && <pointLight color="#e8c04a" intensity={4.5} distance={3.4} />}
    </group>
  )
}

function GoodsPile({ stall, kind, z }: { stall: Stall; kind: StoreDef['kind']; z: number }) {
  const n = kind === 'lvn' ? (stall.clogged ? 7 : 0) : Math.round(stall.occupancy * 8)
  if (n <= 0) return stall.hollow ? <EmptyRacks z={z} /> : null
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh
          key={i}
          position={[-1.55 + (i % 4) * 0.38, 0.16 + Math.floor(i / 4) * 0.28, z + (i % 3) * 0.12]}
          castShadow
        >
          <boxGeometry args={[0.32, 0.22, 0.28]} />
          <meshStandardMaterial color={kind === 'lvn' ? '#6a5040' : i % 2 ? '#8a4a28' : '#4a5a48'} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

function EmptyRacks({ z }: { z: number }) {
  return (
    <group position={[0, 0.55, z]}>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.08, 1.1, 0.7]} />
          <meshStandardMaterial color="#4a4038" />
        </mesh>
      ))}
      {[0.2, 0.55].map((y) => (
        <mesh key={y} position={[0, y - 0.4, 0]}>
          <boxGeometry args={[1.2, 0.04, 0.65]} />
          <meshStandardMaterial color="#5a5048" />
        </mesh>
      ))}
    </group>
  )
}

function RollDoor({ width, height, open, z }: { width: number; height: number; open: number; z: number }) {
  const h = height * (1 - open * 0.88)
  return (
    <mesh position={[0, h / 2 + 0.08, z]} castShadow>
      <boxGeometry args={[width, Math.max(0.08, h), 0.08]} />
      <meshStandardMaterial color="#3a3834" metalness={0.35} roughness={0.5} />
    </mesh>
  )
}

function WindowRow({
  xs,
  y,
  z,
  lit,
}: {
  xs: number[]
  y: number
  z: number
  lit: number
}) {
  return (
    <>
      {xs.map((x) => (
        <mesh key={x} position={[x, y, z]}>
          <boxGeometry args={[0.42, 0.55, 0.06]} />
          <meshStandardMaterial
            color="#2c3c46"
            roughness={0.22}
            metalness={0.15}
            emissive="#c8a060"
            emissiveIntensity={lit * 0.55}
          />
        </mesh>
      ))}
    </>
  )
}

function Cornice({ w, d, y, color = '#6a4030' }: { w: number; d: number; y: number; color?: string }) {
  return (
    <mesh position={[0, y, 0]} castShadow>
      <boxGeometry args={[w, 0.16, d]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  )
}

function Foundry({ brick, metal, stall }: { brick: THREE.Texture; metal: THREE.Texture; stall: Stall }) {
  const glow = 0.12 + stall.occupancy * 1.35
  return (
    <group>
      <mesh position={[0, 1.85, -0.15]} castShadow receiveShadow>
        <boxGeometry args={[5.15, 3.7, 4.15]} />
        <meshStandardMaterial map={brick} color={stall.hollow ? '#6a4034' : '#a05034'} roughness={0.86} />
      </mesh>
      <Cornice w={5.4} d={4.4} y={3.78} />
      <WindowRow xs={[-1.7, -0.85, 0.85, 1.7]} y={2.55} z={2.1} lit={stall.interior} />
      <mesh position={[-1.55, 0.95, 2.05]}>
        <boxGeometry args={[1.5, 1.7, 0.1]} />
        <meshStandardMaterial color="#1a1210" roughness={0.5} />
      </mesh>
      <RollDoor width={1.7} height={1.85} open={stall.door} z={2.12} />
      {[-1.15, 1.15].map((x) => (
        <group key={x} position={[x, 0, 1.55]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.78, 1.4, 10]} />
            <meshStandardMaterial color="#4a3028" metalness={0.35} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.45, 0.15]}>
            <boxGeometry args={[0.7, 0.35, 0.5]} />
            <meshStandardMaterial color="#2a1814" emissive="#c45c2a" emissiveIntensity={glow} />
          </mesh>
        </group>
      ))}
      <mesh position={[1.55, 5.15, -0.85]} castShadow>
        <cylinderGeometry args={[0.38, 0.48, 4.4, 10]} />
        <meshStandardMaterial map={metal} color="#5a4a40" metalness={0.45} roughness={0.48} />
      </mesh>
      <mesh position={[1.55, 7.4, -0.85]}>
        <cylinderGeometry args={[0.52, 0.4, 0.28, 10]} />
        <meshStandardMaterial color="#4a3830" />
      </mesh>
      <mesh position={[1.55, 3.95, -0.85]}>
        <torusGeometry args={[0.5, 0.05, 6, 12]} />
        <meshStandardMaterial color="#3a3028" />
      </mesh>
      <mesh position={[-1.6, 4.05, -0.4]} castShadow>
        <cylinderGeometry args={[0.42, 0.42, 0.7, 10]} />
        <meshStandardMaterial map={metal} color="#6a5040" />
      </mesh>
      <Sparks open={stall.occupancy} />
      {stall.interior > 0.15 && <pointLight color="#e07030" intensity={stall.interior * 5} distance={6} position={[0, 1.6, 1.2]} />}
    </group>
  )
}

function Hall({ brick, metal, stall }: { brick: THREE.Texture; metal: THREE.Texture; stall: Stall }) {
  return (
    <group>
      <mesh position={[0, 2.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.05, 4.1, 4.55]} />
        <meshStandardMaterial map={brick} color={stall.hollow ? '#6a4438' : '#b06040'} roughness={0.84} />
      </mesh>
      <mesh position={[0, 4.45, 0]} castShadow>
        <boxGeometry args={[6.5, 0.18, 5]} />
        <meshStandardMaterial map={metal} color="#6a4a30" roughness={0.55} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, 0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#7a5434" roughness={0.5} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, -0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#7a5434" roughness={0.5} />
      </mesh>
      {[-2.15, -0.72, 0.72, 2.15].map((x) => (
        <mesh key={x} position={[x, 1.15, 2.45]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 2.3, 8]} />
          <meshStandardMaterial color="#c4a046" metalness={0.45} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 2.35, 2.45]}>
        <boxGeometry args={[5.1, 0.14, 0.55]} />
        <meshStandardMaterial color="#8a6038" />
      </mesh>
      <WindowRow xs={[-2.2, -1.3, 1.3, 2.2]} y={2.85} z={2.3} lit={stall.interior} />
      <mesh position={[0, 1.05, 2.32]}>
        <boxGeometry args={[1.7, 1.9, 0.08]} />
        <meshStandardMaterial color="#1c140e" />
      </mesh>
      <RollDoor width={1.7} height={1.95} open={stall.door} z={2.36} />
      <mesh position={[0, 0.55, 1.55]} castShadow>
        <cylinderGeometry args={[0.55, 0.7, 0.9, 10]} />
        <meshStandardMaterial color="#8a6a38" metalness={0.3} roughness={0.5} />
      </mesh>
    </group>
  )
}

function Dock({ metal, stall }: { metal: THREE.Texture; stall: Stall }) {
  const jam = stall.clogged
  return (
    <group>
      {[-2.35, 2.35].map((x) => (
        <mesh key={x} position={[x, 2.15, 0]} castShadow>
          <boxGeometry args={[0.28, 4.3, 4.2]} />
          <meshStandardMaterial map={metal} color="#8a9298" metalness={0.45} roughness={0.42} />
        </mesh>
      ))}
      <mesh position={[0, 4.35, 0]} castShadow>
        <boxGeometry args={[5.1, 0.18, 4.5]} />
        <meshStandardMaterial map={metal} color="#7a8088" metalness={0.5} roughness={0.38} />
      </mesh>
      {[-1.2, 0, 1.2].map((x) => (
        <mesh key={x} position={[x, 2.1, 2.05]}>
          <boxGeometry args={[1.05, 2.5 * (1 - stall.door * 0.15), 0.06]} />
          <meshStandardMaterial color="#2a3038" transparent opacity={jam ? 0.55 : 0.18 + (1 - stall.door) * 0.35} />
        </mesh>
      ))}
      <mesh position={[0, 0.12, 2.55]} receiveShadow>
        <boxGeometry args={[4.8, 0.18, 2.1]} />
        <meshStandardMaterial color="#5a564e" roughness={0.9} />
      </mesh>
      {(jam || stall.occupancy > 0.2) && <Truck x={1.45} z={2.7} />}
      {jam &&
        [-1.4, -0.5, 0.4].map((x, i) => (
          <mesh key={x} position={[x, 0.55 + i * 0.12, 2.2]} castShadow>
            <boxGeometry args={[0.85, 0.7, 0.7]} />
            <meshStandardMaterial color="#6a5040" roughness={0.7} />
          </mesh>
        ))}
    </group>
  )
}

function Truck({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, -0.4, 0]}>
      <mesh position={[0, 0.72, 0]} castShadow>
        <boxGeometry args={[1.55, 0.95, 0.85]} />
        <meshStandardMaterial color="#6a3a28" roughness={0.55} />
      </mesh>
      <mesh position={[-1.05, 0.55, 0]} castShadow>
        <boxGeometry args={[0.55, 0.6, 0.8]} />
        <meshStandardMaterial color="#3a3a38" />
      </mesh>
      {[-0.45, 0.45].map((dx) => (
        <mesh key={dx} position={[dx, 0.22, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.16, 8]} />
          <meshStandardMaterial color="#1a1a18" />
        </mesh>
      ))}
    </group>
  )
}

function Yard({ metal, brick, stall }: { metal: THREE.Texture; brick: THREE.Texture; stall: Stall }) {
  const beams = stall.hollow ? 1 : 1 + Math.round(stall.occupancy * 4)
  return (
    <group>
      <mesh position={[0, 1.75, -0.35]} castShadow receiveShadow>
        <boxGeometry args={[5.25, 3.5, 3.7]} />
        <meshStandardMaterial map={brick} color={stall.hollow ? '#5a3a30' : '#8a4a34'} roughness={0.85} />
      </mesh>
      <Cornice w={5.5} d={3.95} y={3.58} />
      <WindowRow xs={[-1.5, 0, 1.5]} y={2.35} z={1.52} lit={stall.interior} />
      <RollDoor width={1.6} height={1.7} open={stall.door} z={1.55} />
      {Array.from({ length: beams }, (_, i) => (
        <IBeam key={i} x={-1.35 + i * 0.68} z={1.85} y={0.22 + (i % 3) * 0.18} />
      ))}
      <mesh position={[2.15, 4.35, 0.4]} castShadow>
        <boxGeometry args={[0.18, 5.4, 0.18]} />
        <meshStandardMaterial color="#8a4a28" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[0.35, 7.05, 0.4]} rotation={[0, 0, -0.42]} castShadow>
        <boxGeometry args={[4.2, 0.16, 0.16]} />
        <meshStandardMaterial color="#8a4a28" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[2.15, 5.55, 0.4]}>
        <boxGeometry args={[0.7, 0.45, 0.55]} />
        <meshStandardMaterial map={metal} color="#4a5560" />
      </mesh>
    </group>
  )
}

function IBeam({ x, z, y }: { x: number; z: number; y: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, 0.18, 0]}>
      <mesh>
        <boxGeometry args={[1.7, 0.06, 0.42]} />
        <meshStandardMaterial color="#6a7078" metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[0.08, 0.28, 0.38]} />
        <meshStandardMaterial color="#5a6068" metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[1.7, 0.06, 0.42]} />
        <meshStandardMaterial color="#6a7078" metalness={0.55} roughness={0.35} />
      </mesh>
    </group>
  )
}

function Mill({ brick, metal, stall }: { brick: THREE.Texture; metal: THREE.Texture; stall: Stall }) {
  return (
    <group>
      <mesh position={[0, 1.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.15, 3.7, 4.7]} />
        <meshStandardMaterial map={brick} color={stall.hollow ? '#6a4030' : '#a85a38'} roughness={0.84} />
      </mesh>
      {[-2.05, 0, 2.05].map((x) => (
        <group key={x}>
          <mesh position={[x, 4.15, 0]} rotation={[0, 0, 0.62]} castShadow>
            <boxGeometry args={[2.35, 0.14, 4.85]} />
            <meshStandardMaterial map={metal} color="#6a4030" roughness={0.55} />
          </mesh>
          <mesh position={[x + 0.55, 4.45, 2.38]}>
            <boxGeometry args={[0.7, 0.45, 0.08]} />
            <meshStandardMaterial color="#2a3844" roughness={0.25} emissive="#c8a060" emissiveIntensity={stall.interior * 0.4} />
          </mesh>
        </group>
      ))}
      <WindowRow xs={[-2.1, -1.05, 1.05, 2.1]} y={2.45} z={2.38} lit={stall.interior} />
      <RollDoor width={1.85} height={1.9} open={stall.door} z={2.4} />
      <mesh position={[2.55, 0.45, 2.15]} rotation={[0, 0, -0.22]} receiveShadow>
        <boxGeometry args={[1.6, 0.12, 1.4]} />
        <meshStandardMaterial color="#6a5a40" />
      </mesh>
    </group>
  )
}

function Alley({ metal, stall }: { metal: THREE.Texture; stall: Stall }) {
  return (
    <group>
      <mesh position={[-1.55, 2.15, 0]} castShadow>
        <boxGeometry args={[1.85, 4.3, 4.15]} />
        <meshStandardMaterial map={metal} color="#6a7a88" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[1.65, 1.75, 0.25]} castShadow>
        <boxGeometry args={[1.7, 3.5, 3.7]} />
        <meshStandardMaterial map={metal} color="#5a6a78" metalness={0.35} roughness={0.52} />
      </mesh>
      <mesh position={[-1.55, 4.4, 0]}>
        <boxGeometry args={[2.05, 0.14, 4.35]} />
        <meshStandardMaterial color="#5a6870" metalness={0.45} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0.05, 0.35 + i * 0.55, 2.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 1.35, 5]} />
          <meshStandardMaterial color="#7a8088" metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[0.05, 1.4, 2.05]}>
        <boxGeometry args={[0.08, 2.6, 0.08]} />
        <meshStandardMaterial color="#6a7078" />
      </mesh>
      <RollDoor width={0.9} height={1.6} open={stall.door} z={2.1} />
      {stall.clogged && (
        <mesh position={[0.1, 0.45, 2.35]} castShadow>
          <boxGeometry args={[1.1, 0.85, 0.9]} />
          <meshStandardMaterial color="#5a4030" />
        </mesh>
      )}
    </group>
  )
}

/** Lattice height tracks live Σ(P·V)/ΣV against the ±2σ envelope — not a modulo toy. */
function Spire({ metal, avwap, stall }: { metal: THREE.Texture; avwap: AnchoredVwap; stall: Stall }) {
  const lift = rangeHeight(avwap.vwap, avwap.lower2, avwap.upper2, 3.6, 8.6)
  const yU = rangeHeight(avwap.upper1, avwap.lower2, avwap.upper2, 3.6, 8.6)
  const yL = rangeHeight(avwap.lower1, avwap.lower2, avwap.upper2, 3.6, 8.6)
  return (
    <group>
      {([-0.7, 0.7] as const).map((x) =>
        ([-0.7, 0.7] as const).map((z) => (
          <mesh key={`${x}${z}`} position={[x, lift / 2, z]} castShadow>
            <boxGeometry args={[0.12, lift, 0.12]} />
            <meshStandardMaterial map={metal} color="#4a5a62" metalness={0.5} roughness={0.4} />
          </mesh>
        )),
      )}
      {[lift * 0.22, lift * 0.45, lift * 0.68, lift * 0.9].map((y) => (
        <group key={y}>
          <mesh position={[0, y, 0]}>
            <boxGeometry args={[1.55, 0.08, 0.08]} />
            <meshStandardMaterial color="#3a4a52" />
          </mesh>
          <mesh position={[0, y, 0]}>
            <boxGeometry args={[0.08, 0.08, 1.55]} />
            <meshStandardMaterial color="#3a4a52" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, lift + 0.12, 0]} castShadow>
        <boxGeometry args={[1.7, 0.22, 1.7]} />
        <meshStandardMaterial color="#2a6a78" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, lift + 0.62, 0]}>
        <coneGeometry args={[0.28, 0.7, 4]} />
        <meshStandardMaterial color="#c4a046" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, yU, 0]}>
        <boxGeometry args={[2.15, 0.1, 2.15]} />
        <meshStandardMaterial color="#3a5a88" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, yL, 0]}>
        <boxGeometry args={[2.15, 0.1, 2.15]} />
        <meshStandardMaterial color="#8a7040" metalness={0.35} roughness={0.45} />
      </mesh>
      {stall.interior > 0.2 && <pointLight color="#4aa0b0" intensity={stall.interior * 4} distance={7} position={[0, lift, 0]} />}
    </group>
  )
}

function Loft({ metal, avwap, stall }: { metal: THREE.Texture; avwap: AnchoredVwap; stall: Stall }) {
  const deck = rangeHeight(avwap.upper1, avwap.lower2, avwap.upper2, 2.4, 6.4)
  return (
    <group>
      {([-1.15, 1.15] as const).map((x) =>
        ([-1.15, 1.15] as const).map((z) => (
          <mesh key={`${x}${z}`} position={[x, deck / 2, z]} castShadow>
            <boxGeometry args={[0.16, deck, 0.16]} />
            <meshStandardMaterial map={metal} color="#4a5868" metalness={0.45} roughness={0.4} />
          </mesh>
        )),
      )}
      <mesh position={[0, deck, 0]} castShadow>
        <boxGeometry args={[2.9, 0.16, 2.9]} />
        <meshStandardMaterial color="#3a5a88" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[0, deck + 1.05, 0]} castShadow>
        <boxGeometry args={[2.7, 1.9, 2.5]} />
        <meshStandardMaterial map={metal} color="#5a7088" metalness={0.35} roughness={0.42} />
      </mesh>
      <mesh position={[0, deck + 2.1, 0]}>
        <boxGeometry args={[2.95, 0.12, 2.75]} />
        <meshStandardMaterial color="#2a4060" />
      </mesh>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, deck + 1.15, 1.28]}>
          <boxGeometry args={[0.7, 0.7, 0.06]} />
          <meshStandardMaterial color="#d8e8f4" roughness={0.15} metalness={0.3} emissive="#c8d8e8" emissiveIntensity={stall.interior * 0.35} />
        </mesh>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[1.45, 0.22 + i * (deck / 6), 1.35 - i * 0.08]} rotation={[0.15, 0, 0]}>
          <boxGeometry args={[0.55, 0.08, 0.42]} />
          <meshStandardMaterial color="#8a6a40" />
        </mesh>
      ))}
      <RollDoor width={1.05} height={1.4} open={stall.door} z={1.52} />
    </group>
  )
}

function Pit({ metal, avwap, stall }: { metal: THREE.Texture; avwap: AnchoredVwap; stall: Stall }) {
  const floor = rangeHeight(avwap.lower1, avwap.lower2, avwap.upper2, 0.08, 1.85)
  const wall = 1.55 - floor * 0.35
  return (
    <group>
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <boxGeometry args={[3.4, 0.12, 3.4]} />
        <meshStandardMaterial color="#3a3228" roughness={0.9} />
      </mesh>
      {([-1.55, 1.55] as const).map((x) => (
        <mesh key={x} position={[x, wall / 2, 0]} castShadow>
          <boxGeometry args={[0.22, wall, 3.2]} />
          <meshStandardMaterial map={metal} color="#6a5840" metalness={0.25} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[0, wall / 2, -1.55]} castShadow>
        <boxGeometry args={[3.3, wall, 0.22]} />
        <meshStandardMaterial map={metal} color="#5a4a34" />
      </mesh>
      <mesh position={[0, floor + 0.12, 0]} receiveShadow>
        <boxGeometry args={[2.6, 0.1, 2.6]} />
        <meshStandardMaterial color="#8a7040" roughness={0.7} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0, 0.12 + i * 0.16, 1.55 - i * 0.22]} rotation={[-0.4, 0, 0]}>
          <boxGeometry args={[1.4, 0.07, 0.38]} />
          <meshStandardMaterial color="#6a4a28" />
        </mesh>
      ))}
      {stall.occupancy > 0.2 &&
        [0, 1, 2].map((i) => (
          <mesh key={i} position={[-0.55 + i * 0.5, floor + 0.38, -0.2]} castShadow>
            <boxGeometry args={[0.4, 0.35, 0.35]} />
            <meshStandardMaterial color="#7a5a30" />
          </mesh>
        ))}
      <RollDoor width={1.2} height={1.15} open={stall.door} z={1.68} />
    </group>
  )
}

function Sparks({ open }: { open: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeds = useMemo(() => Array.from({ length: 18 }, () => Math.random()), [])
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime
    seeds.forEach((seed, i) => {
      const u = (t * (1.2 + seed) + seed * 8) % 1
      dummy.position.set((seed - 0.5) * 1.4, 1.15 + u * 1.8 * open, 1.55)
      dummy.scale.setScalar(open > 0.15 ? 0.035 + (1 - u) * 0.06 : 0.001)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 18]}>
      <sphereGeometry args={[1, 5, 5]} />
      <meshBasicMaterial color="#e07030" />
    </instancedMesh>
  )
}
