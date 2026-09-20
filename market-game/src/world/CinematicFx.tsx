import { SMAA, EffectComposer } from '@react-three/postprocessing'

export function CinematicFx() {
  return (
    <EffectComposer>
      <SMAA />
    </EffectComposer>
  )
}
