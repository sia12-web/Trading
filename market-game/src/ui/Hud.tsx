import { fmtPx, fmtPx1 } from '../game/auction'
import { backToHub, enterDow, inStall, skipToOpen, takeAuction } from '../game/gameStore'
import { formatNyClock } from '../game/session'
import { STORES } from '../game/stores'
import { StorePanel } from './StorePanel'
import { useGame } from './useGame'

export function Hud() {
  const g = useGame()
  const stall = inStall(g)
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
        <div className="res">{fmtPx(g.livePrice)}</div>
        {g.phase === 'preopen' && (
          <button className="ghost" onClick={skipToOpen}>
            9:30
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

      {g.phase === 'opening' && <div className="open-pip">9:30 NYC · CASH OPEN</div>}

      {g.phase === 'live' && (
        <div className="prompt iso-prompt">
          {stall || g.inspecting ? (
            <>
              On the floor{' '}
              <button
                className="ghost hit"
                onClick={(e) => {
                  e.stopPropagation()
                  takeAuction('buy')
                }}
              >
                B take
              </button>{' '}
              <button
                className="ghost hit"
                onClick={(e) => {
                  e.stopPropagation()
                  takeAuction('sell')
                }}
              >
                F fade
              </button>
            </>
          ) : (
            <>WASD · walk a stall</>
          )}
        </div>
      )}

      {g.message && g.phase === 'live' && !g.inspecting && !g.lastPrint && (
        <div className="floor-note">{g.message}</div>
      )}

      {g.inspecting && <StorePanel />}
    </div>
  )
}

function HubHud() {
  return (
    <div className="hud iso-hud">
      <div className="chip chip-tl">
        <div className="kicker">DOW</div>
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
