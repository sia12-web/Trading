/** Procedural industrial / auction-floor audio. No external files. */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let amb: { stop: () => void } | null = null

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)
  }
  return ctx
}

export async function resumeAudio(): Promise<void> {
  const c = ac()
  if (c.state === 'suspended') await c.resume()
}

export function strikeBell(): void {
  const c = ac()
  const t0 = c.currentTime
  const make = (freq: number, delay: number, gain: number, decay: number) => {
    const o = c.createOscillator()
    const g = c.createGain()
    const f = c.createBiquadFilter()
    o.type = 'triangle'
    o.frequency.setValueAtTime(freq, t0 + delay)
    o.frequency.exponentialRampToValueAtTime(freq * 0.82, t0 + delay + decay)
    f.type = 'lowpass'
    f.frequency.value = 2400
    g.gain.setValueAtTime(0.0001, t0 + delay)
    g.gain.exponentialRampToValueAtTime(gain, t0 + delay + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + decay)
    o.connect(f)
    f.connect(g)
    g.connect(master!)
    o.start(t0 + delay)
    o.stop(t0 + delay + decay + 0.05)
  }
  make(392, 0, 0.55, 2.8)
  make(784, 0.02, 0.22, 2.2)
  make(523.25, 0.85, 0.4, 2.6)
  make(659.25, 1.7, 0.28, 2.4)
}

export function startAmbience(): void {
  if (amb) return
  const c = ac()
  const noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
  const data = noiseBuf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.4

  const src = c.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 180
  filter.Q.value = 0.7
  const g = c.createGain()
  g.gain.value = 0.07
  src.connect(filter)
  filter.connect(g)
  g.connect(master!)
  src.start()

  const drone = c.createOscillator()
  drone.type = 'sine'
  drone.frequency.value = 55
  const dg = c.createGain()
  dg.gain.value = 0.03
  drone.connect(dg)
  dg.connect(master!)
  drone.start()

  amb = {
    stop: () => {
      try {
        src.stop()
        drone.stop()
      } catch {
        /* already stopped */
      }
    },
  }
}

export function clank(): void {
  const c = ac()
  const t0 = c.currentTime
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'square'
  o.frequency.setValueAtTime(140 + Math.random() * 80, t0)
  o.frequency.exponentialRampToValueAtTime(60, t0 + 0.18)
  g.gain.setValueAtTime(0.08, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2)
  o.connect(g)
  g.connect(master!)
  o.start(t0)
  o.stop(t0 + 0.22)
}

export function printFill(up: boolean): void {
  const c = ac()
  const t0 = c.currentTime
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(up ? 520 : 310, t0)
  o.frequency.exponentialRampToValueAtTime(up ? 880 : 180, t0 + 0.12)
  g.gain.setValueAtTime(0.12, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
  o.connect(g)
  g.connect(master!)
  o.start()
  o.stop(t0 + 0.18)
}
