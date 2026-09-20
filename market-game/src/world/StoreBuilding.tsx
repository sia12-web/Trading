import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { fmtPx, PRINT_HOLD_MS, rangeHeight } from '../game/auction'
import { advertisedPrice, inspectStore, marketWorld, stallState } from '../game/gameStore'
import { storeYaw } from '../game/stores'
import type { AnchoredVwap, StoreDef, VolumeProfile } from '../game/types'
import { useGame } from '../ui/useGame'
import { makeChalkTexture, makeCourtSignTexture, makeFasciaTexture, makeOpenBannerTexture, useBrickTexture, useMetalTexture } from './textures'

type Stall = ReturnType<typeof stallState>

export function StoreBuilding({ store }: { store: StoreDef }) {
  const g = useGame()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const price = advertisedPrice(store.id, g)
  const st = stallState(store.id, g)
  const hot = g.nearby === store.id || g.inspecting === store.id
  const printed = Boolean(g.lastPrint && g.lastPrint.storeId === store.id && performance.now() - g.lastPrint.at < PRINT_HOLD_MS)
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
  const shell =
    store.building === 'foundry'
      ? { w: 4.45, d: 3.85, fasciaY: 2.42 }
      : store.building === 'hall'
        ? { w: 4.7, d: 4.3, fasciaY: 2.48 }
        : store.building === 'dock'
          ? { w: 4.2, d: 3.7, fasciaY: 2.38 }
          : store.building === 'yard'
            ? { w: 5.4, d: 3.85, fasciaY: 2.35 }
            : store.building === 'mill'
              ? { w: 6.3, d: 4.85, fasciaY: 2.42 }
              : store.building === 'alley'
                ? { w: 3.7, d: 4.2, fasciaY: 2.35 }
                : store.building === 'spire'
                  ? { w: 3.55, d: 3.55, fasciaY: 2.55 }
                  : store.building === 'loft'
                    ? { w: 3.7, d: 3.55, fasciaY: 2.48 }
                    : { w: 3.65, d: 3.5, fasciaY: 2.25 }
  const gableX = store.range === 'fiveDay' || store.range === 'fiveMonth' ? shell.w * 0.52 : 0

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
      {store.building === 'spire' && <Spire brick={brick} metal={metal} avwap={g.avwap} live={g.livePrice} stall={st} printed={printed} />}
      {store.building === 'loft' && <Loft brick={brick} metal={metal} avwap={g.avwap} stall={st} />}
      {store.building === 'pit' && <Pit brick={brick} metal={metal} avwap={g.avwap} stall={st} />}
      <RangeStoreys
        rangeKind={store.range}
        range={range}
        nodePx={price}
        color={store.accent}
        width={shell.w}
        depth={shell.d}
      />
      <Fascia title={label} paint={store.accent} y={shell.fasciaY} width={Math.min(4.55, shell.w * 1.02)} z={shell.d * 0.52} />
      {gableX !== 0 && (
        <GableSign title={label} paint={store.accent} x={gableX} y={store.building === 'yard' ? 3.15 : 2.55} />
      )}
      {store.range === 'fiveDay' && (
        <EastSign
          title={label}
          paint={store.accent}
          y={store.building === 'yard' ? 3.45 : 2.7}
          z={-shell.d * 0.52}
          width={store.building === 'yard' ? 5.05 : Math.min(4.4, shell.w * 0.92)}
        />
      )}
      {store.building === 'yard' && <YardPlaque />}
      <ChalkBoard price={fmtPx(price)} y={store.building === 'pit' ? 1.05 : 1.4} z={shell.d * 0.52 + 0.12} pulse={printed} />
      <GoodsPile stall={st} kind={store.kind} z={shell.d * 0.55 + 0.85} />
      {printed && st.printSide === 'buy' && <PrintBurst />}
      {printed && st.printSide === 'sell' && <FadeSweep />}
      {hot && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.15, 2.38, 28]} />
          <meshBasicMaterial color="#d4a046" transparent opacity={0.88} />
        </mesh>
      )}
      <mesh
        position={[0, 0.07, 2.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation()
          inspectStore(store.id)
        }}
      >
        <planeGeometry args={[4.4, 3.4]} />
        <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
      </mesh>
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

function RangeStoreys({
  rangeKind,
  range,
  nodePx,
  color,
  width,
  depth,
}: {
  rangeKind: StoreDef['range']
  range: { lo: number; hi: number; val: number; vah: number }
  nodePx: number
  color: string
  width: number
  depth: number
}) {
  const yLo = rangeHeight(range.lo, range.lo, range.hi, 0.22, 3.72)
  const yHi = rangeHeight(range.hi, range.lo, range.hi, 0.22, 3.72)
  const yVal = rangeHeight(range.val, range.lo, range.hi, 0.22, 3.72)
  const yVah = rangeHeight(range.vah, range.lo, range.hi, 0.22, 3.72)
  const yNode = rangeHeight(nodePx, range.lo, range.hi, 0.22, 3.72)
  // Camera sits at +X+Z. Put ladders on the faces that shot actually sees:
  // yesterday south; five-day east+south; five-month courtyard+south.
  const faces =
    rangeKind === 'fiveDay'
      ? [
          { p: [0, 0, -depth * 0.52 - 0.08] as [number, number, number], r: [0, Math.PI, 0] as [number, number, number], w: width },
          { p: [width * 0.52 + 0.08, 0, 0] as [number, number, number], r: [0, Math.PI / 2, 0] as [number, number, number], w: depth },
        ]
      : rangeKind === 'fiveMonth'
        ? [
            { p: [0, 0, depth * 0.52 + 0.08] as [number, number, number], r: [0, 0, 0] as [number, number, number], w: width },
            { p: [width * 0.52 + 0.08, 0, 0] as [number, number, number], r: [0, Math.PI / 2, 0] as [number, number, number], w: depth },
          ]
        : [{ p: [0, 0, depth * 0.52 + 0.08] as [number, number, number], r: [0, 0, 0] as [number, number, number], w: width }]
  return (
    <>
      {faces.map((f, i) => (
        <Ladder key={i} p={f.p} r={f.r} wallW={f.w} yLo={yLo} yHi={yHi} yVal={yVal} yVah={yVah} yNode={yNode} color={color} />
      ))}
    </>
  )
}

function Ladder({
  p,
  r,
  wallW,
  yLo,
  yHi,
  yVal,
  yVah,
  yNode,
  color,
}: {
  p: [number, number, number]
  r: [number, number, number]
  wallW: number
  yLo: number
  yHi: number
  yVal: number
  yVah: number
  yNode: number
  color: string
}) {
  const vaH = Math.max(0.7, yVah - yVal)
  return (
    <group position={p} rotation={r}>
      <mesh position={[0, yLo, 0.03]} castShadow>
        <boxGeometry args={[wallW * 0.92, 0.28, 0.14]} />
        <meshBasicMaterial color="#1a1008" />
      </mesh>
      <mesh position={[0, (yVal + yVah) / 2, 0.04]} castShadow>
        <boxGeometry args={[wallW * 0.96, vaH, 0.16]} />
        <meshStandardMaterial color={color} roughness={0.48} metalness={0.08} />
      </mesh>
      <mesh position={[0, yVal, 0.06]}>
        <boxGeometry args={[wallW * 0.98, 0.1, 0.12]} />
        <meshBasicMaterial color="#e8dcc0" />
      </mesh>
      <mesh position={[0, yVah, 0.06]}>
        <boxGeometry args={[wallW * 0.98, 0.1, 0.12]} />
        <meshBasicMaterial color="#e8dcc0" />
      </mesh>
      <mesh position={[0, yHi, 0.05]} castShadow>
        <boxGeometry args={[wallW * 0.92, 0.28, 0.14]} />
        <meshBasicMaterial color="#f0c84a" />
      </mesh>
      <mesh position={[-wallW * 0.42, 1.95, 0.07]} castShadow>
        <boxGeometry args={[0.28, 3.7, 0.1]} />
        <meshStandardMaterial color="#241810" roughness={0.7} />
      </mesh>
      {(
        [
          [yLo, '#1a1008', 0.18],
          [yVal, '#e8dcc0', 0.12],
          [yVah, '#e8dcc0', 0.12],
          [yHi, '#f0c84a', 0.18],
          [yNode, '#fff4d0', 0.22],
        ] as Array<[number, string, number]>
      ).map(([y, c, h], i) => (
        <mesh key={i} position={[-wallW * 0.42, y, 0.14]}>
          <boxGeometry args={[0.46, h, 0.12]} />
          <meshBasicMaterial color={c} />
        </mesh>
      ))}
    </group>
  )
}

function Fascia({ title, paint, y, width, z }: { title: string; paint: string; y: number; width: number; z: number }) {
  const tex = useMemo(() => makeFasciaTexture(title, paint), [title, paint])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[0, y, z]} castShadow>
      <boxGeometry args={[width, 0.88, 0.18]} />
      <meshStandardMaterial map={tex} roughness={0.48} />
    </mesh>
  )
}

function GableSign({ title, paint, x, y }: { title: string; paint: string; x: number; y: number }) {
  const tex = useMemo(() => makeFasciaTexture(title, paint), [title, paint])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[x, y, 0]} rotation={[0, (x > 0 ? 1 : -1) * (Math.PI / 2), 0]} castShadow>
      <boxGeometry args={[4.35, 1.2, 0.22]} />
      <meshStandardMaterial map={tex} roughness={0.48} />
    </mesh>
  )
}

function EastSign({ title, paint, y, z, width }: { title: string; paint: string; y: number; z: number; width: number }) {
  const tex = useMemo(() => makeFasciaTexture(title, paint), [title, paint])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[0, y, z]} rotation={[0, Math.PI, 0]} castShadow>
      <boxGeometry args={[width, 1.15, 0.22]} />
      <meshBasicMaterial map={tex} />
    </mesh>
  )
}

function YardPlaque() {
  const tex = useMemo(() => makeCourtSignTexture('YARD', '#d48848'), [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group position={[0.15, 0, -2.05]} rotation={[0, Math.PI, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.16, 1.1, 0.16]} />
        <meshStandardMaterial color="#3a2a1c" />
      </mesh>
      <mesh position={[0, 1.42, 0.06]} castShadow>
        <boxGeometry args={[3.05, 0.82, 0.12]} />
        <meshStandardMaterial color="#2a1c14" />
      </mesh>
      <mesh position={[0, 1.42, 0.14]}>
        <planeGeometry args={[2.88, 0.66]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  )
}

function NyCashBunting({ y, z }: { y: number; z: number }) {
  const tex = useMemo(() => makeOpenBannerTexture(), [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[0, y, z]}>
      <boxGeometry args={[3.5, 0.58, 0.1]} />
      <meshStandardMaterial map={tex} roughness={0.55} />
    </mesh>
  )
}

function PrintBurst() {
  const wood = ['#8a6240', '#7a868c', '#6a5840', '#9a7048']
  return (
    <group position={[0, 0.08, 3.55]}>
      {Array.from({ length: 30 }, (_, i) => (
        <mesh
          key={i}
          position={[((i % 5) - 2) * 0.7, 0.26 + Math.floor(i / 5) * 0.48, ((i % 3) - 1) * 0.42]}
          rotation={[0, (i % 4) * 0.08, 0]}
          castShadow
        >
          <boxGeometry args={[0.64, 0.44, 0.52]} />
          <meshStandardMaterial color={wood[i % wood.length]} roughness={0.72} metalness={i % 3 === 1 ? 0.38 : 0.05} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0.12]}>
        <ringGeometry args={[1.55, 2.35, 24]} />
        <meshBasicMaterial color="#c8d890" transparent opacity={0.92} toneMapped={false} />
      </mesh>
    </group>
  )
}

function FadeSweep() {
  return (
    <group position={[0, 0.08, 3.1]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 1.55, 20]} />
        <meshBasicMaterial color="#6a8090" transparent opacity={0.55} toneMapped={false} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0.55, 0]}>
          <boxGeometry args={[0.08, 1.05, 0.7]} />
          <meshStandardMaterial color="#4a4038" />
        </mesh>
      ))}
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
  const taking = stall.printSide === 'buy' && stall.printBoost > 0.08
  const fading = stall.printSide === 'sell' && stall.printBoost > 0.08
  const extra = taking ? 22 : 0
  const filled = Math.round(stall.occupancy * 24)
  const n = fading
    ? 0
    : kind === 'lvn'
      ? stall.clogged
        ? 14 + extra
        : extra
      : (filled > 0 ? Math.max(8, filled) : 0) + extra
  if (n <= 0) return stall.hollow || fading || (kind === 'lvn' && !stall.clogged) ? <EmptyRacks z={z} /> : null
  const wood = kind === 'lvn' ? ['#6a5040', '#5a5850', '#7a6858'] : ['#7a5438', '#6a767c', '#5a4a38']
  const box: [number, number, number] = taking ? [0.62, 0.4, 0.5] : [0.5, 0.32, 0.42]
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh
          key={i}
          position={[
            -1.7 + (i % 5) * (taking ? 0.7 : 0.58),
            box[1] / 2 + Math.floor(i / 5) * (box[1] + 0.05) + stall.printBoost * 0.1,
            z + 0.22 + (i % 2) * 0.36,
          ]}
          rotation={[0, (i % 3) * 0.1, 0]}
          castShadow
        >
          <boxGeometry args={box} />
          <meshStandardMaterial
            color={wood[i % wood.length]}
            roughness={0.74}
            metalness={i % 3 === 1 ? 0.34 : 0.04}
          />
        </mesh>
      ))}
    </group>
  )
}

function EmptyRacks({ z }: { z: number }) {
  return (
    <group position={[0, 0.62, z + 0.15]}>
      {[-0.95, 0, 0.95].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.12, 1.55, 0.95]} />
          <meshStandardMaterial color="#5a5348" metalness={0.22} roughness={0.55} />
        </mesh>
      ))}
      {[0.12, 0.55, 0.98, 1.38].map((y) => (
        <mesh key={y} position={[0, y - 0.5, 0]}>
          <boxGeometry args={[1.95, 0.06, 0.88]} />
          <meshStandardMaterial color="#6a6258" />
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
        <group key={x} position={[x, y, z]}>
          <mesh position={[0, 0, -0.02]}>
            <boxGeometry args={[0.56, 0.7, 0.08]} />
            <meshStandardMaterial color="#f0e6d4" roughness={0.55} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.4, 0.52, 0.06]} />
            <meshStandardMaterial
              color="#5a88a0"
              roughness={0.22}
              metalness={0.15}
              emissive="#d8c080"
              emissiveIntensity={0.08 + lit * 0.55}
            />
          </mesh>
        </group>
      ))}
    </>
  )
}

function Cornice({ w, d, y, color = '#e4d4b8' }: { w: number; d: number; y: number; color?: string }) {
  return (
    <mesh position={[0, y, 0]} castShadow>
      <boxGeometry args={[w, 0.16, d]} />
      <meshStandardMaterial color={color} roughness={0.55} />
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
          color={stall.hollow ? '#b06848' : '#c45432'}
          roughness={0.86}
        />
      </mesh>
      <Cornice w={4.6} d={3.95} y={3.78} />
      <WindowRow xs={[-1.7, -0.85, 0.85, 1.7]} y={2.55} z={2.1} lit={stall.interior} />
      <mesh position={[-1.55, 0.95, 2.05]}>
        <boxGeometry args={[1.5, 1.7, 0.1]} />
        <meshStandardMaterial color="#1a1210" roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.05, 2.28]} castShadow>
        <boxGeometry args={[2.15, 0.12, 0.85]} />
        <meshStandardMaterial color="#c4a05a" roughness={0.48} metalness={0.35} />
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
            <meshStandardMaterial
              color={stall.occupancy < 0.12 ? '#3a2418' : '#ff7030'}
              emissive="#c45c2a"
              emissiveIntensity={stall.occupancy * 1.4}
            />
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
  const g = useGame()
  return (
    <group>
      <mesh position={[0, 2.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.55, 4.1, 4.15]} />
          <meshStandardMaterial
          map={brick}
          color={stall.hollow ? '#b07050' : '#c45a38'}
          roughness={0.86}
        />
      </mesh>
      <mesh position={[0, 4.45, 0]} castShadow>
        <boxGeometry args={[4.95, 0.18, 4.5]} />
        <meshStandardMaterial map={metal} color="#a06a40" roughness={0.52} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, 0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#b07848" roughness={0.48} />
      </mesh>
      <mesh position={[0, 4.95, 0]} rotation={[0, 0, -0.48]} castShadow>
        <boxGeometry args={[3.6, 0.16, 5.05]} />
        <meshStandardMaterial map={metal} color="#b07848" roughness={0.48} />
      </mesh>
      <mesh position={[0, 5.15, 2.35]} rotation={[Math.PI / 2, 0, Math.PI]} castShadow>
        <coneGeometry args={[2.15, 0.22, 3]} />
        <meshStandardMaterial color="#c45a32" roughness={0.7} />
      </mesh>
      {[-1.55, -0.52, 0.52, 1.55].map((x) => (
        <mesh key={x} position={[x, 1.15, 2.2]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 2.3, 8]} />
        <meshStandardMaterial color="#d8c8a8" metalness={0.18} roughness={0.62} />
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
        <meshStandardMaterial color="#6a7068" metalness={0.4} roughness={0.55} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.08 + i * 0.11, 2.62 - i * 0.2]} receiveShadow>
          <boxGeometry args={[2.35 - i * 0.12, 0.12, 0.48]} />
          <meshStandardMaterial color="#d4c4a4" roughness={0.82} />
        </mesh>
      ))}
      <mesh position={[0, 3.52, 2.34]}>
        <circleGeometry args={[0.42, 16]} />
        <meshStandardMaterial color="#f0e8d0" roughness={0.35} />
      </mesh>
      <mesh position={[0, 3.52, 2.36]}>
        <circleGeometry args={[0.08, 10]} />
        <meshStandardMaterial color="#c45a32" />
      </mesh>
      <mesh position={[0.12, 3.62, 2.37]} rotation={[0, 0, -0.55]}>
        <boxGeometry args={[0.06, 0.28, 0.04]} />
        <meshStandardMaterial color="#2a1810" />
      </mesh>
      <mesh position={[-0.02, 3.38, 2.37]} rotation={[0, 0, 0.15]}>
        <boxGeometry args={[0.05, 0.2, 0.04]} />
        <meshStandardMaterial color="#2a1810" />
      </mesh>
      {g.phase !== 'preopen' && <NyCashBunting y={5.35} z={2.42} />}
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
            color="#8a949c"
            metalness={0.32}
            roughness={0.55}
          />
        </mesh>
      ))}
      <mesh position={[0, 1.95, -0.25]} castShadow receiveShadow>
        <boxGeometry args={[3.55, 3.7, 3.15]} />
        <meshStandardMaterial
          map={metal}
            color="#7a868e"
            metalness={0.3}
            roughness={0.58}
        />
      </mesh>
      <mesh position={[0, 4.45, 0]} castShadow>
        <boxGeometry args={[4.15, 0.18, 3.9]} />
        <meshStandardMaterial map={metal} color="#a8b4bc" metalness={0.45} roughness={0.4} />
      </mesh>
      {[-1.5, -0.75, 0, 0.75, 1.5].map((x) => (
        <mesh key={x} position={[x, 4.58, 0]} rotation={[0, 0, 0.55]} castShadow>
          <boxGeometry args={[0.85, 0.08, 3.95]} />
          <meshStandardMaterial map={metal} color="#9aa8b0" metalness={0.42} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 3.55, 2.15]} castShadow>
        <boxGeometry args={[3.4, 0.12, 1.15]} />
        <meshStandardMaterial map={metal} color="#6a7068" metalness={0.32} roughness={0.55} />
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
          color={stall.hollow ? '#b06848' : '#c45432'}
          roughness={0.86}
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
          color={stall.hollow ? '#b06848' : '#c45432'}
          roughness={0.86}
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
          color="#6a7882"
          metalness={0.28}
          roughness={0.58}
        />
      </mesh>
      <mesh position={[1.65, 1.75, 0.25]} castShadow>
        <boxGeometry args={[1.7, 3.5, 3.7]} />
        <meshStandardMaterial
          map={metal}
          color="#5a6a74"
          metalness={0.28}
          roughness={0.6}
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

/** Brick money-house. Gold cab tracks live Σ(P·V)/ΣV inside a 4-storey shell. */
function Spire({
  brick,
  metal,
  avwap,
  live,
  stall,
  printed,
}: {
  brick: THREE.Texture
  metal: THREE.Texture
  avwap: AnchoredVwap
  live: number
  stall: Stall
  printed: boolean
}) {
  const cab = useRef<THREE.Mesh>(null)
  const deck = useRef<THREE.Mesh>(null)
  const needle = useRef<THREE.Mesh>(null)
  const cabY = useRef(rangeHeight(avwap.vwap, avwap.lower2, avwap.upper2, 1.35, 4.85))
  const liveY = useRef(rangeHeight(live, avwap.lower2, avwap.upper2, 1.35, 4.85))

  useFrame((_, dt) => {
    const target = rangeHeight(avwap.vwap, avwap.lower2, avwap.upper2, 1.35, 4.85)
    const liveT = rangeHeight(live, avwap.lower2, avwap.upper2, 1.35, 4.85)
    cabY.current = THREE.MathUtils.lerp(cabY.current, target, 1 - Math.exp(-dt * 5.2))
    liveY.current = THREE.MathUtils.lerp(liveY.current, liveT, 1 - Math.exp(-dt * 7.4))
    if (cab.current) cab.current.position.y = cabY.current
    if (deck.current) deck.current.position.y = cabY.current - 0.48
    if (needle.current) needle.current.position.y = liveY.current
  })

  const yU = rangeHeight(avwap.upper1, avwap.lower2, avwap.upper2, 1.35, 4.85)
  const yL = rangeHeight(avwap.lower1, avwap.lower2, avwap.upper2, 1.35, 4.85)

  return (
    <group>
      <mesh position={[0, 2.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.45, 4.3, 3.45]} />
        <meshStandardMaterial map={brick} color={stall.hollow ? '#a86850' : '#b85a3a'} roughness={0.86} />
      </mesh>
      <mesh position={[0, 4.42, 0]} castShadow>
        <boxGeometry args={[3.7, 0.18, 3.7]} />
        <meshStandardMaterial map={metal} color="#2a6a78" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 5.05, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[2.15, 1.05, 4]} />
        <meshStandardMaterial color="#2a6a78" roughness={0.55} />
      </mesh>
      <WindowRow xs={[-1.05, 1.05]} y={2.55} z={1.76} lit={stall.interior} />
      <RollDoor width={1.45} height={1.7} open={stall.door} z={1.78} />
      <mesh position={[-1.72, 2.7, 0.15]} castShadow>
        <boxGeometry args={[0.16, 4.4, 0.16]} />
        <meshStandardMaterial color="#8a6a38" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh ref={deck} position={[0, 2.4, 1.88]} castShadow>
        <boxGeometry args={[2.65, 0.18, 0.7]} />
        <meshStandardMaterial color="#8a7a52" metalness={0.42} roughness={0.48} />
      </mesh>
      <mesh ref={cab} position={[0, 2.9, 2.05]} castShadow>
        <boxGeometry args={[1.65, 1.05, 0.98]} />
        <meshStandardMaterial
          color="#b89048"
          metalness={0.42}
          roughness={0.48}
          emissive="#8a6a30"
          emissiveIntensity={printed ? 0.7 : 0.22}
        />
      </mesh>
      <mesh ref={needle} position={[1.62, 2.8, 1.78]} castShadow>
        <boxGeometry args={[0.28, 0.7, 0.55]} />
        <meshBasicMaterial color="#ffe080" />
      </mesh>
      <mesh position={[1.78, yU, 0]} castShadow>
        <boxGeometry args={[0.22, 0.28, 3.2]} />
        <meshStandardMaterial color="#4a78c0" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[-1.78, yL, 0]} castShadow>
        <boxGeometry args={[0.22, 0.28, 3.2]} />
        <meshStandardMaterial color="#c49040" metalness={0.35} roughness={0.45} />
      </mesh>
      {(stall.interior > 0.2 || printed) && (
        <pointLight color="#4aa0b0" intensity={stall.interior * 4 + stall.printBoost * 5} distance={8} position={[0, 3.2, 0.6]} />
      )}
    </group>
  )
}

function Loft({
  brick,
  avwap,
  stall,
}: {
  brick: THREE.Texture
  metal: THREE.Texture
  avwap: AnchoredVwap
  stall: Stall
}) {
  const deck = useRef<THREE.Group>(null)
  const target = rangeHeight(avwap.upper1, avwap.lower2, avwap.upper2, 2.15, 3.85)
  useFrame((_, dt) => {
    if (!deck.current) return
    deck.current.position.y = THREE.MathUtils.lerp(deck.current.position.y, target, 1 - Math.exp(-dt * 4.2))
  })
  return (
    <group>
      <mesh position={[0, 1.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.55, 3.1, 3.4]} />
        <meshStandardMaterial map={brick} color={stall.hollow ? '#b06848' : '#c45432'} roughness={0.86} />
      </mesh>
      <group ref={deck} position={[0, target, 0]}>
        <mesh position={[0, 0.85, 0]} castShadow>
          <boxGeometry args={[3.7, 1.55, 3.55]} />
          <meshStandardMaterial map={brick} color="#c45a38" roughness={0.78} />
        </mesh>
        <mesh position={[0, 1.75, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[2.15, 0.7, 4]} />
          <meshStandardMaterial color="#8a4030" />
        </mesh>
        {[-0.75, 0.75].map((x) => (
          <mesh key={x} position={[x, 0.85, 1.82]}>
            <boxGeometry args={[1.05, 0.95, 0.08]} />
            <meshStandardMaterial
              color="#e8f4ff"
              roughness={0.12}
              metalness={0.35}
              emissive="#c8e0f4"
              emissiveIntensity={0.28 + stall.interior * 0.5}
            />
          </mesh>
        ))}
      </group>
      <WindowRow xs={[-0.95, 0.95]} y={2.15} z={1.74} lit={stall.interior} />
      <RollDoor width={1.4} height={1.6} open={stall.door} z={1.76} />
    </group>
  )
}

function Pit({
  brick,
  metal,
  avwap,
  stall,
}: {
  brick: THREE.Texture
  metal: THREE.Texture
  avwap: AnchoredVwap
  stall: Stall
}) {
  const pit = useRef<THREE.Mesh>(null)
  const target = rangeHeight(avwap.lower1, avwap.lower2, avwap.upper2, 0.18, 1.35)
  useFrame((_, dt) => {
    if (!pit.current) return
    pit.current.position.y = THREE.MathUtils.lerp(pit.current.position.y, target + 0.12, 1 - Math.exp(-dt * 4.2))
  })
  return (
    <group>
      <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.5, 2.3, 3.35]} />
        <meshStandardMaterial map={brick} color={stall.hollow ? '#a87850' : '#b88848'} roughness={0.84} />
      </mesh>
      <mesh position={[0, 2.4, 0]} castShadow>
        <boxGeometry args={[3.7, 0.16, 3.55]} />
        <meshStandardMaterial map={metal} color="#6a5a40" metalness={0.32} roughness={0.55} />
      </mesh>
      <mesh ref={pit} position={[0, target + 0.12, 0.15]} receiveShadow>
        <boxGeometry args={[2.4, 0.2, 2.2]} />
        <meshStandardMaterial color="#8a7040" roughness={0.58} metalness={0.32} emissive="#6a5028" emissiveIntensity={0.12} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[0, 0.14 + i * 0.16, 1.85 - i * 0.18]} rotation={[-0.38, 0, 0]}>
          <boxGeometry args={[1.7, 0.1, 0.42]} />
          <meshStandardMaterial color="#b07a38" />
        </mesh>
      ))}
      {stall.occupancy > 0.12 &&
        [0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[-0.85 + i * 0.42, target + 0.4, 0.2]} castShadow>
            <boxGeometry args={[0.38, 0.36, 0.34]} />
            <meshStandardMaterial color="#6a5040" roughness={0.75} />
          </mesh>
        ))}
      <RollDoor width={1.5} height={1.45} open={stall.door} z={1.72} />
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
