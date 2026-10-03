// One shared AudioContext + AnalyserNode. Both the mic and the REPLAY <audio> element feed the analyser,
// so the voice orb moves for live and replayed calls alike.

let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

export function audioCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.78
  }
  return ctx
}

export function getAnalyser(): AnalyserNode {
  audioCtx()
  return analyser!
}

export async function resumeAudio() {
  const c = audioCtx()
  if (c.state === 'suspended') await c.resume()
}

/** Route an <audio> element through the analyser (and on to the speakers). Safe to call repeatedly. */
export function attachElement(el: HTMLMediaElement) {
  const c = audioCtx()
  if (elementSources.has(el)) return
  const src = c.createMediaElementSource(el)
  src.connect(getAnalyser())
  src.connect(c.destination)
  elementSources.set(el, src)
}
