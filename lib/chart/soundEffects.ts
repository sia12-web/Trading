/**
 * TradingView-style Alert Audio Synthesizer (Web Audio API)
 *
 * Recreates the signature TradingView dual-tone alert chime:
 * 880Hz (A5) -> 1318.51Hz (E6) harmonic shimmer with exponential decay.
 * Zero external audio assets required; immune to 404 or CORS issues.
 */

let sharedAudioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        sharedAudioCtx = new AudioCtx()
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume()
    }
    return sharedAudioCtx
  } catch (err) {
    console.warn('[soundEffects] AudioContext initialization notice:', err)
    return null
  }
}

/**
 * Play TradingView-style alert chime.
 */
export function playTradingViewChime(): void {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    const now = ctx.currentTime

    // Primary Fundamental Tone: 880 Hz (A5)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(880, now)
    gain1.gain.setValueAtTime(0.35, now)
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.55)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.55)

    // Harmonic Perfect Fifth: 1318.51 Hz (E6 - 70ms offset for the iconic "ding-dong" bell interval)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1318.51, now + 0.06)
    gain2.gain.setValueAtTime(0.0001, now)
    gain2.gain.setValueAtTime(0.40, now + 0.06)
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.85)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.06)
    osc2.stop(now + 0.85)

    // High Shimmer Harmonic: 1760 Hz (A6 - chime glass resonance)
    const osc3 = ctx.createOscillator()
    const gain3 = ctx.createGain()
    osc3.type = 'sine'
    osc3.frequency.setValueAtTime(1760, now + 0.10)
    gain3.gain.setValueAtTime(0.0001, now)
    gain3.gain.setValueAtTime(0.20, now + 0.10)
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.95)
    osc3.connect(gain3)
    gain3.connect(ctx.destination)
    osc3.start(now + 0.10)
    osc3.stop(now + 0.95)
  } catch (err) {
    console.warn('[soundEffects] Failed to play TradingView chime:', err)
  }
}
