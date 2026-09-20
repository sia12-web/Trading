import { useGame } from './ui/useGame'
import { Hud } from './ui/Hud'
import { DowScene } from './scenes/DowScene'
import { HubScene } from './scenes/HubScene'

export function App() {
  const g = useGame()
  return (
    <>
      {g.scene === 'hub' ? <HubScene /> : <DowScene />}
      <Hud />
    </>
  )
}
