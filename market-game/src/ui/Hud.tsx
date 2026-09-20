import { fmtPx, fmtPx1 } from '../game/auction'
import { backToHub, skipToLive } from '../game/gameStore'
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
    <div className="hud">
      <div className="topbar">
        <div className="brand">
          <div className="kicker">FUTURES WORLD</div>
          <h1>DOW DISTRICT</h1>
          <button className="ghost" onClick={backToHub} style={{ marginTop: 8, width: 'auto' }}>
            ← HUB
          </button>
        </div>
        <div className="px-live">
          <div className="lbl">PRICE · YM</div>
          <div className="num">{fmtPx(g.livePrice)}</div>
          <div className="pnl">
            5M AVWAP {fmtPx1(g.avwap.vwap)} · σ {fmtPx1(g.avwap.sigma)} · P&L{' '}
            <span className={g.pnl >= 0 ? 'up' : 'down'}>
              {g.pnl >= 0 ? '+' : ''}
              {g.pnl.toFixed(1)} pts
            </span>
          </div>
        </div>
        <div className="clock-block">
          <div className="ny">NEW YORK</div>
          <div className="time">{formatNyClock(g.clockMin)}</div>
          <div className="phase">{phaseLabel}</div>
          {g.phase !== 'live' && (
            <button className="ghost" onClick={skipToLive} style={{ marginTop: 8 }}>
              SKIP TO OPEN
            </button>
          )}
        </div>
      </div>

      <div className="factors">
        <div className="factor">
          <b>PRICE</b>
          <span>You. Advertising. Walk into a store that is bidding for attention.</span>
        </div>
        <div className="factor">
          <b>VOLUME</b>
          <span>Divergence. Does size confirm the offer, or is the store louder than the tape?</span>
        </div>
        <div className="factor">
          <b>TIME</b>
          <span>Value is made with time. Fair already — or still an opportunity to act?</span>
        </div>
      </div>

      <div className="tape">
        <h2>AUCTION TAPE</h2>
        {g.fills.length === 0 && <div style={{ opacity: 0.55 }}>No prints yet. Take an auction.</div>}
        <ul>
          {g.fills.map((f) => (
            <li key={f.id}>
              <span className={f.side}>{f.side.toUpperCase()}</span>
              <span>{STORES.find((s) => s.id === f.storeId)?.name}</span>
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
        <div className="prompt">
          {g.nearby ? (
            <>
              Approach confirmed. Press <span className="key">E</span> to read volume & time at{' '}
              {STORES.find((s) => s.id === g.nearby)?.name}
            </>
          ) : (
            <>
              Click to look · <span className="key">WASD</span> walk · visit Yesterday, 5-Day, and 5-Month stores
            </>
          )}
        </div>
      )}

      {g.phase === 'preopen' && (
        <div className="prompt">
          Shutters are down. The bell is armed. Clock runs to <span className="key">9:30 AM NYC</span>.
        </div>
      )}

      {read && g.phase === 'live' && <StorePanel />}
      {g.pointerLocked && <div className="crosshair" />}
    </div>
  )
}

function HubHud() {
  return (
    <div className="hud">
      <div className="topbar">
        <div className="brand">
          <div className="kicker">SAM FAR · AUCTION WORLDS</div>
          <h1>MARKET GATE</h1>
        </div>
      </div>
      <div className="hub-copy">
        <h1>
          MARKETS ARE
          <br />
          PLACES
        </h1>
        <p>
          Walk Price to the DOW gate — industrial America. NASDAQ, gold, and oil stay locked until this
          district feels like a live floor.
        </p>
        <p style={{ marginTop: 10, fontFamily: 'IBM Plex Mono', fontSize: 13, color: '#d4a046' }}>
          WASD MOVE · CLICK LOOK · E ENTER / INSPECT
        </p>
      </div>
      <div id="locked-msg" className="locked-toast" style={{ opacity: 0 }} />
    </div>
  )
}
