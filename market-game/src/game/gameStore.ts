import { PRINT_HOLD_MS, pushVwapTick, stallOccupancy, timeOpportunity, volumeDivergence } from './auction'
import { clank, printFill, resumeAudio, startAmbience, steamWhistle, strikeBell } from './audio'
import { buildDowMarket, rng } from './marketData'
import {
  LIVE_TIME_SCALE,
  NY_OPEN_MIN,
  OPEN_CINEMATIC_SEC,
  PREOPEN_MIN,
  sessionProgress,
} from './session'
import { nearestStore, porchOf, STORES } from './stores'
import type { AnchoredVwap, Fill, SceneId, SessionPhase, Side, StoreId, StoreRead } from './types'

const market = buildDowMarket()
const tapeRand = rng(77)

type Listener = () => void

export type PlayerState = {
  x: number
  y: number
  z: number
  yaw: number
}

export type GameSnapshot = {
  scene: SceneId
  phase: SessionPhase
  clockMin: number
  openElapsed: number
  player: PlayerState
  livePrice: number
  avwap: AnchoredVwap
  nearby: StoreId | null
  inspecting: StoreId | null
  fills: Fill[]
  pnl: number
  tpo: Record<string, number>
  liveVol: Record<string, number>
  shutter: number
  floorAlive: number
  pointerLocked: boolean
  message: string | null
  lastPrint: { storeId: StoreId; side: Side; at: number } | null
  walkTo: { x: number; z: number } | null
}

const typicalVol: Record<StoreId, number> = {
  'y-hvn': market.yesterday.hvn.volume / 12,
  'y-lvn': Math.max(40, market.yesterday.lvn.volume / 12),
  'y-poc': market.yesterday.poc.volume / 12,
  '5d-hvn': market.fiveDay.hvn.volume / 18,
  '5d-lvn': Math.max(40, market.fiveDay.lvn.volume / 18),
  '5d-poc': market.fiveDay.poc.volume / 18,
  avwap: 400,
  'avwap-upper': 280,
  'avwap-lower': 280,
}

/** Stall character so HVN/POC open full and LVN stays a vacuum unless flooded. */
const volBias: Record<StoreId, number> = {
  'y-hvn': 1.72,
  'y-poc': 1.18,
  'y-lvn': 0.22,
  '5d-hvn': 1.48,
  '5d-poc': 1.58,
  '5d-lvn': 0.18,
  avwap: 1.35,
  'avwap-upper': 1.05,
  'avwap-lower': 1.12,
}

function floorTape(): { liveVol: Record<string, number>; tpo: Record<string, number> } {
  const liveVol: Record<string, number> = {}
  for (const id of Object.keys(typicalVol) as StoreId[]) {
    liveVol[id] = typicalVol[id]! * volBias[id]!
  }
  return {
    liveVol,
    tpo: { 'y-poc': 6.2, 'y-hvn': 0.8, '5d-poc': 0.4 },
  }
}

function advertisedFor(id: StoreId, avwap: AnchoredVwap): number {
  switch (id) {
    case 'y-hvn':
      return market.yesterday.hvn.price
    case 'y-lvn':
      return market.yesterday.lvn.price
    case 'y-poc':
      return market.yesterday.poc.price
    case '5d-hvn':
      return market.fiveDay.hvn.price
    case '5d-lvn':
      return market.fiveDay.lvn.price
    case '5d-poc':
      return market.fiveDay.poc.price
    case 'avwap':
      return avwap.vwap
    case 'avwap-upper':
      return avwap.upper1
    case 'avwap-lower':
      return avwap.lower1
  }
}

function kindOf(id: StoreId) {
  if (id.endsWith('hvn')) return 'hvn' as const
  if (id.endsWith('lvn')) return 'lvn' as const
  if (id.endsWith('poc')) return 'poc' as const
  return 'avwap' as const
}

let fillSeq = 1
let lastUiEmit = 0
let openWallMs = 0

function fresh(): GameSnapshot {
  return {
    scene: 'hub',
    phase: 'preopen',
    clockMin: PREOPEN_MIN,
    openElapsed: 0,
    player: { x: 0, y: 0, z: 1.1, yaw: 0 },
    livePrice: market.priorClose,
    avwap: { ...market.avwap },
    nearby: null,
    inspecting: null,
    fills: [],
    pnl: 0,
    ...floorTape(),
    shutter: 0,
    floorAlive: 0,
    pointerLocked: false,
    message: null,
    lastPrint: null,
    walkTo: null,
  }
}

let state = fresh()
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

function set(partial: Partial<GameSnapshot>, force = true) {
  state = { ...state, ...partial }
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (force || now - lastUiEmit > 70) {
    lastUiEmit = now
    emit()
  }
}

export const marketWorld = market

export function getGame(): GameSnapshot {
  return state
}

export function subscribeGame(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function enterDow() {
  void resumeAudio().then(() => startAmbience())
  state = {
    ...fresh(),
    scene: 'dow',
    phase: 'preopen',
    clockMin: PREOPEN_MIN,
    player: { x: -1.65, y: 0, z: 11.55, yaw: 0 },
    livePrice: market.priorClose,
    message: 'NYC cash is about to open. Move Price to a store.',
  }
  emit()
}

export function backToHub() {
  state = fresh()
  emit()
}

export function skipToOpen() {
  if (state.phase === 'opening' || state.phase === 'live') return
  void resumeAudio().then(() => {
    startAmbience()
    strikeBell()
    steamWhistle()
  })
  const tape = floorTape()
  openWallMs = performance.now()
  set({
    scene: 'dow',
    phase: 'opening',
    clockMin: NY_OPEN_MIN,
    openElapsed: 0,
    shutter: 0,
    floorAlive: 0,
    livePrice: market.openPrint,
    message: null,
    liveVol: tape.liveVol,
    tpo: tape.tpo,
    player: state.scene === 'dow' ? state.player : { x: -1.65, y: 0, z: 11.55, yaw: 0 },
  })
}

export function setPointerLocked(v: boolean) {
  if (state.pointerLocked === v) return
  set({ pointerLocked: v })
}

export function setPlayer(p: PlayerState) {
  const near = nearestStore(p.x, p.z)
  const nearby = near?.id ?? null
  if (
    p.x === state.player.x &&
    p.z === state.player.z &&
    p.yaw === state.player.yaw &&
    nearby === state.nearby
  ) {
    return
  }
  const nearbyChanged = nearby !== state.nearby
  const wasIn = nearestStore(state.player.x, state.player.z, 3.15)?.id ?? null
  const nowIn = nearby && nearestStore(p.x, p.z, 3.15)?.id === nearby ? nearby : null
  set({ player: p, nearby }, nearbyChanged || wasIn !== nowIn)
}

export function toggleInspect() {
  if (!state.nearby) return
  set({
    inspecting: state.inspecting === state.nearby ? null : state.nearby,
    message: null,
  })
}

export function inspectStore(id: StoreId) {
  const s = STORES.find((x) => x.id === id)
  const porch = s ? porchOf(s) : null
  set({ inspecting: id, nearby: id, message: null, walkTo: porch })
}

export function closeInspect() {
  if (state.inspecting) set({ inspecting: null })
}

export function setWalkTarget(x: number, z: number) {
  set({ walkTo: { x, z } }, false)
}

export function getWalkTarget() {
  return state.walkTo
}

export function clearWalkTarget() {
  if (state.walkTo) set({ walkTo: null }, false)
}

export function storeRead(id: StoreId, snap: GameSnapshot = state): StoreRead {
  const advertised = advertisedFor(id, snap.avwap)
  const liveVolume = snap.liveVol[id] ?? typicalVol[id]! * 0.7
  const typicalVolume = typicalVol[id]!
  const kind = kindOf(id)
  const divergence = volumeDivergence({ kind, liveVolume, typicalVolume })
  const t = timeOpportunity({
    kind,
    tpoAtPrice: snap.tpo[id] ?? 0,
    sessionProgress: sessionProgress(snap.clockMin),
  })
  let volumeLabel = 'Tape matches the store'
  if (divergence > 0.35) volumeLabel = 'Size confirms — divergence favors you'
  else if (divergence < -0.35) volumeLabel = 'Advertising without size — fade the offer'
  if (kind === 'lvn') {
    if (divergence < -0.25) volumeLabel = 'Vacuum flooding — divergence against Price'
    else if (divergence > 0.25) volumeLabel = 'Still thin — fast market holds'
  }
  return {
    id,
    advertised,
    liveVolume,
    typicalVolume,
    divergence,
    timeOpportunity: t.opportunity,
    timeLabel: t.label,
    volumeLabel,
    fairToday: t.fairToday,
  }
}

export function stallState(id: StoreId, snap: GameSnapshot = state) {
  const read = storeRead(id, snap)
  const printed = snap.lastPrint && snap.lastPrint.storeId === id ? performance.now() - snap.lastPrint.at : 99999
  const printBoost = printed < PRINT_HOLD_MS ? 1 - printed / PRINT_HOLD_MS : 0
  const printSide = printed < PRINT_HOLD_MS && snap.lastPrint ? snap.lastPrint.side : null
  return {
    ...read,
    ...stallOccupancy({
      kind: kindOf(id),
      divergence: read.divergence,
      timeOpportunity: read.timeOpportunity,
      shutter: snap.shutter,
      floorAlive: snap.floorAlive,
      phase: snap.phase,
      printBoost,
      printSide,
    }),
    printSide,
  }
}

export function inStall(snap: GameSnapshot = state): StoreId | null {
  return nearestStore(snap.player.x, snap.player.z, 5.2)?.id ?? null
}

export function takeAuction(side: Side) {
  if (state.phase !== 'live') {
    set({ message: 'Wait for the cash open.' })
    return
  }
  const id = state.inspecting ?? state.nearby ?? nearestStore(state.player.x, state.player.z, 5.2)?.id
  if (!id) {
    set({ message: 'Walk Price into a stall to take the auction.' })
    return
  }
  const read = storeRead(id)
  const slip = (1 - Math.max(0, read.divergence)) * 4.5 * (tapeRand() + 0.2)
  const fillPx = side === 'buy' ? read.advertised + slip : read.advertised - slip
  let note = 'Took the auction on the floor.'
  if (read.fairToday && read.timeOpportunity < 0.35) {
    note = 'Already fair today — thin leftover window.'
  } else if (read.divergence < -0.4) {
    note = 'Size did not confirm.'
  } else if (read.divergence > 0.4 && read.timeOpportunity > 0.45) {
    note = 'Volume confirms and time remains.'
  }
  const fill: Fill = {
    id: fillSeq++,
    t: state.clockMin,
    storeId: id,
    side,
    advertised: read.advertised,
    fill: fillPx,
    divergence: read.divergence,
    timeOpportunity: read.timeOpportunity,
    note,
  }
  printFill(side === 'buy')
  clearWalkTarget()
  const liveVol = { ...state.liveVol }
  const kind = kindOf(id)
  if (side === 'buy') {
    liveVol[id] = typicalVol[id]! * (kind === 'lvn' ? 2.6 : 2.15)
  } else {
    liveVol[id] = typicalVol[id]! * (kind === 'lvn' ? 0.18 : 0.22)
  }
  set({
    fills: [fill, ...state.fills].slice(0, 12),
    inspecting: null,
    message: null,
    lastPrint: { storeId: id, side, at: performance.now() },
    liveVol,
  })
}

function markFills(live: number, fills: Fill[]): { fills: Fill[]; pnl: number } {
  let pnl = 0
  const next = fills.map((f) => {
    const signed = f.side === 'buy' ? live - f.fill : f.fill - live
    const quality = 0.55 + f.divergence * 0.25 + f.timeOpportunity * 0.2
    const marked = signed * quality
    pnl += marked
    return { ...f, mark: live, pnl: marked }
  })
  return { fills: next, pnl }
}

export function tickGame(dt: number) {
  if (state.scene !== 'dow') return

  if (state.phase === 'preopen') {
    const clockMin = state.clockMin + dt * 0.03
    if (clockMin >= NY_OPEN_MIN) {
      void resumeAudio().then(() => {
        strikeBell()
        steamWhistle()
      })
      const tape = floorTape()
      openWallMs = performance.now()
      set({
        phase: 'opening',
        clockMin: NY_OPEN_MIN,
        openElapsed: 0,
        livePrice: market.openPrint,
        message: null,
        liveVol: tape.liveVol,
        tpo: tape.tpo,
      })
      return
    }
    set({ clockMin, shutter: 0, floorAlive: 0 }, false)
    return
  }

  if (state.phase === 'opening') {
    const openElapsed = (performance.now() - openWallMs) / 1000
    const shutter = Math.min(1, Math.max(0, (openElapsed - 0.06) / 4.4))
    const floorAlive = Math.min(1, Math.max(0, (openElapsed - 0.04) / 10.2))
    const clockMin = NY_OPEN_MIN + openElapsed / 60
    if (openElapsed >= OPEN_CINEMATIC_SEC) {
      set({
        phase: 'live',
        openElapsed,
        shutter: 1,
        floorAlive: 1,
        clockMin: NY_OPEN_MIN + OPEN_CINEMATIC_SEC / 60,
        message: null,
      })
      return
    }
    set({ openElapsed, shutter, floorAlive, clockMin })
    return
  }

  const clockMin = state.clockMin + dt * LIVE_TIME_SCALE
  const prog = sessionProgress(clockMin)
  const toward =
    market.yesterday.poc.price * 0.45 +
    state.avwap.vwap * 0.25 +
    market.fiveDay.poc.price * 0.3
  const noise = (tapeRand() - 0.5) * 7.5
  const livePrice = state.livePrice + (toward - state.livePrice) * 0.018 * dt * 8 + noise * dt

  const avwap = pushVwapTick(
    state.avwap,
    livePrice,
    2200 + tapeRand() * 1100 + Math.abs(livePrice - state.livePrice) * 480,
  )

  const liveVol = { ...state.liveVol }
  const tpo = { ...state.tpo }
  const ids: StoreId[] = [
    'y-hvn',
    'y-lvn',
    'y-poc',
    '5d-hvn',
    '5d-lvn',
    '5d-poc',
    'avwap',
    'avwap-upper',
    'avwap-lower',
  ]
  for (const id of ids) {
    const px = advertisedFor(id, avwap)
    const dist = Math.abs(livePrice - px)
    const pulse = Math.max(0.22, 1.15 - dist / 140) * typicalVol[id]! * volBias[id]!
    const wander = 0.9 + tapeRand() * 0.16
    const prev = liveVol[id] ?? pulse
    liveVol[id] = prev * 0.9 + pulse * wander * 0.1
    if (dist < 18) tpo[id] = (tpo[id] ?? 0) + dt * 0.55
  }

  if (state.nearby) {
    tpo[state.nearby] = (tpo[state.nearby] ?? 0) + dt * 0.85
  }

  const marked = markFills(livePrice, state.fills)
  if (tapeRand() < 0.012) clank()

  set(
    {
      clockMin,
      livePrice,
      avwap,
      liveVol,
      tpo,
      fills: marked.fills,
      pnl: marked.pnl,
      shutter: 1,
      floorAlive: 1,
      message: prog > 0.98 ? 'Cash session complete.' : state.message,
    },
    false,
  )
}

export function advertisedPrice(id: StoreId, snap: GameSnapshot = state): number {
  return advertisedFor(id, snap.avwap)
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __dow: Record<string, unknown> }).__dow = {
    inspectStore,
    takeAuction,
    skipToOpen,
    backToHub,
    enterDow,
    getGame,
  }
}
