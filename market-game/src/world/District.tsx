import { Sky } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { closeInspect, inspectStore, setWalkTarget } from '../game/gameStore'
import { storeAtPoint, YARD } from '../game/stores'
import { useGame } from '../ui/useGame'
import {
  makeFasciaTexture,
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
  const sunPos: [number, number, number] = dawn ? [26, 12, 18] : [22, 42, 18]
  const sun = dawn ? '#ffc488' : '#fff6d0'
  const sky = dawn ? '#c8b090' : '#6eb4e8'

  useFrame(() => {
    gl.toneMappingExposure = dawn ? 1.18 : 1.38
    gl.setClearColor(sky, 1)
  })

  return (
    <>
      <Sky
        sunPosition={sunPos}
        turbidity={dawn ? 5.2 : 3.2}
        rayleigh={dawn ? 1.2 : 0.82}
        mieCoefficient={dawn ? 0.005 : 0.0035}
        mieDirectionalG={0.7}
      />
      <hemisphereLight args={[dawn ? '#f0d0b0' : '#e8f4ff', dawn ? '#7a6a48' : '#6a9a48', dawn ? 0.82 : 1.28]} />
      <ambientLight intensity={dawn ? 0.58 : 0.98} />
      <directionalLight
        position={sunPos}
        intensity={dawn ? 1.85 : 2.85}
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
      <directionalLight position={[18, 16, 18]} intensity={dawn ? 0.42 : 0.78} color="#fff4dc" />
      <directionalLight position={[-20, 14, -10]} intensity={dawn ? 0.52 : 0.7} color="#b5dcff" />
      <directionalLight position={[6, 8, -18]} intensity={dawn ? 0.16 : 0.28} color="#ffe8b0" />
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
      <BellTower metal={metal} brick={brick} ringing={g.phase === 'opening'} />
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
}: {
  metal: THREE.Texture
  brick: THREE.Texture
  ringing: boolean
}) {
  const bell = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (!bell.current) return
    bell.current.rotation.z = ringing ? Math.sin(s.clock.elapsedTime * 9) * 0.28 : 0
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
      <mesh ref={bell} position={[0, 4.35, 0]} castShadow>
        <sphereGeometry args={[0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
        <meshStandardMaterial color="#c4a046" metalness={0.7} roughness={0.28} />
      </mesh>
      {ringing && <pointLight color="#ffc070" intensity={6} distance={8} position={[0, 4.4, 0]} />}
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 6.35]} receiveShadow>
        <planeGeometry args={[17.4, 7.6]} />
        <meshStandardMaterial map={brick} color="#e08858" roughness={0.84} emissive="#c06038" emissiveIntensity={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -6.35]} receiveShadow>
        <planeGeometry args={[17.4, 7.6]} />
        <meshStandardMaterial map={dirt} color="#b08a58" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[-7.35, 0.014, 0]} receiveShadow>
        <planeGeometry args={[12.4, 6.6]} />
        <meshStandardMaterial map={concrete} color="#6a9aa8" roughness={0.82} />
      </mesh>
      <Stencil word="YESTERDAY" ink="#c45c2a" position={[0, 0.03, 3.35]} />
      <Stencil word="FIVE-DAY" ink="#a34a38" position={[0, 0.03, -3.35]} />
      <Stencil word="FIVE-MONTH" ink="#2a6a78" position={[-3.55, 0.03, 0]} rot={Math.PI / 2} />
      <WingSign word="YESTERDAY" paint="#c45c2a" position={[0, 0, 9.35]} />
      <WingSign word="FIVE-DAY" paint="#a34a38" position={[5.15, 0, -8.15]} />
      <WingSign word="FIVE-MONTH" paint="#2a6a78" position={[-9.2, 0, 4.85]} />
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
      <planeGeometry args={[5.4, 1.15]} />
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
        <mesh key={x} position={[x, 0.55, 0]} castShadow>
          <boxGeometry args={[0.12, 1.1, 0.12]} />
          <meshStandardMaterial color="#4a3020" />
        </mesh>
      ))}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[3.7, 0.72, 0.14]} />
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
    [-8.4, 0],
    [3.2, 8.2],
    [3.2, -8.2],
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
