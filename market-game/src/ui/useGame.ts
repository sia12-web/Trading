import { useSyncExternalStore } from 'react'
import { getGame, storeRead, subscribeGame, type GameSnapshot } from '../game/gameStore'

export function useGame(): GameSnapshot {
  return useSyncExternalStore(subscribeGame, getGame, getGame)
}

export function useActiveRead() {
  const g = useGame()
  const id = g.inspecting ?? g.nearby
  if (!id) return null
  return storeRead(id, g)
}
