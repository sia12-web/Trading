import { closeInspect, takeAuction } from '../game/gameStore'
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
      <p>{store.subtitle}</p>
      {g.message && <p style={{ color: '#d4a046', fontSize: 13 }}>{g.message}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="ghost hit" onClick={() => takeAuction('buy')} style={{ flex: 1 }}>
          B take
        </button>
        <button className="ghost hit" onClick={() => takeAuction('sell')} style={{ flex: 1 }}>
          F fade
        </button>
        <button className="ghost" onClick={closeInspect} style={{ flex: 1 }}>
          ESC
        </button>
      </div>
    </div>
  )
}
