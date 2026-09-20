import type { StoreDef } from './types'

/**
 * Compact Clash-style village. One isometric shot sees every store.
 * Yesterday south, five-day north, 5M AVWAP west, bell plaza center.
 */
export const STORES: StoreDef[] = [
  {
    id: 'y-hvn',
    range: 'yesterday',
    kind: 'hvn',
    name: 'Y-HVN FOUNDRY',
    subtitle: 'Yesterday NYC · High Volume Node',
    theory:
      'Acceptance. Trade clustered here yesterday. Size should show up if Price is advertising a real offer — empty furnaces mean divergence.',
    position: [-6.5, 0, 7.5],
    accent: '#e11d48',
    building: 'foundry',
  },
  {
    id: 'y-poc',
    range: 'yesterday',
    kind: 'poc',
    name: 'Y-POC HALL',
    subtitle: 'Yesterday NYC · Point of Control / Fair Value',
    theory:
      'The fairest price of yesterday’s cash session — highest traded volume. Value is made with time; lingering here balances the day.',
    position: [0, 0, 8.5],
    accent: '#b45309',
    building: 'hall',
  },
  {
    id: 'y-lvn',
    range: 'yesterday',
    kind: 'lvn',
    name: 'Y-LVN DOCK',
    subtitle: 'Yesterday NYC · Low Volume Node',
    theory:
      'A vacuum. Price traveled fast and left little trade. If volume floods while you stand here, the single print is filling — window closing.',
    position: [6.5, 0, 7.5],
    accent: '#38bdf8',
    building: 'dock',
  },
  {
    id: '5d-hvn',
    range: 'fiveDay',
    kind: 'hvn',
    name: '5D HVN YARD',
    subtitle: 'Five-day FRVP · High Volume Node',
    theory:
      'Short-term money’s other home. A second distribution across five NYC sessions. Slow, heavy steel — fills, not spikes.',
    position: [-6.5, 0, -7.5],
    accent: '#fb7185',
    building: 'yard',
  },
  {
    id: '5d-poc',
    range: 'fiveDay',
    kind: 'poc',
    name: '5D POC MILL',
    subtitle: 'Five-day FRVP · Point of Control',
    theory:
      'Composite fair value for the last five cash sessions. Wholesale vs retail is judged from here. Time spent = value accepted.',
    position: [0, 0, -8.5],
    accent: '#f59e0b',
    building: 'mill',
  },
  {
    id: '5d-lvn',
    range: 'fiveDay',
    kind: 'lvn',
    name: '5D LVN ALLEY',
    subtitle: 'Five-day FRVP · Low Volume Node',
    theory:
      'The air pocket between five-day distributions. Fast rejection if you belong elsewhere; a trap if you advertise without time.',
    position: [6.5, 0, -7.5],
    accent: '#7dd3fc',
    building: 'alley',
  },
  {
    id: 'avwap',
    range: 'fiveMonth',
    kind: 'avwap',
    name: '5M AVWAP SPIRE',
    subtitle: 'Five-month Anchored VWAP · live',
    theory:
      'Long-term money. Anchored at cash open five months back, Σ(P·V)/ΣV, updating on every print. Price is advertising; this tower is the institutional benchmark.',
    position: [-9.5, 0, 0],
    accent: '#22d3ee',
    building: 'spire',
  },
  {
    id: 'avwap-upper',
    range: 'fiveMonth',
    kind: 'avwap',
    name: '+1σ BAND',
    subtitle: 'Five-month AVWAP · upper 1σ',
    theory:
      'Premium to long-term value. The band breathes with incoming volume. Time still regulates whether this stretch is an opportunity or already spent.',
    position: [-9.2, 0, -4.6],
    accent: '#3b82f6',
    building: 'band',
  },
  {
    id: 'avwap-lower',
    range: 'fiveMonth',
    kind: 'avwap',
    name: '−1σ BAND',
    subtitle: 'Five-month AVWAP · lower 1σ',
    theory:
      'Discount to long-term value. Gold-teal money from the desk’s 5-month bands, made physical as a loading annex that rises and falls with σ.',
    position: [-9.2, 0, 4.6],
    accent: '#b8a04a',
    building: 'band',
  },
]

export const LOCKED_MARKETS = [
  { id: 'nasdaq' as const, name: 'NASDAQ', world: 'Technology campuses', position: [7.5, 0, 0] as [number, number, number] },
  { id: 'gold' as const, name: 'GOLD', world: 'Mines', position: [0, 0, 7.5] as [number, number, number] },
  { id: 'oil' as const, name: 'OIL', world: 'Fields & refineries', position: [-7.5, 0, 0] as [number, number, number] },
]

export const DOW_GATE: [number, number, number] = [0, 0, -7.5]

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

export function storeAtPoint(x: number, z: number, maxDist = 3.6): StoreDef | null {
  return nearestStore(x, z, maxDist)
}

export const COLLISIONS: Array<{ x: number; z: number; w: number; d: number }> = [
  { x: 0, z: 0, w: 2.2, d: 2.2 },
  { x: -6.5, z: 7.5, w: 3.6, d: 3.2 },
  { x: 0, z: 8.5, w: 4.0, d: 3.4 },
  { x: 6.5, z: 7.5, w: 3.6, d: 3.2 },
  { x: -6.5, z: -7.5, w: 3.8, d: 3.4 },
  { x: 0, z: -8.5, w: 4.2, d: 3.4 },
  { x: 6.5, z: -7.5, w: 3.2, d: 3.4 },
  { x: -9.5, z: 0, w: 3.0, d: 3.0 },
  { x: -9.2, z: -4.6, w: 2.6, d: 2.6 },
  { x: -9.2, z: 4.6, w: 2.6, d: 2.6 },
]

export const YARD = 15.5
