import { fmtPx, fmtPx1 } from '../game/auction'
import { backToHub, enterDow, skipToLive } from '../game/gameStore'
import { formatNyClock } from '../game/session'
import { STORES } from '../game/stores'
import { StorePanel } from './StorePanel'
import { useActiveRead, useGame } from './useGame'

export function Hud() {
  const g = useGame()
  const read = useActiveRead()
  const phaseLabel =
    g.phase === 'preopen' ? 'PRE-OPEN' : g.phase === 'opening' ? 'MARKET OPEN' : 'NYC CASH LIVE'

  if (g.scene === 'hub') return <HubHud />

  return (
    <div className="hud iso-hud">
      <div className="chip chip-tl">
        <div className="kicker">FUTURES WORLD</div>
        <h1>DOW DISTRICT</h1>
        <button className="ghost" onClick={backToHub}>
          ← HUB
        </button>
        <div className="factor-row">
          <span>PRICE you</span>
          <span>VOLUME divergence</span>
          <span>TIME opportunity</span>
        </div>
      </div>

      <div className="chip chip-tr">
        <div className="ny">NEW YORK</div>
        <div className="time">{formatNyClock(g.clockMin)}</div>
        <div className="phase">{phaseLabel}</div>
        <div className="res">
          <b>PRICE</b> {fmtPx(g.livePrice)}
        </div>
        <div className="res dim">
          5M AVWAP {fmtPx1(g.avwap.vwap)} · σ {fmtPx1(g.avwap.sigma)}
        </div>
        <div className={'res ' + (g.pnl >= 0 ? 'up' : 'down')}>
          P&L {g.pnl >= 0 ? '+' : ''}
          {g.pnl.toFixed(1)} pts
        </div>
        {g.phase !== 'live' && (
          <button className="ghost" onClick={skipToLive} style={{ marginTop: 8, width: '100%' }}>
            SKIP TO OPEN
          </button>
        )}
      </div>

      <div className="chip chip-bl tape">
        <h2>AUCTION TAPE</h2>
        {g.fills.length === 0 && <div style={{ opacity: 0.55 }}>No prints yet.</div>}
        <ul>
          {g.fills.slice(0, 5).map((f) => (
            <li key={f.id}>
              <span className={f.side}>{f.side.toUpperCase()}</span>
              <span>{STORES.find((s) => s.id === f.storeId)?.name.replace(/ .*/, '')}</span>
              <span>{fmtPx1(f.fill)}</span>
            </li>
          ))}
        </ul>
      </div>

      {g.phase === 'opening' && (
        <div className="open-banner">
          <div className="card">
            <small>CASH SESSION</small>
            <h2>MARKET OPEN</h2>
            <small>9:30 AM NEW YORK</small>
          </div>
        </div>
      )}

      {g.phase === 'live' && !read && (
        <div className="prompt iso-prompt">
          {g.nearby ? (
            <>
              Press <span className="key">E</span> or click the building — {STORES.find((s) => s.id === g.nearby)?.name}
            </>
          ) : (
            <>
              <span className="key">WASD</span> move Price · click a store · click ground to walk
            </>
          )}
        </div>
      )}

      {g.phase === 'preopen' && (
        <div className="prompt iso-prompt">
          Shutters down. Bell armed. Clock runs to <span className="key">9:30 AM NYC</span>.
        </div>
      )}

      {read && g.phase === 'live' && <StorePanel />}
    </div>
  )
}

function HubHud() {
  return (
    <div className="hud iso-hud">
      <div className="chip chip-tl">
        <div className="kicker">SAM FAR · AUCTION WORLDS</div>
        <h1>MARKET GATE</h1>
        <p className="hub-blurb">
          Four markets. Only DOW is unlocked. Click the red mill or press ENTER DOW.
        </p>
        <button className="ghost hit" onClick={() => enterDow()}>
          ENTER DOW DISTRICT
        </button>
      </div>
      <div className="chip chip-tr">
        <div className="ny">ISOMETRIC</div>
        <div className="phase">WASD MOVE · CLICK DOW</div>
      </div>
      <div id="locked-msg" className="locked-toast" style={{ opacity: 0 }} />
    </div>
  )
}
