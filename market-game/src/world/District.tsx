import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { closeInspect, inspectStore, setWalkTarget } from '../game/gameStore'
import { OPEN_CINEMATIC_SEC } from '../game/session'
import { COURT_SIGNS, COURT_STENCILS, STORE_PLAQUES, storeAtPoint, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'
import { ClashTerrain, ClashWalls, MorningSun } from './ClashTerrain'
import {
  makeCourtSignTexture,
  makeOpenBannerTexture,
  makeStencilTexture,
  useAsphaltTexture,
  useBrickTexture,
  useConcreteTexture,
  useDirtTexture,
  useMetalTexture,
} from './textures'
import { YardDressing } from './YardDressing'

export function District() {
  const g = useGame()
  const { gl } = useThree()
  const asphalt = useAsphaltTexture()
  const brick = useBrickTexture()
  const metal = useMetalTexture()
  const concrete = useConcreteTexture()
  const dirt = useDirtTexture()
  const dawn = g.phase === 'preopen'
  const sunK =
    g.phase === 'opening' ? Math.min(1, g.openElapsed / OPEN_CINEMATIC_SEC) : dawn ? 0 : 1
    const sky = sunK < 0.35 ? '#e8bc7c' : '#6ac8ee'

  useFrame(() => {
    gl.toneMappingExposure = 1.2 + 0.14 * sunK
    gl.setClearColor(sky, 1)
    gl.shadowMap.type = THREE.PCFSoftShadowMap
  })

  return (
    <>
      <MorningSun warm={sunK < 0.45} />
      <color attach="background" args={[sky]} />

      <ClashTerrain wall={YARD} />

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation()
          const hit = storeAtPoint(e.point.x, e.point.z, 2.8)
          if (hit) inspectStore(hit.id)
          else {
            closeInspect()
            setWalkTarget(e.point.x, e.point.z)
          }
        }}
      >
        <planeGeometry args={[YARD * 2 - 0.55, YARD * 2 - 0.55]} />
        <meshStandardMaterial map={concrete} roughness={0.86} color="#b8a894" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.024, 0]} receiveShadow>
        <planeGeometry args={[5.2, 5.2]} />
        <meshStandardMaterial map={asphalt} color="#5a564e" roughness={0.9} />
      </mesh>
      <WearPaths dirt={dirt} />

      <WingPads brick={brick} concrete={concrete} dirt={dirt} />
      <ClashWalls wall={YARD} brick={brick} />
      <BellTower metal={metal} brick={brick} ringing={g.phase === 'opening'} opening={g.phase === 'opening'} />
      <SouthGate open={g.shutter} />
      <StackSteam on={g.phase === 'opening' ? Math.min(1, g.shutter + 0.2) : g.phase === 'live' ? 0.35 : 0} />
      <YardDressing />
      <WorkLamps on={g.shutter} />
    </>
  )
}

function WearPaths({ dirt }: { dirt: THREE.Texture }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 4.2]} receiveShadow>
        <planeGeometry args={[3.4, 10.8]} />
        <meshStandardMaterial map={dirt} color="#8a6e4c" roughness={0.92} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[4.1, 0.018, 0]} receiveShadow>
        <planeGeometry args={[3.2, 11.2]} />
        <meshStandardMaterial map={dirt} color="#8a6e4c" roughness={0.92} transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[-4.1, 0.018, 0]} receiveShadow>
        <planeGeometry args={[3.0, 10.4]} />
        <meshStandardMaterial map={dirt} color="#8a6e4c" roughness={0.92} transparent opacity={0.48} />
      </mesh>
    </group>
  )
}

function BellTower({
  metal,
  brick,
  ringing,
  opening,
}: {
  metal: THREE.Texture
  brick: THREE.Texture
  ringing: boolean
  opening: boolean
}) {
  const bell = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const banner = useMemo(() => makeOpenBannerTexture(), [])
  useFrame((s) => {
    if (bell.current) bell.current.rotation.z = ringing ? Math.sin(s.clock.elapsedTime * 9) * 0.34 : 0
    if (ring.current) {
      const k = (s.clock.elapsedTime % 1.4) / 1.4
      ring.current.scale.setScalar(1 + k * 2.4)
      const mat = ring.current.material as THREE.MeshBasicMaterial
      mat.opacity = ringing ? (1 - k) * 0.55 : 0
    }
  })
  return (
    <group>
      <mesh position={[0, 2.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.45, 5.1, 2.45]} />
        <meshStandardMaterial map={brick} color="#c45632" roughness={0.8} />
      </mesh>
      {[-0.62, 0.62].map((x) =>
        [1.35, 2.45, 3.5].map((y) => (
          <group key={`${x}${y}`} position={[x, y, 1.1]}>
            <mesh>
              <boxGeometry args={[0.52, 0.74, 0.08]} />
              <meshStandardMaterial color="#f0e6d4" roughness={0.55} />
            </mesh>
            <mesh position={[0, 0, 0.03]}>
              <boxGeometry args={[0.38, 0.56, 0.06]} />
              <meshStandardMaterial color="#2a3a44" roughness={0.25} />
            </mesh>
          </group>
        )),
      )}
      <mesh position={[0, 4.15, 1.18]} castShadow>
        <boxGeometry args={[1.85, 1.65, 0.12]} />
        <meshStandardMaterial color="#1a1210" roughness={0.7} />
      </mesh>
      <mesh position={[0, 5.35, 0]} castShadow>
        <boxGeometry args={[2.85, 0.6, 2.85]} />
        <meshStandardMaterial map={metal} color="#c4a05a" metalness={0.42} roughness={0.42} />
      </mesh>
      <mesh position={[0, 6.05, 0]} castShadow>
        <coneGeometry args={[1.28, 1.25, 4]} />
        <meshStandardMaterial color="#6a3a28" roughness={0.7} />
      </mesh>
      <mesh ref={bell} position={[0, 4.55, 1.05]} castShadow>
        <sphereGeometry args={[0.95, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.7} roughness={0.28} emissive="#c4a046" emissiveIntensity={ringing ? 0.85 : 0.12} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 4.75, 0]}>
        <ringGeometry args={[0.85, 1.15, 24]} />
        <meshBasicMaterial color="#ffe080" transparent opacity={0} toneMapped={false} />
      </mesh>
      {opening && (
        <>
          <mesh position={[0, 6.85, 1.45]} rotation={[0, Math.PI / 4, 0]}>
            <planeGeometry args={[4.2, 0.85]} />
            <meshStandardMaterial map={banner} roughness={0.55} />
          </mesh>
          <mesh position={[0, 3.15, 1.22]}>
            <boxGeometry args={[2.05, 0.55, 0.08]} />
            <meshStandardMaterial map={banner} roughness={0.55} />
          </mesh>
        </>
      )}
      {ringing && <pointLight color="#ffc070" intensity={14} distance={16} position={[0, 4.4, 1.2]} />}
    </group>
  )
}

function WingPads({
  brick,
  concrete,
  dirt,
}: {
  brick: THREE.Texture
  concrete: THREE.Texture
  dirt: THREE.Texture
}) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 7.7]} receiveShadow>
        <planeGeometry args={[18.4, 8.4]} />
        <meshStandardMaterial map={brick} color="#c47a58" roughness={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[9.3, 0.016, -1.9]} receiveShadow>
        <planeGeometry args={[8.2, 17.4]} />
        <meshStandardMaterial map={dirt} color="#a88858" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-10.9, 0.018, -1.2]} receiveShadow>
        <planeGeometry args={[8.6, 16.2]} />
        <meshStandardMaterial map={concrete} color="#6aa0b0" roughness={0.84} />
      </mesh>
      {COURT_STENCILS.map((s) => (
        <Stencil key={s.word} word={s.word} ink={s.ink} position={[s.x, 0.055, s.z]} w={s.w} d={s.d} />
      ))}
      {COURT_SIGNS.map((s) => (
        <CourtPlaque key={s.word} word={s.word} ink={s.ink} x={s.x} z={s.z} wide={s.wide} />
      ))}
      {STORE_PLAQUES.map((s) => (
        <CourtPlaque key={`store-${s.word}`} word={s.word} ink={s.ink} x={s.x} z={s.z} wide={s.wide} />
      ))}
    </group>
  )
}

function Stencil({
  word,
  ink,
  position,
  w,
  d,
}: {
  word: string
  ink: string
  position: [number, number, number]
  w: number
  d: number
}) {
  const tex = useMemo(() => makeStencilTexture(word, ink), [word, ink])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial map={tex} toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function CourtPlaque({
  word,
  ink,
  x,
  z,
  wide,
}: {
  word: string
  ink: string
  x: number
  z: number
  wide: number
}) {
  const tex = useMemo(() => makeCourtSignTexture(word, ink), [word, ink])
  return (
    <group position={[x, 0, z]} rotation={[0, Math.PI / 4, 0]}>
      <mesh position={[0, 0.7, 0.18]} castShadow>
        <boxGeometry args={[0.18, 1.4, 0.18]} />
        <meshStandardMaterial color="#3a2a1c" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.72, 0.28]} castShadow>
        <boxGeometry args={[wide, 1.05, 0.16]} />
        <meshStandardMaterial color="#2a1c14" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.72, 0.38]}>
        <planeGeometry args={[wide - 0.18, 0.88]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  )
}

function SouthGate({ open }: { open: number }) {
  return (
    <group position={[0, 0, 12.15]}>
      {[-2.25, 2.25].map((x) => (
        <group key={x}>
          <mesh position={[x, 1.7, 0]} castShadow>
            <boxGeometry args={[0.62, 3.4, 0.62]} />
            <meshStandardMaterial color="#b84a30" roughness={0.75} />
          </mesh>
          <mesh position={[x, 3.48, 0]} castShadow>
            <boxGeometry args={[0.78, 0.16, 0.78]} />
            <meshStandardMaterial color="#c4a05a" metalness={0.4} roughness={0.45} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.55 + open * 3.15, 0.08]} castShadow>
        <boxGeometry args={[4.8, 0.62, 0.58]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.45} roughness={0.35} emissive="#c4a046" emissiveIntensity={0.25 + open * 1.1} />
      </mesh>
      {open > 0.08 && (
        <mesh position={[0, 0.12, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 2.4, 24]} />
          <meshBasicMaterial color="#ffe080" transparent opacity={0.25 + open * 0.45} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

function StackSteam({ on }: { on: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((s) => {
    if (!ref.current) return
    ref.current.visible = on > 0.04
    const t = s.clock.elapsedTime
    ref.current.children.forEach((ch, i) => {
      ch.position.y = 6.2 + ((t * 0.55 + i * 0.33) % 1.8)
      const mat = (ch as THREE.Mesh).material as THREE.MeshBasicMaterial
      mat.opacity = on * (0.35 - ((t * 0.55 + i * 0.33) % 1.8) * 0.16)
    })
  })
  if (on <= 0) return null
  return (
    <group ref={ref} position={[-3.2, 0, 6.9]}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 6.4, 0]}>
          <sphereGeometry args={[0.32 + i * 0.04, 8, 6]} />
          <meshBasicMaterial color="#f4efe4" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function WorkLamps({ on }: { on: number }) {
  const spots: Array<[number, number]> = [
    [-2.4, 2.4],
    [2.4, 2.4],
    [-2.4, -2.4],
    [2.4, -2.4],
    [-9.2, 4.2],
    [-9.2, -1.4],
    [-9.2, -6.8],
    [3.4, 9.2],
    [8.9, -1.6],
    [-4.2, 9.0],
    [6.6, 8.8],
    [0.2, 11.2],
    [8.6, 3.2],
    [-8.4, 8.6],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.55, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.1, 3.1, 6]} />
            <meshStandardMaterial color="#4a4038" metalness={0.45} />
          </mesh>
          <mesh position={[0, 3.15, 0.12]}>
            <boxGeometry args={[0.42, 0.16, 0.5]} />
            <meshStandardMaterial
              color={on > 0.12 ? '#ffe2a8' : '#4a4038'}
              emissive="#ffb060"
              emissiveIntensity={on * 2.2}
            />
          </mesh>
          <mesh position={[0, 3.02, 0.22]}>
            <sphereGeometry args={[0.14, 8, 6]} />
            <meshBasicMaterial color={on > 0.12 ? '#ffe8b0' : '#2a2218'} toneMapped={false} />
          </mesh>
          {on > 0.18 && <pointLight color="#ffc070" intensity={on * 4.5} distance={7.5} position={[0, 2.9, 0.35]} />}
        </group>
      ))}
    </group>
  )
}
