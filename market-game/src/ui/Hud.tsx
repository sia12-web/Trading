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
    g.phase === 'preopen' ? 'PRE-OPEN' : g.phase === 'opening' ? 'CASH OPEN' : 'LIVE'

  if (g.scene === 'hub') return <HubHud />

  return (
    <div className="hud iso-hud">
      <div className="chip chip-tl">
        <div className="kicker">DOW</div>
        <button className="ghost" onClick={backToHub}>
          HUB
        </button>
      </div>

      <div className="chip chip-tr">
        <div className="time">{formatNyClock(g.clockMin)}</div>
        <div className="phase">{phaseLabel}</div>
        <div className="res">
          {fmtPx(g.livePrice)}
        </div>
        {g.phase !== 'live' && (
          <button className="ghost" onClick={skipToLive}>
            SKIP
          </button>
        )}
      </div>

      {g.fills.length > 0 && (
        <div className="chip chip-bl tape">
          {g.fills.slice(0, 3).map((f) => (
            <div key={f.id} className="tape-row">
              <span className={f.side}>{f.side === 'buy' ? 'B' : 'S'}</span>
              <span>{STORES.find((s) => s.id === f.storeId)?.name.replace(/ .*/, '')}</span>
              <span>{fmtPx1(f.fill)}</span>
            </div>
          ))}
        </div>
      )}

      {g.phase === 'opening' && <div className="open-pip">9:30 NYC</div>}

      {g.phase === 'live' && !read && (
        <div className="prompt iso-prompt">
          {g.nearby ? (
            <>
              E / click — {STORES.find((s) => s.id === g.nearby)?.name}
            </>
          ) : (
            <>WASD · click store</>
          )}
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
        <div className="kicker">MARKETS</div>
        <button className="ghost hit" onClick={() => enterDow()}>
          ENTER DOW
        </button>
      </div>
      <div className="chip chip-tr">
        <div className="phase">WASD · CLICK MILL</div>
      </div>
      <div id="locked-msg" className="locked-toast" style={{ opacity: 0 }} />
    </div>
  )
}
