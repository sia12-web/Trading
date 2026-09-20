import type { StoreDef } from './types'

/**
 * Packed Clash-style mill village. Yesterday south, five-day north,
 * 5M AVWAP west, bell courtyard center — buildings almost touch.
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
    position: [-5.6, 0, 5.35],
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
    position: [0, 0, 6.15],
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
    position: [5.6, 0, 5.35],
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
    position: [-5.6, 0, -5.35],
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
    position: [0, 0, -6.15],
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
    position: [5.6, 0, -5.35],
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
    position: [-7.15, 0, 0],
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
    position: [-6.45, 0, -3.35],
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
    position: [-6.45, 0, 3.35],
    accent: '#8a7040',
    building: 'pit',
  },
]

export const LOCKED_MARKETS = [
  { id: 'nasdaq' as const, name: 'NASDAQ', world: 'Technology campuses', position: [5.1, 0, 0] as [number, number, number] },
  { id: 'gold' as const, name: 'GOLD', world: 'Mines', position: [2.85, 0, 4.55] as [number, number, number] },
  { id: 'oil' as const, name: 'OIL', world: 'Fields & refineries', position: [-5.1, 0, 0] as [number, number, number] },
]

export const DOW_GATE: [number, number, number] = [0, 0, -5.1]

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

/** Tight cores so Price can walk the porch into each stall. */
export const COLLISIONS: Array<{ x: number; z: number; w: number; d: number }> = [
  { x: 0, z: 0, w: 1.35, d: 1.35 },
  { x: -5.6, z: 5.15, w: 4.4, d: 2.15 },
  { x: 0, z: 5.95, w: 5.2, d: 2.25 },
  { x: 5.6, z: 5.55, w: 3.6, d: 1.7 },
  { x: -5.6, z: -5.55, w: 4.6, d: 2.2 },
  { x: 0, z: -6.35, w: 5.4, d: 2.35 },
  { x: 5.6, z: -5.55, w: 3.4, d: 1.8 },
  { x: -7.45, z: 0, w: 1.55, d: 1.55 },
  { x: -7.05, z: -3.35, w: 1.9, d: 2.2 },
  { x: -7.05, z: 3.35, w: 1.9, d: 2.2 },
]

export const YARD = 15.2
