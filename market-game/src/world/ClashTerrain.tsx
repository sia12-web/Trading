import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useDirtTexture, useGrassTexture } from './textures'

/** Clash plateau: mixed forest, continuing cliffs, grass that does not die at a cone ring. */
export function ClashTerrain({
  wall,
  belt = 9.2,
  cliffH = 4.15,
}: {
  wall: number
  belt?: number
  cliffH?: number
}) {
  const grass = useGrassTexture()
  const dirt = useDirtTexture()
  const outer = wall + belt

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -cliffH - 1.15, 0]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial color="#348c34" roughness={0.96} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -cliffH + 0.02, 0]} receiveShadow>
        <planeGeometry args={[outer * 2 + 52, outer * 2 + 52]} />
        <meshStandardMaterial map={grass} color="#3eb836" roughness={0.9} />
      </mesh>
      <LowerTerrace grass={grass} outer={outer} y={-cliffH * 0.42} />
      <IrregularCliff wall={wall} outer={outer} cliffH={cliffH} dirt={dirt} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
        <planeGeometry args={[outer * 2 + 1.6, outer * 2 + 1.6]} />
        <meshStandardMaterial map={grass} color="#4cd440" roughness={0.86} />
      </mesh>
      <GrassFingers wall={wall} grass={grass} />
      <DirtLip wall={wall} />
      <DirtRoads wall={wall} belt={belt} dirt={dirt} />
      <RimRocks outer={outer} dirt={dirt} />
      <MixedForest wall={wall} outer={outer} cliffH={cliffH} />
    </group>
  )
}

function LowerTerrace({ grass, outer, y }: { grass: THREE.Texture; outer: number; y: number }) {
  const pads: Array<[number, number, number, number]> = [
    [0, outer + 7.2, 22, 9],
    [outer + 6.8, 1.2, 10, 24],
    [-(outer + 6.4), -0.8, 9.5, 22],
    [2.4, -(outer + 6.6), 20, 9],
    [outer + 4.2, outer + 4.8, 11, 10],
    [-(outer + 3.8), outer + 5.1, 10, 11],
    [outer + 4.6, -(outer + 4.4), 12, 10],
    [-(outer + 4.2), -(outer + 4.8), 11, 10],
  ]
  return (
    <group>
      {pads.map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, y, z]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial map={grass} color="#3eb836" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function GrassFingers({ wall, grass }: { wall: number; grass: THREE.Texture }) {
  const t = wall + 1.8
  const pads: Array<[number, number, number, number]> = [
    [t + 2.4, 4.2, 5.2, 7.4],
    [-(t + 2.1), -3.6, 4.8, 6.8],
    [5.1, t + 2.6, 8.2, 4.6],
    [-4.4, -(t + 2.2), 7.6, 4.4],
    [t + 1.6, -(t + 1.4), 5.5, 5.2],
    [-(t + 1.8), t + 1.5, 5.8, 5.4],
  ]
  return (
    <group>
      {pads.map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.006, z]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial map={grass} color="#48c43c" roughness={0.88} />
        </mesh>
      ))}
    </group>
  )
}

function IrregularCliff({
  wall,
  outer,
  cliffH,
  dirt,
}: {
  wall: number
  outer: number
  cliffH: number
  dirt: THREE.Texture
}) {
  const r = outer + 0.8
  const blocks: Array<[number, number, number, number, number]> = [
    [0, r, r * 2.15, cliffH, 3.4],
    [0, -r, r * 2.05, cliffH * 0.92, 3.1],
    [r, 0.6, 3.2, cliffH * 1.05, r * 2.1],
    [-r, -0.4, 3.0, cliffH * 0.96, r * 2.05],
    [r - 1.2, r - 1.4, 6.4, cliffH * 0.78, 5.8],
    [-(r - 1.4), r - 0.9, 5.8, cliffH * 0.88, 6.2],
    [r - 0.8, -(r - 1.6), 6.8, cliffH * 0.7, 5.4],
    [-(r - 1.1), -(r - 1.2), 6.2, cliffH * 0.82, 5.9],
    [r + 1.8, 6.4, 4.2, cliffH * 0.55, 7.2],
    [-(r + 1.6), -5.2, 3.8, cliffH * 0.5, 6.6],
    [7.2, r + 1.7, 8.4, cliffH * 0.48, 3.6],
    [-6.4, -(r + 1.5), 7.8, cliffH * 0.52, 3.4],
    [r + 5.4, 2.8, 5.6, cliffH * 0.62, 9.4],
    [-(r + 5.0), -1.6, 5.2, cliffH * 0.58, 8.8],
    [3.4, r + 5.2, 10.2, cliffH * 0.5, 5.0],
    [-2.8, -(r + 4.8), 9.6, cliffH * 0.54, 4.8],
    [r + 8.2, r + 3.6, 6.4, cliffH * 0.38, 6.8],
    [-(r + 7.6), -(r + 3.2), 6.0, cliffH * 0.4, 6.4],
  ]
  void wall
  return (
    <group>
      {blocks.map(([x, z, w, h, d], i) => (
        <mesh key={i} position={[x, -h / 2 + 0.04, z]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial map={dirt} color={i % 2 ? '#6e4a30' : '#5a3c26'} roughness={0.95} />
        </mesh>
      ))}
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
        <meshStandardMaterial color="#8a6a42" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.035, -t]} receiveShadow>
        <boxGeometry args={[w, 0.08, 0.7]} />
        <meshStandardMaterial color="#8a6a42" roughness={0.92} />
      </mesh>
      <mesh position={[t, 0.035, 0]} receiveShadow>
        <boxGeometry args={[0.7, 0.08, w]} />
        <meshStandardMaterial color="#8a6a42" roughness={0.92} />
      </mesh>
      <mesh position={[-t, 0.035, 0]} receiveShadow>
        <boxGeometry args={[0.7, 0.08, w]} />
        <meshStandardMaterial color="#8a6a42" roughness={0.92} />
      </mesh>
    </group>
  )
}

function DirtRoads({ wall, belt, dirt }: { wall: number; belt: number; dirt: THREE.Texture }) {
  const len = belt - 0.2
  const mid = wall + belt * 0.52
  return (
    <group>
      <mesh position={[0, 0.03, mid]} receiveShadow>
        <boxGeometry args={[2.6, 0.05, len]} />
        <meshStandardMaterial map={dirt} color="#8a6e48" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.03, -mid]} receiveShadow>
        <boxGeometry args={[2.4, 0.05, len]} />
        <meshStandardMaterial map={dirt} color="#8a6e48" roughness={0.92} />
      </mesh>
      <mesh position={[mid, 0.03, 0]} receiveShadow>
        <boxGeometry args={[len, 0.05, 2.4]} />
        <meshStandardMaterial map={dirt} color="#8a6e48" roughness={0.92} />
      </mesh>
      <mesh position={[-mid, 0.03, 0]} receiveShadow>
        <boxGeometry args={[len, 0.05, 2.5]} />
        <meshStandardMaterial map={dirt} color="#8a6e48" roughness={0.92} />
      </mesh>
    </group>
  )
}

function RimRocks({ outer, dirt }: { outer: number; dirt: THREE.Texture }) {
  const r = outer + 0.2
  const spots: Array<[number, number, number, number, number]> = [
    [r - 0.6, -r + 3.1, 2.9, 1.35, 2.4],
    [-r + 0.7, r - 2.6, 2.6, 1.2, 2.2],
    [r - 2.8, r - 0.5, 2.4, 1.1, 2.0],
    [-r + 3.1, -r + 0.6, 2.7, 1.25, 2.3],
    [2.4, r - 0.25, 3.8, 1.05, 1.7],
    [-3.1, -r + 0.3, 3.4, 0.95, 1.6],
    [r - 0.2, 2.8, 1.7, 1.15, 3.4],
    [-r + 0.25, -3.2, 1.6, 1.08, 3.1],
    [r + 2.4, -6.2, 2.2, 1.4, 2.8],
    [-(r + 2.1), 5.4, 2.0, 1.25, 2.6],
    [8.4, r + 2.2, 2.6, 1.15, 1.8],
    [-7.2, -(r + 2.0), 2.4, 1.1, 1.7],
    [r + 1.1, r + 1.6, 3.2, 1.5, 2.4],
    [-(r + 0.9), -(r + 1.4), 2.8, 1.35, 2.2],
    [r + 5.6, 3.2, 3.4, 1.7, 4.2],
    [-(r + 5.2), -2.4, 3.1, 1.55, 3.8],
    [4.8, r + 5.4, 4.6, 1.6, 2.8],
    [-3.6, -(r + 5.0), 4.2, 1.45, 2.6],
    [r + 6.8, r + 5.2, 3.8, 1.85, 3.4],
    [-(r + 6.2), -(r + 4.8), 3.6, 1.7, 3.2],
  ]
  return (
    <group>
      {spots.map(([x, z, w, h, d], i) =>
        i % 3 === 1 ? (
          <mesh key={i} position={[x, h * 0.42, z]} rotation={[0.15, i * 0.7, 0.08]} castShadow receiveShadow>
            <dodecahedronGeometry args={[Math.max(w, d) * 0.42, 0]} />
            <meshStandardMaterial map={dirt} color="#5a3c26" roughness={0.96} />
          </mesh>
        ) : (
          <mesh key={i} position={[x, h / 2 - 0.08, z]} rotation={[0, i * 0.2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial map={dirt} color={i % 3 === 0 ? '#6a4830' : '#584028'} roughness={0.96} />
          </mesh>
        ),
      )}
    </group>
  )
}

type TreeKind = 'pine' | 'oak' | 'cypress' | 'willow' | 'bush'

function MixedForest({ wall, outer, cliffH }: { wall: number; outer: number; cliffH: number }) {
  const mid = (wall + outer) * 0.52
  const far = outer + 6.4
  const valley = outer + 14
  const terraceY = -cliffH * 0.42
  const valleyY = -cliffH + 0.04
  const trees: Array<[number, number, number, TreeKind, number]> = [
    [-mid - 0.8, mid + 1.6, 4.4, 'pine', 0],
    [-mid + 2.4, mid + 0.6, 3.2, 'oak', 0],
    [-mid + 5.8, mid + 1.9, 4.8, 'cypress', 0],
    [mid - 6.2, mid + 0.4, 2.9, 'willow', 0],
    [mid - 2.8, mid + 1.5, 4.1, 'pine', 0],
    [mid + 0.9, mid - 0.2, 3.6, 'oak', 0],
    [mid + 1.4, 4.8, 5.1, 'pine', 0],
    [mid + 0.5, 1.2, 3.3, 'willow', 0],
    [mid + 1.8, -3.6, 4.6, 'cypress', 0],
    [mid + 0.2, -7.4, 2.8, 'oak', 0],
    [mid - 0.6, -mid - 1.2, 4.0, 'pine', 0],
    [4.2, -mid - 1.8, 3.4, 'oak', 0],
    [0.6, -mid - 0.4, 4.7, 'cypress', 0],
    [-3.8, -mid - 1.5, 3.1, 'willow', 0],
    [-7.2, -mid - 0.7, 4.3, 'pine', 0],
    [-mid - 1.2, -mid + 2.2, 3.7, 'oak', 0],
    [-mid - 0.4, -4.8, 4.9, 'pine', 0],
    [-mid - 1.6, -1.1, 3.2, 'willow', 0],
    [-mid + 0.3, 3.4, 4.2, 'cypress', 0],
    [-mid - 0.8, 7.6, 2.7, 'oak', 0],
    [-8.4, mid + 0.8, 3.8, 'oak', 0],
    [8.8, -mid - 0.6, 3.5, 'pine', 0],
    [3.1, mid + 2.4, 2.6, 'willow', 0],
    [-2.2, mid + 1.1, 4.5, 'pine', 0],
    [mid + 3.6, mid + 2.8, 3.8, 'pine', 0],
    [-mid - 2.4, mid + 3.2, 4.2, 'oak', 0],
    [mid + 2.2, -mid - 3.0, 3.5, 'cypress', 0],
    [-mid - 3.1, -mid - 2.2, 4.0, 'pine', 0],
    [6.8, mid + 3.6, 2.4, 'willow', 0],
    [-7.4, -mid - 3.4, 3.1, 'oak', 0],
    [mid - 4.4, -2.2, 1.4, 'bush', 0],
    [-mid + 3.1, 5.2, 1.2, 'bush', 0],
    [2.8, mid - 1.6, 1.1, 'bush', 0],
    [-5.6, -mid + 2.4, 1.3, 'bush', 0],
    [mid - 1.2, 6.4, 1.05, 'bush', 0],
    [-4.8, mid + 2.2, 1.25, 'bush', 0],
    [far - 1.2, 8.4, 4.8, 'pine', terraceY],
    [far - 0.4, 2.2, 3.4, 'oak', terraceY],
    [far - 1.6, -4.6, 5.2, 'cypress', terraceY],
    [9.4, far - 0.8, 3.9, 'willow', terraceY],
    [2.6, far - 1.4, 4.4, 'pine', terraceY],
    [-5.2, far - 0.6, 3.1, 'oak', terraceY],
    [-(far - 1.0), 6.8, 4.6, 'pine', terraceY],
    [-(far - 0.5), 0.4, 3.3, 'willow', terraceY],
    [-(far - 1.4), -7.2, 4.9, 'cypress', terraceY],
    [-8.8, -(far - 0.9), 3.6, 'oak', terraceY],
    [1.4, -(far - 1.2), 4.2, 'pine', terraceY],
    [7.6, -(far - 0.5), 2.9, 'oak', terraceY],
    [far + 0.8, 5.6, 3.7, 'willow', terraceY],
    [-(far + 1.2), -3.8, 4.1, 'pine', terraceY],
    [4.4, far + 1.6, 3.3, 'cypress', terraceY],
    [-6.2, -(far + 1.4), 3.8, 'oak', terraceY],
    [far + 2.2, 11.8, 1.3, 'bush', terraceY],
    [-(far + 1.6), -9.4, 1.15, 'bush', terraceY],
    [far + 3.2, far - 2.4, 5.4, 'pine', valleyY],
    [-(far + 2.8), far - 1.8, 4.1, 'oak', valleyY],
    [far + 2.6, -(far - 2.2), 4.7, 'cypress', valleyY],
    [-(far + 3.0), -(far - 1.6), 3.8, 'willow', valleyY],
    [far + 4.4, 11.2, 3.2, 'oak', valleyY],
    [-(far + 4.1), -10.4, 3.6, 'pine', valleyY],
    [12.4, far + 3.6, 4.0, 'willow', valleyY],
    [-11.6, -(far + 3.2), 3.4, 'oak', valleyY],
    [valley - 1.4, 8.2, 5.6, 'pine', valleyY],
    [valley - 0.6, -3.4, 3.8, 'oak', valleyY],
    [-(valley - 1.2), 4.6, 4.9, 'cypress', valleyY],
    [-(valley - 0.4), -8.8, 3.3, 'willow', valleyY],
    [6.2, valley - 1.8, 4.4, 'oak', valleyY],
    [-7.4, -(valley - 1.2), 5.1, 'pine', valleyY],
    [valley + 2.8, valley - 4.2, 4.2, 'pine', valleyY],
    [-(valley + 2.4), -(valley - 3.6), 3.6, 'oak', valleyY],
    [14.8, valley + 1.2, 2.8, 'willow', valleyY],
    [-13.2, -(valley + 0.8), 3.1, 'cypress', valleyY],
    [valley + 5.2, 4.6, 4.0, 'pine', valleyY],
    [-(valley + 4.8), -5.2, 3.5, 'oak', valleyY],
    [valley + 1.6, 16.4, 1.4, 'bush', valleyY],
    [-(valley + 0.8), -15.2, 1.2, 'bush', valleyY],
  ]
  return (
    <group>
      {trees.map(([x, z, h, kind, y], i) =>
        kind === 'bush' ? (
          <Bush key={i} x={x} z={z} h={h} y={y} seed={i + 3} />
        ) : kind === 'pine' ? (
          <Pine key={i} x={x} z={z} h={h} y={y} seed={i + 1} />
        ) : kind === 'cypress' ? (
          <Cypress key={i} x={x} z={z} h={h} y={y} seed={i + 5} />
        ) : kind === 'willow' ? (
          <Willow key={i} x={x} z={z} h={h} y={y} seed={i + 7} />
        ) : (
          <Broadleaf key={i} x={x} z={z} h={h} y={y} seed={i + 2} />
        ),
      )}
    </group>
  )
}

function jitter(seed: number, k: number) {
  return Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5
}

export function Pine({
  x,
  z,
  h = 4,
  y = 0,
  seed = 1,
}: {
  x: number
  z: number
  h?: number
  y?: number
  seed?: number
}) {
  const yaw = jitter(seed, 1) * Math.PI
  const lean = (jitter(seed, 2) - 0.5) * 0.12
  const g1 = h > 4.2 ? '#145a1e' : '#166422'
  const g2 = h > 4.2 ? '#1c7a28' : '#1a7024'
  const g3 = '#247a32'
  const ox = (jitter(seed, 3) - 0.5) * h * 0.06
  const oz = (jitter(seed, 4) - 0.5) * h * 0.06
  return (
    <group position={[x, y, z]} rotation={[lean, yaw, 0]}>
      <mesh position={[0, h * 0.18, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.2, h * 0.38, 7]} />
        <meshStandardMaterial color="#4a2c16" roughness={0.94} />
      </mesh>
      <mesh position={[h * 0.08, h * 0.28, 0]} rotation={[0, 0, 0.7]} castShadow>
        <cylinderGeometry args={[0.04, 0.07, h * 0.18, 5]} />
        <meshStandardMaterial color="#3a2414" roughness={0.94} />
      </mesh>
      <mesh position={[ox, h * 0.4, oz]} castShadow>
        <coneGeometry args={[h * 0.3, h * 0.48, 8]} />
        <meshStandardMaterial color={g1} roughness={0.8} />
      </mesh>
      <mesh position={[-ox * 0.6, h * 0.58, oz * 0.4]} rotation={[0.04, 0.3, 0]} castShadow>
        <coneGeometry args={[h * 0.22, h * 0.4, 8]} />
        <meshStandardMaterial color={g2} roughness={0.78} />
      </mesh>
      <mesh position={[ox * 0.5, h * 0.74, -oz * 0.5]} rotation={[-0.05, 0.8, 0]} castShadow>
        <coneGeometry args={[h * 0.15, h * 0.3, 7]} />
        <meshStandardMaterial color={g3} roughness={0.76} />
      </mesh>
      <mesh position={[0, h * 0.9, 0]} castShadow>
        <coneGeometry args={[h * 0.09, h * 0.2, 6]} />
        <meshStandardMaterial color="#2e8a38" roughness={0.74} />
      </mesh>
    </group>
  )
}

export function Broadleaf({
  x,
  z,
  h = 3.4,
  y = 0,
  seed = 1,
}: {
  x: number
  z: number
  h?: number
  y?: number
  seed?: number
}) {
  const yaw = jitter(seed, 5) * Math.PI * 2
  const leaf = seed % 3 === 0 ? '#2e8c30' : seed % 3 === 1 ? '#3a9a36' : '#247828'
  const leaf2 = seed % 2 === 0 ? '#1e6a24' : '#348a32'
  const leaf3 = '#4aa040'
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, h * 0.24, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.2, h * 0.48, 7]} />
        <meshStandardMaterial color="#5a3218" roughness={0.92} />
      </mesh>
      <mesh position={[h * 0.08, h * 0.42, h * 0.04]} rotation={[0.35, 0.4, 0.2]} castShadow>
        <cylinderGeometry args={[0.05, 0.09, h * 0.28, 5]} />
        <meshStandardMaterial color="#4a2814" roughness={0.92} />
      </mesh>
      <mesh position={[-h * 0.1, h * 0.4, -h * 0.06]} rotation={[-0.3, -0.5, -0.15]} castShadow>
        <cylinderGeometry args={[0.045, 0.08, h * 0.24, 5]} />
        <meshStandardMaterial color="#4a2814" roughness={0.92} />
      </mesh>
      <mesh position={[0, h * 0.64, 0]} castShadow>
        <dodecahedronGeometry args={[h * 0.3, 0]} />
        <meshStandardMaterial color={leaf} roughness={0.76} />
      </mesh>
      <mesh position={[h * 0.2, h * 0.7, h * 0.1]} castShadow>
        <icosahedronGeometry args={[h * 0.2, 0]} />
        <meshStandardMaterial color={leaf2} roughness={0.78} />
      </mesh>
      <mesh position={[-h * 0.18, h * 0.78, -h * 0.08]} castShadow>
        <dodecahedronGeometry args={[h * 0.18, 0]} />
        <meshStandardMaterial color={leaf3} roughness={0.77} />
      </mesh>
      <mesh position={[h * 0.06, h * 0.86, -h * 0.16]} castShadow>
        <icosahedronGeometry args={[h * 0.14, 0]} />
        <meshStandardMaterial color={leaf} roughness={0.75} />
      </mesh>
      <mesh position={[-h * 0.08, h * 0.58, h * 0.18]} castShadow>
        <dodecahedronGeometry args={[h * 0.15, 0]} />
        <meshStandardMaterial color={leaf2} roughness={0.78} />
      </mesh>
    </group>
  )
}

export function Cypress({
  x,
  z,
  h = 4.2,
  y = 0,
  seed = 1,
}: {
  x: number
  z: number
  h?: number
  y?: number
  seed?: number
}) {
  const yaw = jitter(seed, 8) * Math.PI
  return (
    <group position={[x, y, z]} rotation={[0, yaw, (jitter(seed, 9) - 0.5) * 0.08]}>
      <mesh position={[0, h * 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.12, h * 0.28, 6]} />
        <meshStandardMaterial color="#3a2414" roughness={0.94} />
      </mesh>
      <mesh position={[0, h * 0.38, 0]} castShadow>
        <coneGeometry args={[h * 0.16, h * 0.42, 8]} />
        <meshStandardMaterial color="#145a22" roughness={0.8} />
      </mesh>
      <mesh position={[0, h * 0.62, 0]} castShadow>
        <coneGeometry args={[h * 0.12, h * 0.36, 8]} />
        <meshStandardMaterial color="#1a6a28" roughness={0.78} />
      </mesh>
      <mesh position={[0, h * 0.82, 0]} castShadow>
        <coneGeometry args={[h * 0.07, h * 0.28, 7]} />
        <meshStandardMaterial color="#227430" roughness={0.76} />
      </mesh>
    </group>
  )
}

export function Willow({
  x,
  z,
  h = 3.2,
  y = 0,
  seed = 1,
}: {
  x: number
  z: number
  h?: number
  y?: number
  seed?: number
}) {
  const yaw = jitter(seed, 11) * Math.PI * 2
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, h * 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.16, h * 0.44, 7]} />
        <meshStandardMaterial color="#4a3018" roughness={0.92} />
      </mesh>
      <mesh position={[0, h * 0.58, 0]} castShadow>
        <dodecahedronGeometry args={[h * 0.34, 0]} />
        <meshStandardMaterial color="#3a8c38" roughness={0.74} />
      </mesh>
      <mesh position={[h * 0.22, h * 0.48, h * 0.08]} castShadow>
        <icosahedronGeometry args={[h * 0.18, 0]} />
        <meshStandardMaterial color="#2e7a30" roughness={0.78} />
      </mesh>
      <mesh position={[-h * 0.2, h * 0.46, -h * 0.1]} castShadow>
        <icosahedronGeometry args={[h * 0.16, 0]} />
        <meshStandardMaterial color="#4a9a40" roughness={0.76} />
      </mesh>
      <mesh position={[h * 0.04, h * 0.36, h * 0.22]} castShadow>
        <dodecahedronGeometry args={[h * 0.14, 0]} />
        <meshStandardMaterial color="#2a6a28" roughness={0.8} />
      </mesh>
      <mesh position={[-h * 0.12, h * 0.34, h * 0.16]} castShadow>
        <dodecahedronGeometry args={[h * 0.12, 0]} />
        <meshStandardMaterial color="#348034" roughness={0.79} />
      </mesh>
    </group>
  )
}

export function Bush({
  x,
  z,
  h = 1.2,
  y = 0,
  seed = 1,
}: {
  x: number
  z: number
  h?: number
  y?: number
  seed?: number
}) {
  const yaw = jitter(seed, 13) * Math.PI
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, h * 0.36, 0]} castShadow>
        <dodecahedronGeometry args={[h * 0.4, 0]} />
        <meshStandardMaterial color="#246c28" roughness={0.8} />
      </mesh>
      <mesh position={[h * 0.24, h * 0.3, h * 0.1]} castShadow>
        <icosahedronGeometry args={[h * 0.26, 0]} />
        <meshStandardMaterial color="#3a8c34" roughness={0.78} />
      </mesh>
      <mesh position={[-h * 0.18, h * 0.28, -h * 0.12]} castShadow>
        <dodecahedronGeometry args={[h * 0.22, 0]} />
        <meshStandardMaterial color="#1e5c22" roughness={0.82} />
      </mesh>
    </group>
  )
}

/** Offset brick ring so the wall is not a perfect square fence. */
export function ClashWalls({ wall, brick }: { wall: number; brick: THREE.Texture }) {
  const t = wall
  const h = 1.35
  const segs: Array<[number, number, number, number]> = [
    [0, -t, t * 2 + 1.2, 0.72],
    [0, t, t * 2 + 1.2, 0.72],
    [-t, 0, 0.72, t * 2],
    [t, 0, 0.72, t * 2],
    [0, t - 0.72, 7.4, 0.95],
    [5.1, -t + 0.68, 6.6, 0.95],
    [-t + 0.7, 3.4, 0.95, 7.0],
    [t - 0.7, -2.6, 0.95, 5.8],
  ]
  return (
    <group>
      {segs.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, h / 2, z]} rotation={[0, i === 4 ? 0.04 : i === 5 ? -0.05 : 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial map={brick} color={i % 2 ? '#b84a30' : '#c45a38'} roughness={0.86} />
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

/** One low morning sun. Long plaza shadows with lifted shade fill so stalls stay readable. */
export function MorningSun({ warm }: { warm: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const sunPos: [number, number, number] = warm ? [15.5, 6.2, 13.5] : [14.2, 8.4, 16.4]
  const sun = warm ? '#ffc080' : '#fff4cc'

  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    l.target.position.set(0, 0, 0)
    l.target.updateMatrixWorld()
    if (!l.target.parent && l.parent) l.parent.add(l.target)
  }, [warm])

  return (
    <>
      <hemisphereLight args={[warm ? '#f8e0c4' : '#d8f0ff', warm ? '#8a7a52' : '#52a048', warm ? 0.58 : 0.7]} />
      <ambientLight intensity={warm ? 0.4 : 0.54} />
      <directionalLight
        ref={light}
        position={sunPos}
        intensity={warm ? 1.55 : 2.05}
        color={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00035}
        shadow-normalBias={0.05}
        shadow-camera-near={1}
        shadow-camera-far={110}
        shadow-camera-left={-38}
        shadow-camera-right={38}
        shadow-camera-top={38}
        shadow-camera-bottom={-38}
      />
      <directionalLight position={[-12, 11, -14]} intensity={warm ? 0.42 : 0.62} color="#c4e4f8" />
      <directionalLight position={[4, 14, -8]} intensity={warm ? 0.18 : 0.28} color="#fff6e0" />
      <directionalLight position={[16, 7, 4]} intensity={warm ? 0.16 : 0.22} color="#ffe8c4" />
    </>
  )
}
