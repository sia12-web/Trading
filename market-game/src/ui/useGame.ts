import { useSyncExternalStore } from 'react'
import { getGame, storeRead, subscribeGame, type GameSnapshot } from '../game/gameStore'

export function useGame(): GameSnapshot {
  return useSyncExternalStore(subscribeGame, getGame, getGame)
}

export function useActiveRead() {
  const g = useGame()
  if (!g.inspecting) return null
  return storeRead(g.inspecting, g)
}
