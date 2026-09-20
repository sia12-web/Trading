import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { closeInspect, inspectStore, setWalkTarget } from '../game/gameStore'
import { OPEN_CINEMATIC_SEC } from '../game/session'
import { COURT_SIGNS, COURT_STENCILS, storeAtPoint, YARD } from '../game/stores'
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
    gl.toneMappingExposure = 1.14 + 0.12 * sunK
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
          <mesh key={`${x}${y}`} position={[x, y, 1.1]}>
            <boxGeometry args={[0.42, 0.62, 0.08]} />
            <meshStandardMaterial color="#2a3a44" roughness={0.25} />
          </mesh>
        )),
      )}
      <mesh position={[0, 5.35, 0]} castShadow>
        <boxGeometry args={[2.85, 0.6, 2.85]} />
        <meshStandardMaterial map={metal} color="#8a6a38" metalness={0.4} roughness={0.45} />
      </mesh>
      <mesh position={[0, 6.05, 0]} castShadow>
        <coneGeometry args={[1.28, 1.25, 4]} />
        <meshStandardMaterial color="#6a3a28" roughness={0.7} />
      </mesh>
      <mesh ref={bell} position={[0, 5.05, 0]} castShadow>
        <sphereGeometry args={[0.78, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.7} roughness={0.28} emissive="#c4a046" emissiveIntensity={ringing ? 0.45 : 0.08} />
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
      {ringing && <pointLight color="#ffc070" intensity={9} distance={12} position={[0, 4.5, 0]} />}
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
      <meshBasicMaterial map={tex} toneMapped={false} />
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
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.2, 1.35, 0.2]} />
        <meshStandardMaterial color="#3a2a1c" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.58, 0.04]} castShadow>
        <boxGeometry args={[wide, 0.98, 0.16]} />
        <meshStandardMaterial color="#2a1c14" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.58, 0.14]}>
        <planeGeometry args={[wide - 0.2, 0.8]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  )
}

function SouthGate({ open }: { open: number }) {
  return (
    <group position={[0, 0, 12.15]}>
      {[-2.25, 2.25].map((x) => (
        <mesh key={x} position={[x, 1.7, 0]} castShadow>
          <boxGeometry args={[0.62, 3.4, 0.62]} />
          <meshStandardMaterial color="#b84a30" roughness={0.75} />
        </mesh>
      ))}
      <mesh position={[0, 0.48 + open * 3.05, 0.08]} castShadow>
        <boxGeometry args={[4.4, 0.48, 0.5]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.45} roughness={0.35} emissive="#c4a046" emissiveIntensity={0.2 + open * 0.7} />
      </mesh>
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
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.35, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.09, 2.7, 6]} />
            <meshStandardMaterial color="#4a4038" metalness={0.45} />
          </mesh>
          <mesh position={[0, 2.75, 0.1]}>
            <boxGeometry args={[0.32, 0.12, 0.4]} />
            <meshStandardMaterial
              color={on > 0.15 ? '#ffe2a8' : '#4a4038'}
              emissive="#ffb060"
              emissiveIntensity={on * 1.35}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}
