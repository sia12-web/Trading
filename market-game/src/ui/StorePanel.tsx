import { closeInspect } from '../game/gameStore'
import { STORES } from '../game/stores'
import { useActiveRead, useGame } from './useGame'

export function StorePanel() {
  const g = useGame()
  const read = useActiveRead()
  if (!read) return null
  const store = STORES.find((s) => s.id === read.id)
  if (!store) return null

  return (
    <div className="store-panel" style={{ borderColor: store.accent }}>
      <h3>{store.name}</h3>
      <p>{store.theory}</p>
      {g.message && <p style={{ color: '#d4a046', fontSize: 13 }}>{g.message}</p>}
      <button className="ghost" onClick={closeInspect} style={{ marginTop: 8, width: '100%' }}>
        ESC · B take · F fade
      </button>
    </div>
  )
}
