import type { RangeKind, StoreDef } from './types'

/**
 * Three Clash-readable courts around the bell: Yesterday south (camera-near),
 * Five-Day east (camera-right, not behind the hall), Five-Month west.
 */
export const STORES: StoreDef[] = [
  {
    id: 'y-hvn',
    range: 'yesterday',
    kind: 'hvn',
    name: 'FOUNDRY',
    subtitle: 'Yesterday NYC · High Volume Node',
    theory:
      'Acceptance. Trade clustered here yesterday. Size should show up if Price is advertising a real offer — empty furnaces mean divergence.',
    position: [-4.15, 0, 7.65],
    accent: '#c45c2a',
    building: 'foundry',
  },
  {
    id: 'y-poc',
    range: 'yesterday',
    kind: 'poc',
    name: 'AUCTION HALL',
    subtitle: 'Yesterday NYC · Point of Control / Fair Value',
    theory:
      'The fairest price of yesterday’s cash session — highest traded volume. Value is made with time; lingering here balances the day.',
    position: [0, 0, 8.05],
    accent: '#b45309',
    building: 'hall',
  },
  {
    id: 'y-lvn',
    range: 'yesterday',
    kind: 'lvn',
    name: 'LOADING DOCK',
    subtitle: 'Yesterday NYC · Low Volume Node',
    theory:
      'A vacuum. Price traveled fast and left little trade. If volume floods while you stand here, the single print is filling — window closing.',
    position: [6.9, 0, 7.55],
    accent: '#3d6a8a',
    building: 'dock',
  },
  {
    id: '5d-hvn',
    range: 'fiveDay',
    kind: 'hvn',
    name: 'BEAM YARD',
    subtitle: 'Five-day FRVP · High Volume Node',
    theory:
      'Short-term money’s other home. A second distribution across five NYC sessions. Slow, heavy steel — fills, not spikes.',
    position: [9.2, 0, -7.45],
    accent: '#a34a38',
    building: 'yard',
  },
  {
    id: '5d-poc',
    range: 'fiveDay',
    kind: 'poc',
    name: 'SAWTOOTH MILL',
    subtitle: 'Five-day FRVP · Point of Control',
    theory:
      'Composite fair value for the last five cash sessions. Wholesale vs retail is judged from here. Time spent = value accepted.',
    position: [9.4, 0, -1.85],
    accent: '#c47a28',
    building: 'mill',
  },
  {
    id: '5d-lvn',
    range: 'fiveDay',
    kind: 'lvn',
    name: 'THE ALLEY',
    subtitle: 'Five-day FRVP · Low Volume Node',
    theory:
      'The air pocket between five-day distributions. Fast rejection if you belong elsewhere; a trap if you advertise without time.',
    position: [9.2, 0, 3.35],
    accent: '#4a6578',
    building: 'alley',
  },
  {
    id: 'avwap',
    range: 'fiveMonth',
    kind: 'avwap',
    name: 'ANCHOR SPIRE',
    subtitle: 'Five-month Anchored VWAP · live',
    theory:
      'Long-term money. Anchored at cash open five months back, Σ(P·V)/ΣV, updating on every print. Price is advertising; this tower is the institutional benchmark.',
    position: [-11.25, 0, -1.4],
    accent: '#2a6a78',
    building: 'spire',
  },
  {
    id: 'avwap-upper',
    range: 'fiveMonth',
    kind: 'avwap',
    name: 'PREMIUM LOFT',
    subtitle: 'Five-month AVWAP · upper 1σ',
    theory:
      'Premium to long-term value. The band breathes with incoming volume. Time still regulates whether this stretch is an opportunity or already spent.',
    position: [-11.15, 0, -6.9],
    accent: '#3a5a88',
    building: 'loft',
  },
  {
    id: 'avwap-lower',
    range: 'fiveMonth',
    kind: 'avwap',
    name: 'DISCOUNT PIT',
    subtitle: 'Five-month AVWAP · lower 1σ',
    theory:
      'Discount to long-term value. Gold-teal money from the desk’s 5-month bands, made physical as a loading annex that rises and falls with σ.',
    position: [-11.15, 0, 4.2],
    accent: '#8a7040',
    building: 'pit',
  },
]

export const LOCKED_MARKETS = [
  { id: 'nasdaq' as const, name: 'NASDAQ', world: 'Technology campuses', position: [8.6, 0, 1.4] as [number, number, number] },
  { id: 'gold' as const, name: 'GOLD', world: 'Mines', position: [0, 0, -8.6] as [number, number, number] },
  { id: 'oil' as const, name: 'OIL', world: 'Fields & refineries', position: [-8.6, 0, 1.6] as [number, number, number] },
]

export const DOW_GATE: [number, number, number] = [0, 0, 8.4]
export const HUB_WALK = 14.2

/**
 * Court names live on the south / east outer wall cap inside the Clash crop.
 * Store names live on small fascias — not plaza plaques.
 */
export const COURT_SIGNS = [
  { word: 'YESTERDAY', ink: '#e07040', x: 0.08, z: 15.82, wide: 5.05 },
  { word: 'FIVE-DAY', ink: '#d48848', x: 7.85, z: 15.82, wide: 3.85 },
  { word: 'FIVE-MONTH', ink: '#6ab0c4', x: -7.25, z: 15.82, wide: 4.45 },
  { word: 'YARD', ink: '#d48848', x: 15.82, z: 3.15, wide: 2.95 },
] as const

export const FASCIA_NAMES = ['FOUNDRY', 'HALL', 'DOCK', 'YARD', 'MILL', 'ALLEY', 'SPIRE', 'LOFT', 'PIT'] as const

const SHORT: Record<StoreDef['building'], string> = {
  foundry: 'FOUNDRY',
  hall: 'HALL',
  dock: 'DOCK',
  yard: 'YARD',
  mill: 'MILL',
  alley: 'ALLEY',
  spire: 'SPIRE',
  loft: 'LOFT',
  pit: 'PIT',
}

/** Tape / fascia name — never "AUCTION" from AUCTION HALL. */
export function storeShortName(id: StoreDef['id']): string {
  const s = STORES.find((x) => x.id === id)
  return s ? SHORT[s.building] : id
}

/** Fascia sits on local +Z. Yaw matches Three.js so that face is the courtyard. */
export function storeYaw(range: RangeKind): number {
  if (range === 'fiveMonth') return Math.PI / 2
  if (range === 'fiveDay') return -Math.PI / 2
  return 0
}

/**
 * Thermometer locals whose labels face the Clash camera (+X,+Z).
 * Yesterday: south + east. Five-day: east + south. Five-month: courtyard-east + south.
 * Never the north/back wall — those read as gold lintels from this camera.
 */
export function cameraLadderLocals(
  range: RangeKind,
  width: number,
  depth: number,
): Array<{ p: [number, number, number]; r: [number, number, number]; w: number; face: 'south' | 'east' }> {
  if (range === 'fiveDay') {
    return [
      { p: [0, 0, -depth * 0.52 - 0.16], r: [0, Math.PI, 0], w: width, face: 'east' },
      { p: [width * 0.52 + 0.16, 0, 0], r: [0, Math.PI / 2, 0], w: depth, face: 'south' },
    ]
  }
  if (range === 'fiveMonth') {
    return [
      { p: [0, 0, depth * 0.52 + 0.16], r: [0, 0, 0], w: width, face: 'east' },
      { p: [-width * 0.52 - 0.16, 0, 0], r: [0, -Math.PI / 2, 0], w: depth, face: 'south' },
    ]
  }
  return [
    { p: [0, 0, depth * 0.52 + 0.16], r: [0, 0, 0], w: width, face: 'south' },
    { p: [width * 0.52 + 0.16, 0, 0], r: [0, Math.PI / 2, 0], w: depth, face: 'east' },
  ]
}

/** Free-standing apron gauge on the camera-near (+X,+Z) corner. */
export function apronGaugeLocal(range: RangeKind, width: number, depth: number): [number, number, number] {
  if (range === 'fiveDay') return [width * 0.58, 0, -depth * 0.88]
  if (range === 'fiveMonth') return [-width * 0.58, 0, depth * 0.88]
  return [width * 0.58, 0, depth * 0.88]
}

export function porchOf(s: StoreDef): { x: number; z: number } {
  const yaw = storeYaw(s.range)
  const lz = 2.2
  const c = Math.cos(yaw)
  const n = Math.sin(yaw)
  return { x: s.position[0] + lz * n, z: s.position[2] + lz * c }
}

export function nearestStore(x: number, z: number, maxDist = 3.4): StoreDef | null {
  let best: StoreDef | null = null
  let bestD = maxDist
  for (const s of STORES) {
    const dx = x - s.position[0]
    const dz = z - s.position[2]
    const d = Math.hypot(dx, dz)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

export function storeAtPoint(x: number, z: number, maxDist = 3.5): StoreDef | null {
  return nearestStore(x, z, maxDist)
}

/** Tight cores so Price can walk the porch into each stall. Five-Day yaw swaps footprint. */
export const COLLISIONS: Array<{ x: number; z: number; w: number; d: number }> = [
  { x: 0, z: 0, w: 1.35, d: 1.35 },
  { x: -4.15, z: 7.45, w: 3.6, d: 2.05 },
  { x: 0, z: 7.85, w: 4.2, d: 2.15 },
  { x: 6.9, z: 7.4, w: 3.2, d: 1.7 },
  { x: 9.4, z: -7.45, w: 2.05, d: 4.4 },
  { x: 9.6, z: -1.85, w: 2.25, d: 5.2 },
  { x: 9.4, z: 3.35, w: 1.7, d: 3.2 },
  { x: -11.25, z: -1.4, w: 2.15, d: 2.15 },
  { x: -11.15, z: -6.9, w: 2.2, d: 2.0 },
  { x: -11.15, z: 4.2, w: 2.2, d: 2.0 },
]

export const YARD = 15.2
