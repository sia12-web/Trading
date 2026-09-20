import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing'
import { useGame } from '../ui/useGame'

export function CinematicFx() {
  const g = useGame()
  const openBoost = g.phase === 'opening' ? 0.55 : 0
  return (
    <EffectComposer>
      <Bloom
        luminanceThreshold={0.72}
        intensity={0.85 + openBoost}
        mipmapBlur
        luminanceSmoothing={0.2}
      />
      <Vignette eskil={false} offset={0.25} darkness={0.45} />
      <SMAA />
    </EffectComposer>
  )
}
