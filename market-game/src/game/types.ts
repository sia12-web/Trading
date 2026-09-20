export type NodeKind = 'hvn' | 'lvn' | 'poc' | 'avwap'

export type RangeKind = 'yesterday' | 'fiveDay' | 'fiveMonth'

export type Side = 'buy' | 'sell'

export type SceneId = 'hub' | 'dow'

export type SessionPhase = 'preopen' | 'opening' | 'live'

export type OhlcvBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type VolumeNode = {
  price: number
  volume: number
  kind: 'poc' | 'hvn' | 'lvn'
}

export type VolumeProfile = {
  poc: VolumeNode
  hvn: VolumeNode
  lvn: VolumeNode
  vah: number
  val: number
  high: number
  low: number
  totalVolume: number
  bucketSize: number
  bins: Array<{ price: number; volume: number }>
}

export type AnchoredVwap = {
  vwap: number
  sigma: number
  upper1: number
  lower1: number
  upper2: number
  lower2: number
  sumPV: number
  sumP2V: number
  sumV: number
  barCount: number
}

export type StoreId =
  | 'y-hvn'
  | 'y-lvn'
  | 'y-poc'
  | '5d-hvn'
  | '5d-lvn'
  | '5d-poc'
  | 'avwap'
  | 'avwap-upper'
  | 'avwap-lower'

export type StoreDef = {
  id: StoreId
  range: RangeKind
  kind: NodeKind
  name: string
  subtitle: string
  theory: string
  position: [number, number, number]
  accent: string
  building: 'foundry' | 'dock' | 'hall' | 'yard' | 'alley' | 'mill' | 'spire' | 'band'
}

export type StoreRead = {
  id: StoreId
  advertised: number
  liveVolume: number
  typicalVolume: number
  /** -1 empty advertising, 0 balanced, +1 size confirms */
  divergence: number
  /** 1 = still time to act, 0 = already fair / window closed */
  timeOpportunity: number
  timeLabel: string
  volumeLabel: string
  fairToday: boolean
}

export type Fill = {
  id: number
  t: number
  storeId: StoreId
  side: Side
  advertised: number
  fill: number
  divergence: number
  timeOpportunity: number
  note: string
  mark?: number
  pnl?: number
}

export type LockedMarket = {
  id: 'nasdaq' | 'gold' | 'oil'
  name: string
  world: string
  position: [number, number, number]
}
