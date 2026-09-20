import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useDirtTexture, useGrassTexture } from './textures'

/** Continuous Clash plateau: grass belt welded to the walls, cliff drop, no sky holes. */
export function ClashTerrain({
  wall,
  belt = 6.4,
  cliffH = 3.35,
}: {
  wall: number
  belt?: number
  cliffH?: number
}) {
  const grass = useGrassTexture()
  const dirt = useDirtTexture()
  const outer = wall + belt
  const top = outer * 2 + 0.4
  const ledge = top + 4.6
  const step = 1.55

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -cliffH - 0.45, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#1e3a1c" roughness={0.98} />
      </mesh>
      <mesh position={[0, -cliffH + step / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[ledge, step, ledge]} />
        <meshStandardMaterial map={dirt} color="#5a3e28" roughness={0.95} />
      </mesh>
      <mesh position={[0, -cliffH + step + (cliffH - step) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[top, cliffH - step, top]} />
        <meshStandardMaterial map={dirt} color="#6a4a30" roughness={0.94} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[outer * 2, outer * 2]} />
        <meshStandardMaterial map={grass} color="#3e9a32" roughness={0.9} />
      </mesh>
      <DirtLip wall={wall} />
      <DirtRoads wall={wall} belt={belt} dirt={dirt} />
      <RimRocks outer={outer} dirt={dirt} />
      <PineBelt wall={wall} outer={outer} />
    </group>
  )
}

function DirtLip({ wall }: { wall: number }) {
  const t = wall + 0.1
  const w = wall * 2 + 1.6
  return (
    <group>
      <mesh position={[0, 0.035, t]} receiveShadow>
        <boxGeometry args={[w, 0.08, 0.7]} />
        <meshStandardMaterial color="#7a5a38" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.035, -t]} receiveShadow>
        <boxGeometry args={[w, 0.08, 0.7]} />
        <meshStandardMaterial color="#7a5a38" roughness={0.92} />
      </mesh>
      <mesh position={[t, 0.035, 0]} receiveShadow>
        <boxGeometry args={[0.7, 0.08, w]} />
        <meshStandardMaterial color="#7a5a38" roughness={0.92} />
      </mesh>
      <mesh position={[-t, 0.035, 0]} receiveShadow>
        <boxGeometry args={[0.7, 0.08, w]} />
        <meshStandardMaterial color="#7a5a38" roughness={0.92} />
      </mesh>
    </group>
  )
}

function DirtRoads({ wall, belt, dirt }: { wall: number; belt: number; dirt: THREE.Texture }) {
  const len = belt - 0.4
  const mid = wall + belt * 0.52
  return (
    <group>
      <mesh position={[0, 0.03, mid]} receiveShadow>
        <boxGeometry args={[2.4, 0.05, len]} />
        <meshStandardMaterial map={dirt} color="#7a6240" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.03, -mid]} receiveShadow>
        <boxGeometry args={[2.4, 0.05, len]} />
        <meshStandardMaterial map={dirt} color="#7a6240" roughness={0.92} />
      </mesh>
      <mesh position={[mid, 0.03, 0]} receiveShadow>
        <boxGeometry args={[len, 0.05, 2.4]} />
        <meshStandardMaterial map={dirt} color="#7a6240" roughness={0.92} />
      </mesh>
      <mesh position={[-mid, 0.03, 0]} receiveShadow>
        <boxGeometry args={[len, 0.05, 2.4]} />
        <meshStandardMaterial map={dirt} color="#7a6240" roughness={0.92} />
      </mesh>
    </group>
  )
}

function RimRocks({ outer, dirt }: { outer: number; dirt: THREE.Texture }) {
  const r = outer + 0.15
  const spots: Array<[number, number, number, number, number]> = [
    [r - 0.8, -r + 2.4, 2.6, 1.1, 2.2],
    [-r + 0.8, r - 2.1, 2.4, 1.0, 2.0],
    [r - 2.2, r - 0.7, 2.2, 0.95, 1.8],
    [-r + 2.4, -r + 0.8, 2.5, 1.05, 2.1],
    [0.8, r - 0.4, 3.4, 0.85, 1.5],
    [-1.2, -r + 0.4, 3.2, 0.8, 1.4],
    [r - 0.35, 0.4, 1.6, 0.9, 3.0],
    [-r + 0.35, -0.6, 1.5, 0.88, 2.8],
  ]
  return (
    <group>
      {spots.map(([x, z, w, h, d], i) => (
        <mesh key={i} position={[x, h / 2 - 0.12, z]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial map={dirt} color="#5c4030" roughness={0.96} />
        </mesh>
      ))}
    </group>
  )
}

function PineBelt({ wall, outer }: { wall: number; outer: number }) {
  const mid = (wall + outer) * 0.5
  const spots: Array<[number, number, number]> = []
  for (let i = -5; i <= 5; i++) {
    if (Math.abs(i) <= 1) continue
    spots.push([i * 2.9, mid + (i % 2) * 0.45, 3.8 + (i % 3) * 0.42])
    spots.push([i * 2.9, -mid - (i % 2) * 0.4, 3.6 + ((i + 1) % 3) * 0.38])
    spots.push([mid + (i % 2) * 0.4, i * 2.9, 4.0 + ((i + 2) % 3) * 0.32])
    spots.push([-mid - (i % 2) * 0.35, i * 2.9, 3.7 + (i % 3) * 0.4])
  }
  spots.push(
    [-mid + 2.0, mid - 2.0, 3.5],
    [mid - 2.0, mid - 2.0, 3.7],
    [-mid + 2.0, -mid + 2.0, 3.4],
    [mid - 2.0, -mid + 2.0, 3.6],
    [0, mid + 1.1, 2.4],
    [0, -mid - 1.1, 2.2],
    [mid + 1.1, 0, 2.3],
    [-mid - 1.1, 0, 2.5],
  )
  return (
    <group>
      {spots.map(([x, z, h], i) => (
        <Pine key={i} x={x} z={z} h={h} />
      ))}
    </group>
  )
}

export function Pine({ x, z, h = 4 }: { x: number; z: number; h?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h * 0.16, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.17, h * 0.34, 6]} />
        <meshStandardMaterial color="#5a3218" roughness={0.92} />
      </mesh>
      <mesh position={[0, h * 0.42, 0]} castShadow>
        <coneGeometry args={[h * 0.28, h * 0.52, 7]} />
        <meshStandardMaterial color="#1a6e24" roughness={0.8} />
      </mesh>
      <mesh position={[0, h * 0.66, 0]} castShadow>
        <coneGeometry args={[h * 0.2, h * 0.4, 7]} />
        <meshStandardMaterial color="#228230" roughness={0.78} />
      </mesh>
      <mesh position={[0, h * 0.84, 0]} castShadow>
        <coneGeometry args={[h * 0.12, h * 0.26, 7]} />
        <meshStandardMaterial color="#2e9440" roughness={0.76} />
      </mesh>
    </group>
  )
}

/** One low morning sun. Long plaza shadows; almost no fill. */
export function MorningSun({ warm }: { warm: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const sunPos: [number, number, number] = warm ? [15.5, 5.6, 13.5] : [13.5, 7.6, 16.2]
  const sun = warm ? '#ffb070' : '#fff1c0'

  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    l.target.position.set(0, 0, 0)
    l.target.updateMatrixWorld()
    if (!l.target.parent && l.parent) l.parent.add(l.target)
  }, [warm])

  return (
    <>
      <hemisphereLight args={[warm ? '#f0d0b0' : '#d8ecff', warm ? '#6a5a38' : '#3a6a34', warm ? 0.34 : 0.3]} />
      <ambientLight intensity={warm ? 0.18 : 0.16} />
      <directionalLight
        ref={light}
        position={sunPos}
        intensity={warm ? 1.95 : 2.85}
        color={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.045}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
      />
      <directionalLight position={[-10, 9, -12]} intensity={warm ? 0.08 : 0.1} color="#8eb8d8" />
    </>
  )
}
