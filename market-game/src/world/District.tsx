import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { closeInspect, inspectStore, setWalkTarget } from '../game/gameStore'
import { OPEN_CINEMATIC_SEC } from '../game/session'
import { storeAtPoint, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'
import {
  makeFasciaTexture,
  makeOpenBannerTexture,
  makeStencilTexture,
  useAsphaltTexture,
  useBrickTexture,
  useConcreteTexture,
  useDirtTexture,
  useGrassTexture,
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
  const grass = useGrassTexture()
  const dirt = useDirtTexture()
  const dawn = g.phase === 'preopen'
  const sunK =
    g.phase === 'opening' ? Math.min(1, g.openElapsed / OPEN_CINEMATIC_SEC) : dawn ? 0 : 1
  const sunPos: [number, number, number] = [
    26 - 4 * sunK,
    12 + 30 * sunK,
    18,
  ]
  const sun = sunK < 0.5 ? '#ffc488' : '#fff6d0'
  const sky = sunK < 0.35 ? '#c8b090' : '#7eb8dc'

  useFrame(() => {
    gl.toneMappingExposure = 1.18 + 0.2 * sunK
    gl.setClearColor(sky, 1)
  })

  return (
    <>
      <hemisphereLight args={[sunK < 0.35 ? '#f0d0b0' : '#e8f4ff', sunK < 0.35 ? '#7a6a48' : '#6a9a48', 0.82 + 0.46 * sunK]} />
      <ambientLight intensity={0.58 + 0.4 * sunK} />
      <directionalLight
        position={sunPos}
        intensity={1.85 + sunK}
        color={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00028}
        shadow-normalBias={0.05}
        shadow-camera-near={2}
        shadow-camera-far={90}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
      />
      <directionalLight position={[18, 16, 18]} intensity={0.42 + 0.36 * sunK} color="#fff4dc" />
      <directionalLight position={[-20, 14, -10]} intensity={0.52 + 0.18 * sunK} color="#b5dcff" />
      <directionalLight position={[6, 8, -18]} intensity={0.16 + 0.12 * sunK} color="#ffe8b0" />
      <color attach="background" args={[sky]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[56, 56]} />
        <meshStandardMaterial map={grass} roughness={0.88} color="#58b03c" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <ringGeometry args={[YARD + 0.2, YARD + 7.4, 4]} />
        <meshStandardMaterial map={grass} roughness={0.86} color="#4eaa38" />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
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
        <planeGeometry args={[YARD * 2 - 0.4, YARD * 2 - 0.4]} />
        <meshStandardMaterial map={concrete} roughness={0.84} color="#c8b8a4" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[4.4, 4.4]} />
        <meshStandardMaterial map={asphalt} color="#5a564e" roughness={0.88} />
      </mesh>

      <WingPads brick={brick} concrete={concrete} dirt={dirt} />
      <YardWalls brick={brick} />
      <CliffBezel dirt={dirt} grass={grass} />
      <BellTower metal={metal} brick={brick} ringing={g.phase === 'opening'} opening={g.phase === 'opening'} />
      <YardDressing />
      <WorkLamps on={g.shutter} />
    </>
  )
}

function YardWalls({ brick }: { brick: THREE.Texture }) {
  const t = YARD
  const h = 1.35
  const segs: Array<[number, number, number, number]> = [
    [0, -t, t * 2 + 1.2, 0.72],
    [0, t, t * 2 + 1.2, 0.72],
    [-t, 0, 0.72, t * 2],
    [t, 0, 0.72, t * 2],
  ]
  return (
    <group>
      {segs.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial map={brick} color="#d45c36" roughness={0.8} emissive="#c44a28" emissiveIntensity={0.12} />
        </mesh>
      ))}
      {([
        [-t, -t],
        [t, -t],
        [-t, t],
        [t, t],
      ] as Array<[number, number]>).map(([x, z]) => (
        <group key={`${x}${z}`}>
          <mesh position={[x, 1.7, z]} castShadow>
            <boxGeometry args={[1.35, 3.4, 1.35]} />
            <meshStandardMaterial map={brick} color="#c44a30" roughness={0.8} emissive="#b04028" emissiveIntensity={0.1} />
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

function CliffBezel({ dirt, grass }: { dirt: THREE.Texture; grass: THREE.Texture }) {
  const blocks: Array<[number, number, number, number, number]> = [
    [-19, -10, 5.5, 3.2, 8],
    [-18, 6, 5, 2.8, 7],
    [18, -8, 5.2, 3, 7.5],
    [19, 8, 4.8, 2.6, 6.5],
    [0, -20, 14, 2.4, 4.2],
    [8, 20, 9, 2.2, 4],
    [-10, 20, 8, 2.5, 4.4],
  ]
  return (
    <group>
      {blocks.map(([x, z, w, h, d], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial map={dirt} color="#9a7a54" roughness={0.92} />
          </mesh>
          <mesh position={[0, h + 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w * 0.92, d * 0.92]} />
            <meshStandardMaterial map={grass} color="#4aa832" roughness={0.84} emissive="#2a7018" emissiveIntensity={0.08} />
          </mesh>
        </group>
      ))}
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
      <mesh position={[0, 2.35, 0]} castShadow>
        <boxGeometry args={[2.15, 4.7, 2.15]} />
        <meshStandardMaterial map={brick} color="#d45630" roughness={0.78} emissive="#c44828" emissiveIntensity={0.14} />
      </mesh>
      {[-0.62, 0.62].map((x) =>
        [1.35, 2.45, 3.5].map((y) => (
          <mesh key={`${x}${y}`} position={[x, y, 1.1]}>
            <boxGeometry args={[0.42, 0.62, 0.08]} />
            <meshStandardMaterial color="#2a3a44" roughness={0.25} />
          </mesh>
        )),
      )}
      <mesh position={[0, 4.95, 0]} castShadow>
        <boxGeometry args={[2.55, 0.55, 2.55]} />
        <meshStandardMaterial map={metal} color="#8a6a38" metalness={0.4} roughness={0.45} />
      </mesh>
      <mesh position={[0, 5.55, 0]} castShadow>
        <coneGeometry args={[1.15, 1.1, 4]} />
        <meshStandardMaterial color="#6a3a28" roughness={0.7} />
      </mesh>
      <mesh ref={bell} position={[0, 4.55, 0]} castShadow>
        <sphereGeometry args={[0.58, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
        <meshStandardMaterial color="#e8c04a" metalness={0.7} roughness={0.28} emissive="#c4a046" emissiveIntensity={ringing ? 0.45 : 0.08} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 4.35, 0]}>
        <ringGeometry args={[0.7, 0.88, 24]} />
        <meshBasicMaterial color="#ffe080" transparent opacity={0} toneMapped={false} />
      </mesh>
      {opening && (
        <mesh position={[0, 6.35, 1.35]} rotation={[0, Math.PI / 4, 0]}>
          <planeGeometry args={[3.6, 0.72]} />
          <meshStandardMaterial map={banner} roughness={0.55} />
        </mesh>
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 7.25]} receiveShadow>
        <planeGeometry args={[17.4, 8.2]} />
        <meshStandardMaterial map={brick} color="#e08858" roughness={0.84} emissive="#c06038" emissiveIntensity={0.12} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[8.7, 0.012, -1.7]} receiveShadow>
        <planeGeometry args={[8.0, 17.2]} />
        <meshStandardMaterial map={dirt} color="#c49a60" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-9.2, 0.014, 0]} receiveShadow>
        <planeGeometry args={[7.8, 15.4]} />
        <meshStandardMaterial map={concrete} color="#6eb0c0" roughness={0.82} />
      </mesh>
      <Stencil word="YESTERDAY" ink="#c45c2a" position={[0, 0.03, 4.15]} />
      <Stencil word="FIVE-DAY" ink="#a34a38" position={[8.65, 0.03, -1.6]} rot={-Math.PI / 2} />
      <Stencil word="FIVE-MONTH" ink="#2a6a78" position={[-9.15, 0.03, 0]} rot={Math.PI / 2} />
      <WingSign word="YESTERDAY" paint="#c45c2a" position={[0, 0, 11.35]} />
      <WingSign word="FIVE-DAY" paint="#a34a38" position={[11.55, 0, -1.55]} />
      <WingSign word="FIVE-MONTH" paint="#2a6a78" position={[-11.55, 0, 1.55]} />
    </group>
  )
}

function Stencil({
  word,
  ink,
  position,
  rot = 0,
}: {
  word: string
  ink: string
  position: [number, number, number]
  rot?: number
}) {
  const tex = useMemo(() => makeStencilTexture(word, ink), [word, ink])
  return (
    <mesh rotation={[-Math.PI / 2, 0, rot]} position={position}>
        <planeGeometry args={[6.2, 1.35]} />
      <meshStandardMaterial map={tex} transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}

function WingSign({
  word,
  paint,
  position,
}: {
  word: string
  paint: string
  position: [number, number, number]
}) {
  const tex = useMemo(() => makeFasciaTexture(word, paint), [word, paint])
  return (
    <group position={position} rotation={[0, Math.PI / 4, 0]}>
      {[-1.7, 1.7].map((x) => (
        <mesh key={x} position={[x, 1.15, 0]} castShadow>
          <boxGeometry args={[0.16, 2.3, 0.16]} />
          <meshStandardMaterial color="#4a3020" />
        </mesh>
      ))}
      <mesh position={[0, 2.15, 0]} castShadow>
        <boxGeometry args={[5.4, 1.15, 0.18]} />
        <meshStandardMaterial map={tex} roughness={0.55} />
      </mesh>
    </group>
  )
}

function WorkLamps({ on }: { on: number }) {
  const spots: Array<[number, number]> = [
    [-2.4, 2.4],
    [2.4, 2.4],
    [-2.4, -2.4],
    [2.4, -2.4],
    [-9.2, 0],
    [3.4, 9.2],
    [8.9, -1.6],
  ]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.35, 0]}>
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
