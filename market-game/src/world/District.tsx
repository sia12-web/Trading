import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { closeInspect, inspectStore, setWalkTarget } from '../game/gameStore'
import { OPEN_CINEMATIC_SEC } from '../game/session'
import { storeAtPoint, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'
import { ClashTerrain, MorningSun } from './ClashTerrain'
import {
  makeFasciaTexture,
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
  const sky = sunK < 0.35 ? '#c4a070' : '#6aa8cc'

  useFrame(() => {
    gl.toneMappingExposure = 0.96 + 0.16 * sunK
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
      <YardWalls brick={brick} />
      <BellTower metal={metal} brick={brick} ringing={g.phase === 'opening'} opening={g.phase === 'opening'} />
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
      <mesh position={[0, 2.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.15, 4.7, 2.15]} />
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
      <Stencil word="YESTERDAY" ink="#c45c2a" position={[0, 0.03, 4.35]} />
      <Stencil word="FIVE-DAY" ink="#a34a38" position={[9.25, 0.03, -1.8]} rot={-Math.PI / 2} />
      <Stencil word="FIVE-MONTH" ink="#2a6a78" position={[-10.9, 0.03, -1.4]} rot={Math.PI / 2} />
      <WingSign word="YESTERDAY" paint="#c45c2a" position={[0, 0, 11.55]} />
      <WingSign word="FIVE-DAY" paint="#a34a38" position={[10.75, 0, 6.15]} />
      <WingSign word="FIVE-MONTH" paint="#2a6a78" position={[-12.35, 0, 10.15]} />
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
