import { fmtPx1 } from '../game/auction'
import { closeInspect, takeAuction } from '../game/gameStore'
import { STORES } from '../game/stores'
import { useActiveRead, useGame } from './useGame'

export function StorePanel() {
  const g = useGame()
  const read = useActiveRead()
  if (!read) return null
  const store = STORES.find((s) => s.id === read.id)
  if (!store) return null
  const volPct = Math.round(((read.divergence + 1) / 2) * 100)
  const timePct = Math.round(read.timeOpportunity * 100)
  const volColor = read.divergence >= 0 ? '#089981' : '#f23645'
  const timeColor = read.fairToday ? '#f59e0b' : '#22d3ee'

  return (
    <div className="store-panel" style={{ borderColor: store.accent }}>
      <div className="sub">{store.subtitle}</div>
      <h3>{store.name}</h3>
      <div className="sub">ADVERTISED {fmtPx1(read.advertised)}</div>
      <p>{store.theory}</p>
      <div className="meters">
        <div className="meter">
          <label>
            <span>VOLUME · DIVERGENCE</span>
            <span>{read.volumeLabel}</span>
          </label>
          <div className="bar">
            <i style={{ width: `${volPct}%`, background: volColor }} />
          </div>
        </div>
        <div className="meter">
          <label>
            <span>TIME · OPPORTUNITY</span>
            <span>{read.timeLabel}</span>
          </label>
          <div className="bar">
            <i style={{ width: `${timePct}%`, background: timeColor }} />
          </div>
        </div>
      </div>
      {g.message && <p style={{ color: '#d4a046', fontSize: 15 }}>{g.message}</p>}
      <div className="actions">
        <button className="buy" onClick={() => takeAuction('buy')}>
          BUY
        </button>
        <button className="sell" onClick={() => takeAuction('sell')}>
          SELL
        </button>
      </div>
      <button className="ghost" onClick={closeInspect} style={{ marginTop: 8, width: '100%' }}>
        ESC CLOSE · B BUY · F SELL
      </button>
    </div>
  )
}
