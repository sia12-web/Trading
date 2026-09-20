import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing'
import { useGame } from '../ui/useGame'

export function CinematicFx() {
  const g = useGame()
  const openBoost = g.phase === 'opening' ? 0.35 : 0
  return (
    <EffectComposer>
      <Bloom
        luminanceThreshold={0.84}
        intensity={0.38 + openBoost}
        mipmapBlur
        luminanceSmoothing={0.22}
      />
      <Vignette eskil={false} offset={0.42} darkness={0.1} />
      <SMAA />
    </EffectComposer>
  )
}
