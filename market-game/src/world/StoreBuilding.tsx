import { Billboard } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fmtPx, rangeHeight } from '../game/auction'
import { advertisedPrice, inspectStore, marketWorld, stallState } from '../game/gameStore'
import { storeYaw } from '../game/stores'
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
  const printed = Boolean(g.lastPrint && g.lastPrint.storeId === store.id && performance.now() - g.lastPrint.at < 3600)
  const range = profileRange(store, g.avwap)
  const label =
    store.building === 'foundry'
      ? 'FOUNDRY'
      : store.building === 'hall'
        ? 'HALL'
        : store.building === 'dock'
          ? 'DOCK'
          : store.building === 'yard'
            ? 'YARD'
            : store.building === 'mill'
              ? 'MILL'
              : store.building === 'alley'
                ? 'ALLEY'
                : store.building === 'spire'
                  ? 'SPIRE'
                  : store.building === 'loft'
                    ? 'LOFT'
                    : 'PIT'
  const yaw = storeYaw(store.range)

  return (
    <group
      position={store.position}
      rotation={[0, yaw, 0]}
      onClick={(e) => {
        e.stopPropagation()
        inspectStore(store.id)
      }}
    >
      {store.building === 'foundry' && <Foundry brick={brick} metal={metal} stall={st} printed={printed} />}
      {store.building === 'hall' && <Hall brick={brick} metal={metal} stall={st} />}
      {store.building === 'dock' && <Dock metal={metal} stall={st} printed={printed} />}
      {store.building === 'yard' && <Yard metal={metal} brick={brick} stall={st} />}
      {store.building === 'mill' && <Mill brick={brick} metal={metal} stall={st} />}
      {store.building === 'alley' && <Alley metal={metal} stall={st} />}
      {store.building === 'spire' && <Spire metal={metal} avwap={g.avwap} live={g.livePrice} stall={st} printed={printed} />}
      {store.building === 'loft' && <Loft metal={metal} avwap={g.avwap} stall={st} />}
      {store.building === 'pit' && <Pit metal={metal} avwap={g.avwap} stall={st} />}
      {store.building !== 'spire' && store.building !== 'pit' && (
        <RangeRails range={range} nodePx={price} color={store.accent} width={store.building === 'loft' ? 3.0 : 4.0} />
      )}
      <Fascia
        title={label}
        paint={store.accent}
        y={
          store.building === 'spire'
            ? 8.2
            : store.building === 'pit'
              ? 2.95
              : store.building === 'loft'
                ? 6.9
                : store.building === 'hall'
                  ? 5.7
                  : store.building === 'mill'
                    ? 5.35
                    : 4.75
        }
      />
      <ChalkBoard price={fmtPx(price)} y={store.building === 'pit' ? 1.15 : 1.45} z={store.building === 'spire' ? 1.05 : 2.35} pulse={printed} />
      <GoodsPile stall={st} kind={store.kind} z={store.building === 'spire' ? 1.35 : 3.05} />
      {printed && <PrintBurst />}
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
  const yLo = rangeHeight(range.lo, range.lo, range.hi, 0.42, 4.15)
  const yHi = rangeHeight(range.hi, range.lo, range.hi, 0.42, 4.15)
  const yVal = rangeHeight(range.val, range.lo, range.hi, 0.42, 4.15)
  const yVah = rangeHeight(range.vah, range.lo, range.hi, 0.42, 4.15)
  const yNode = rangeHeight(nodePx, range.lo, range.hi, 0.42, 4.15)
  const bandH = Math.max(0.55, yVah - yVal)
  const span = yHi - yLo
  return (
    <group>
      <mesh position={[0, (yVah + yVal) / 2, 2.22]} castShadow>
        <boxGeometry args={[width * 0.98, bandH, 0.28]} />
        <meshStandardMaterial color={color} roughness={0.48} metalness={0.18} emissive={color} emissiveIntensity={0.28} />
      </mesh>
      <mesh position={[0, yHi, 2.28]} castShadow>
        <boxGeometry args={[width + 0.25, 0.42, 0.38]} />
        <meshBasicMaterial color="#f0c84a" />
      </mesh>
      <mesh position={[0, yLo, 2.28]} castShadow>
        <boxGeometry args={[width + 0.18, 0.4, 0.36]} />
        <meshBasicMaterial color="#2a1810" />
      </mesh>
      <mesh position={[0, yNode, 0.15]} receiveShadow>
        <boxGeometry args={[width * 0.62, 0.22, 2.55]} />
        <meshStandardMaterial color="#e8c070" roughness={0.48} metalness={0.22} emissive="#c4a046" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[width / 2 + 0.12, (yHi + yLo) / 2, 2.05]} castShadow>
        <boxGeometry args={[0.38, span + 0.7, 0.22]} />
        <meshStandardMaterial color="#5a3a22" roughness={0.62} />
      </mesh>
      {([-width / 2, width / 2] as const).map((x) => (
        <mesh key={x} position={[x, (yHi + yLo) / 2, 2.26]}>
          <boxGeometry args={[0.22, span + 0.55, 0.22]} />
          <meshStandardMaterial color="#3a2a1c" />
        </mesh>
      ))}
    </group>
  )
}

function Fascia({ title, paint, y }: { title: string; paint: string; y: number }) {
  const tex = useMemo(() => makeFasciaTexture(title, paint), [title, paint])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <Billboard position={[0, y, 0.4]} follow>
      <mesh>
        <planeGeometry args={[3.15, 0.7]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Billboard>
  )
}

function PrintBurst() {
  return (
    <group position={[0, 0.45, 3.15]}>
      {[-1.1, -0.35, 0.4, 1.15].map((x, i) => (
        <mesh key={x} position={[x, 0.22 + (i % 2) * 0.28, (i % 3) * 0.2]} castShadow>
          <boxGeometry args={[0.62, 0.48, 0.52]} />
          <meshBasicMaterial color={i % 2 ? '#f0c84a' : '#e07030'} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.05, 1.45, 22]} />
        <meshBasicMaterial color="#ffe080" transparent opacity={0.7} toneMapped={false} />
      </mesh>
    </group>
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
  const extra = stall.printBoost > 0.2 ? 8 : 0
  const n = kind === 'lvn' ? (stall.clogged ? 10 + extra : extra) : Math.round(stall.occupancy * 16) + extra
  if (n <= 0) return stall.hollow ? <EmptyRacks z={z} /> : null
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh
          key={i}
          position={[
            -1.55 + (i % 4) * 0.58,
            0.28 + Math.floor(i / 4) * 0.42 + stall.printBoost * 0.28,
            z + (i % 2) * 0.38,
          ]}
          castShadow
        >
          <boxGeometry args={[0.52, 0.4, 0.44]} />
          <meshBasicMaterial color={kind === 'lvn' ? '#8a6040' : i % 2 ? '#e07030' : '#f0c84a'} />
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
    <group>
      <mesh position={[0, h / 2 + 0.08, z]} castShadow>
        <boxGeometry args={[width, Math.max(0.08, h), 0.12]} />
        <meshStandardMaterial
          color={open > 0.55 ? '#d4b078' : '#1a1814'}
          metalness={0.35}
          roughness={0.48}
          emissive={open > 0.55 ? '#8a6030' : '#000000'}
          emissiveIntensity={open > 0.55 ? 0.14 : 0}
        />
      </mesh>
      {open > 0.28 && (
        <mesh position={[0, 0.55, z - 0.08]}>
          <boxGeometry args={[width * 0.92, 1.05 * open, 0.04]} />
          <meshBasicMaterial color="#ffc070" transparent opacity={0.22 + open * 0.35} toneMapped={false} />
        </mesh>
      )}
    </group>
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
            color="#5a88a0"
            roughness={0.22}
            metalness={0.15}
            emissive="#d8c080"
            emissiveIntensity={0.08 + lit * 0.55}
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

function Foundry({
  brick,
  metal,
  stall,
  printed,
}: {
  brick: THREE.Texture
  metal: THREE.Texture
  stall: Stall
  printed: boolean
}) {
  const glow = stall.occupancy * 1.7 + stall.printBoost * 1.1
  return (
    <group>
      <mesh position={[0, 1.85, -0.15]} castShadow receiveShadow>
        <boxGeometry args={[4.35, 3.7, 3.7]} />
        <meshStandardMaterial
          map={brick}
          color={stall.hollow ? '#d08058' : '#e07048'}
          roughness={0.78}
          emissive="#c45830"
          emissiveIntensity={0.16}
        />
      </mesh>
      <Cornice w={4.6} d={3.95} y={3.78} />
      <WindowRow xs={[-1.7, -0.85, 0.85, 1.7]} y={2.55} z={2.1} lit={stall.interior} />
      <mesh position={[-1.55, 0.95, 2.05]}>
        <boxGeometry args={[1.5, 1.7, 0.1]} />
        <meshStandardMaterial color="#1a1210" roughness={0.5} />
      </mesh>
      <RollDoor width={1.7} height={1.85} open={stall.door} z={2.12} />
      {[-1.05, 1.05].map((x) => (
        <group key={x} position={[x, 0, 1.85]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.78, 1.4, 10]} />
            <meshStandardMaterial color="#4a3028" metalness={0.35} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.95, 0.55]}>
            <boxGeometry args={[0.95, 0.85, 0.22]} />
            <meshBasicMaterial color={stall.hollow ? '#3a2418' : '#ff7030'} />
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
      <Sparks open={stall.occupancy + stall.printBoost} />
      {(stall.interior > 0.15 || printed) && (
        <pointLight color="#e07030" intensity={stall.interior * 5 + stall.printBoost * 8} distance={7} position={[0, 1.6, 1.2]} />
      )}
    </group>
  )
}

function Hall({ brick, metal, stall }: { brick: THREE.Texture; metal: THREE.Texture; stall: Stall }) {
  return (
    <group>
      <mesh position={[0, 2.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.55, 4.1, 4.15]} />
        <meshStandardMaterial
          map={brick}
          color={stall.hollow ? '#d88860' : '#ee7848'}
          roughness={0.76}
          emissive="#d06038"
          emissiveIntensity={0.18}
        />
      </mesh>
      <mesh position={[0, 4.45, 0]} castShadow>
        <boxGeometry args={[4.95, 0.18, 4.5]} />
        <meshStandardMaterial map={metal} color="#a06a40" roughness={0.52} emissive="#6a3a20" emissiveIntensity={0.1} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, 0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#b07848" roughness={0.48} emissive="#7a4020" emissiveIntensity={0.1} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, -0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#b07848" roughness={0.48} emissive="#7a4020" emissiveIntensity={0.1} />
      </mesh>
      {[-1.55, -0.52, 0.52, 1.55].map((x) => (
        <mesh key={x} position={[x, 1.15, 2.2]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 2.3, 8]} />
          <meshStandardMaterial color="#c4a046" metalness={0.45} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 2.35, 2.2]}>
        <boxGeometry args={[3.7, 0.14, 0.55]} />
        <meshStandardMaterial color="#8a6038" />
      </mesh>
      <WindowRow xs={[-1.45, -0.55, 0.55, 1.45]} y={2.85} z={2.1} lit={stall.interior} />
      <mesh position={[0, 1.05, 2.32]}>
        <boxGeometry args={[1.7, 1.9, 0.08]} />
        <meshStandardMaterial color="#1c140e" />
      </mesh>
      <RollDoor width={1.7} height={1.95} open={stall.door} z={2.36} />
      <mesh position={[0, 0.55, 1.55]} castShadow>
        <cylinderGeometry args={[0.55, 0.7, 0.9, 10]} />
        <meshStandardMaterial color="#c4a046" metalness={0.35} roughness={0.45} emissive="#8a7028" emissiveIntensity={0.12} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.08 + i * 0.11, 2.62 - i * 0.2]} receiveShadow>
          <boxGeometry args={[2.35 - i * 0.12, 0.12, 0.48]} />
          <meshStandardMaterial color="#d4c4a4" roughness={0.82} />
        </mesh>
      ))}
      <mesh position={[0, 5.05, 2.28]} rotation={[Math.PI / 2, 0, Math.PI]}>
        <coneGeometry args={[2.05, 0.16, 3]} />
        <meshStandardMaterial color="#c45a32" roughness={0.7} emissive="#a04020" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 3.52, 2.34]}>
        <circleGeometry args={[0.28, 16]} />
        <meshStandardMaterial color="#f0e8d0" roughness={0.35} emissive="#e8dcc0" emissiveIntensity={0.2} />
      </mesh>
    </group>
  )
}

function Dock({ metal, stall, printed }: { metal: THREE.Texture; stall: Stall; printed: boolean }) {
  const jam = stall.clogged
  return (
    <group>
      {[-1.85, 1.85].map((x) => (
        <mesh key={x} position={[x, 2.15, 0]} castShadow>
          <boxGeometry args={[0.28, 4.3, 3.6]} />
          <meshStandardMaterial
            map={metal}
            color="#c8d0d6"
            metalness={0.38}
            roughness={0.42}
            emissive="#8a949c"
            emissiveIntensity={0.14}
          />
        </mesh>
      ))}
      <mesh position={[0, 1.95, -0.25]} castShadow receiveShadow>
        <boxGeometry args={[3.55, 3.7, 3.15]} />
        <meshStandardMaterial
          map={metal}
          color="#c5cdd4"
          metalness={0.36}
          roughness={0.44}
          emissive="#8a949c"
          emissiveIntensity={0.14}
        />
      </mesh>
      <mesh position={[0, 4.35, 0]} castShadow>
        <boxGeometry args={[4.15, 0.18, 3.9]} />
        <meshStandardMaterial map={metal} color="#b8c4cc" metalness={0.45} roughness={0.38} emissive="#788088" emissiveIntensity={0.1} />
      </mesh>
      {[-1.2, 0, 1.2].map((x) => (
        <mesh key={x} position={[x, 2.1, 2.05]}>
          <boxGeometry args={[1.05, 2.5 * (1 - stall.door * 0.15), 0.06]} />
          <meshStandardMaterial color="#6a8490" transparent opacity={jam ? 0.55 : 0.2 + (1 - stall.door) * 0.28} />
        </mesh>
      ))}
      <mesh position={[0, 0.12, 2.55]} receiveShadow>
        <boxGeometry args={[4.8, 0.18, 2.1]} />
        <meshStandardMaterial color="#5a564e" roughness={0.9} />
      </mesh>
      {(jam || stall.occupancy > 0.2 || printed) && <Truck x={1.45} z={2.7} />}
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
        <meshStandardMaterial color="#c44a28" roughness={0.52} emissive="#8a2818" emissiveIntensity={0.16} />
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
        <meshStandardMaterial
          map={brick}
          color={stall.hollow ? '#c87850' : '#dc6038'}
          roughness={0.78}
          emissive="#b84828"
          emissiveIntensity={0.15}
        />
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
        <meshStandardMaterial
          map={brick}
          color={stall.hollow ? '#d07850' : '#e86840'}
          roughness={0.76}
          emissive="#c45030"
          emissiveIntensity={0.16}
        />
      </mesh>
      {[-2.05, 0, 2.05].map((x) => (
        <group key={x}>
          <mesh position={[x, 4.15, 0]} rotation={[0, 0, 0.62]} castShadow>
            <boxGeometry args={[2.35, 0.14, 4.85]} />
            <meshStandardMaterial map={metal} color="#8a5a38" roughness={0.52} emissive="#5a3020" emissiveIntensity={0.1} />
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
        <meshStandardMaterial color="#8a7a50" />
      </mesh>
      <mesh position={[0, 3.95, 0]} castShadow>
        <boxGeometry args={[6.35, 0.12, 4.9]} />
        <meshStandardMaterial color="#c45a32" roughness={0.7} emissive="#a03820" emissiveIntensity={0.08} />
      </mesh>
    </group>
  )
}

function Alley({ metal, stall }: { metal: THREE.Texture; stall: Stall }) {
  return (
    <group>
      <mesh position={[-1.55, 2.15, 0]} castShadow>
        <boxGeometry args={[1.85, 4.3, 4.15]} />
        <meshStandardMaterial
          map={metal}
          color="#9aacb8"
          metalness={0.3}
          roughness={0.46}
          emissive="#6a7a88"
          emissiveIntensity={0.14}
        />
      </mesh>
      <mesh position={[1.65, 1.75, 0.25]} castShadow>
        <boxGeometry args={[1.7, 3.5, 3.7]} />
        <meshStandardMaterial
          map={metal}
          color="#8a9aa8"
          metalness={0.3}
          roughness={0.48}
          emissive="#5a6a78"
          emissiveIntensity={0.12}
        />
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

/** Lattice height tracks live Σ(P·V)/ΣV against the ±2σ envelope — decks lerp so the overview breathes. */
function Spire({
  metal,
  avwap,
  live,
  stall,
  printed,
}: {
  metal: THREE.Texture
  avwap: AnchoredVwap
  live: number
  stall: Stall
  printed: boolean
}) {
  const legs = useRef<THREE.Group>(null)
  const deck = useRef<THREE.Group>(null)
  const cab = useRef<THREE.Mesh>(null)
  const lift = useRef(rangeHeight(avwap.vwap, avwap.lower2, avwap.upper2, 2.8, 10.4))
  const cabY = useRef(rangeHeight(live, avwap.lower2, avwap.upper2, 2.8, 10.4))
  const yU = rangeHeight(avwap.upper1, avwap.lower2, avwap.upper2, 2.8, 10.4)
  const yL = rangeHeight(avwap.lower1, avwap.lower2, avwap.upper2, 2.8, 10.4)

  useFrame((_, dt) => {
    const target = rangeHeight(avwap.vwap, avwap.lower2, avwap.upper2, 2.8, 10.4)
    const cabT = rangeHeight(live, avwap.lower2, avwap.upper2, 2.8, 10.4)
    lift.current = THREE.MathUtils.lerp(lift.current, target, 1 - Math.exp(-dt * 3.2))
    cabY.current = THREE.MathUtils.lerp(cabY.current, cabT, 1 - Math.exp(-dt * 5.4))
    if (legs.current) legs.current.scale.y = lift.current / 6
    if (deck.current) deck.current.position.y = lift.current
    if (cab.current) cab.current.position.y = cabY.current
  })

  return (
    <group>
      <group ref={legs}>
        {([-0.75, 0.75] as const).map((x) =>
          ([-0.75, 0.75] as const).map((z) => (
            <mesh key={`${x}${z}`} position={[x, 3, z]} castShadow>
              <boxGeometry args={[0.16, 6, 0.16]} />
              <meshStandardMaterial map={metal} color="#5a7a88" metalness={0.5} roughness={0.4} />
            </mesh>
          )),
        )}
      </group>
      <group ref={deck}>
        <mesh position={[0, 0.12, 0]} castShadow>
          <boxGeometry args={[2.1, 0.28, 2.1]} />
          <meshStandardMaterial color="#2a8aa0" metalness={0.45} roughness={0.38} emissive="#1a6070" emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <coneGeometry args={[0.38, 0.85, 4]} />
          <meshStandardMaterial color="#e8c04a" metalness={0.5} roughness={0.32} emissive="#c4a046" emissiveIntensity={0.2} />
        </mesh>
      </group>
      <mesh ref={cab} position={[0, 5, 0]} castShadow>
        <boxGeometry args={[1.05, 0.62, 1.05]} />
        <meshStandardMaterial
          color="#e8c04a"
          metalness={0.5}
          roughness={0.3}
          emissive="#c4a046"
          emissiveIntensity={printed ? 1.1 : 0.45}
        />
      </mesh>
      <mesh position={[0, yU, 0]}>
        <boxGeometry args={[2.85, 0.2, 2.85]} />
        <meshStandardMaterial color="#4a78c0" metalness={0.4} roughness={0.4} emissive="#2a4878" emissiveIntensity={0.22} />
      </mesh>
      <mesh position={[0, yL, 0]}>
        <boxGeometry args={[2.85, 0.2, 2.85]} />
        <meshStandardMaterial color="#c49040" metalness={0.35} roughness={0.45} emissive="#8a6020" emissiveIntensity={0.18} />
      </mesh>
      {(stall.interior > 0.2 || printed) && (
        <pointLight color="#4aa0b0" intensity={stall.interior * 4 + stall.printBoost * 5} distance={8} position={[0, 5, 0]} />
      )}
    </group>
  )
}

function Loft({ metal, avwap, stall }: { metal: THREE.Texture; avwap: AnchoredVwap; stall: Stall }) {
  const deck = rangeHeight(avwap.upper1, avwap.lower2, avwap.upper2, 2.8, 7.2)
  return (
    <group>
      {([-1.45, 1.45] as const).map((x) =>
        ([-1.45, 1.45] as const).map((z) => (
          <mesh key={`${x}${z}`} position={[x, deck / 2, z]} castShadow>
            <cylinderGeometry args={[0.16, 0.18, deck, 8]} />
            <meshStandardMaterial color="#e8c04a" metalness={0.52} roughness={0.32} emissive="#c4a046" emissiveIntensity={0.22} />
          </mesh>
        )),
      )}
      <mesh position={[0, deck, 0]} castShadow>
        <boxGeometry args={[3.55, 0.22, 3.55]} />
        <meshStandardMaterial color="#4a78b8" metalness={0.35} roughness={0.42} emissive="#2a4878" emissiveIntensity={0.22} />
      </mesh>
      <mesh position={[0, deck + 1.35, 0]} castShadow>
        <boxGeometry args={[3.25, 2.45, 2.95]} />
        <meshStandardMaterial
          map={metal}
          color="#8ab0d0"
          metalness={0.28}
          roughness={0.35}
          emissive="#5a88b0"
          emissiveIntensity={0.16 + stall.interior * 0.28}
        />
      </mesh>
      <mesh position={[0, deck + 2.72, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[2.45, 0.95, 4]} />
        <meshStandardMaterial color="#3a5a88" emissive="#1a3058" emissiveIntensity={0.12} />
      </mesh>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, deck + 1.35, 1.52]}>
          <boxGeometry args={[1.05, 1.15, 0.08]} />
          <meshStandardMaterial
            color="#e8f4ff"
            roughness={0.12}
            metalness={0.35}
            emissive="#c8e0f4"
            emissiveIntensity={0.28 + stall.interior * 0.5}
          />
        </mesh>
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[1.72, 0.22 + i * (deck / 8), 1.55 - i * 0.05]} rotation={[0.18, 0, 0]}>
          <boxGeometry args={[0.72, 0.1, 0.52]} />
          <meshStandardMaterial color="#d4b060" />
        </mesh>
      ))}
      <RollDoor width={1.35} height={1.55} open={stall.door} z={1.72} />
    </group>
  )
}

function Pit({ metal, avwap, stall }: { metal: THREE.Texture; avwap: AnchoredVwap; stall: Stall }) {
  const floor = rangeHeight(avwap.lower1, avwap.lower2, avwap.upper2, 0.06, 1.85)
  const wall = 2.05 - floor * 0.28
  return (
    <group>
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <cylinderGeometry args={[2.45, 2.55, 0.16, 8]} />
        <meshStandardMaterial color="#5a4a32" roughness={0.9} />
      </mesh>
      <mesh position={[0, wall / 2, 0]} castShadow>
        <cylinderGeometry args={[2.25, 2.38, wall, 8]} />
        <meshStandardMaterial map={metal} color="#c4a046" metalness={0.4} roughness={0.42} emissive="#8a7028" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, wall / 2, 0]}>
        <cylinderGeometry args={[1.78, 1.88, wall + 0.04, 8]} />
        <meshStandardMaterial color="#3a2a18" roughness={0.85} />
      </mesh>
      <mesh position={[0, floor + 0.1, 0]} receiveShadow>
        <cylinderGeometry args={[1.7, 1.7, 0.16, 8]} />
        <meshStandardMaterial color="#f0c84a" roughness={0.4} metalness={0.45} emissive="#d4a046" emissiveIntensity={0.38} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[0, 0.16 + i * 0.2, 2.05 - i * 0.22]} rotation={[-0.42, 0, 0]}>
          <boxGeometry args={[1.85, 0.1, 0.48]} />
          <meshStandardMaterial color="#b07a38" />
        </mesh>
      ))}
      {stall.occupancy > 0.15 &&
        [0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[-0.85 + i * 0.42, floor + 0.36, -0.12]} castShadow>
            <boxGeometry args={[0.38, 0.36, 0.34]} />
            <meshStandardMaterial color="#c47830" />
          </mesh>
        ))}
      <RollDoor width={1.45} height={1.35} open={stall.door} z={2.05} />
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
