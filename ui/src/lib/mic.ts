// Browser mic -> 16 kHz mono float32 chunks (~2 s) for POST /api/calls/{id}/audio.
// AudioWorklet when available, ScriptProcessor fallback. Needs a secure context (https or localhost).

import { audioCtx, getAnalyser } from './audio'

const TARGET_SR = 16000
const CHUNK_S = 2

const WORKLET_SRC = `
class TapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('tw-tap', TapProcessor)
`

/** Streaming linear resampler with a box pre-filter (good enough for speech -> Parakeet). */
class Resampler {
  private ratio: number
  private pos = 0 // fractional read position into the pending input
  private pending = new Float32Array(0)
  constructor(inRate: number, outRate: number) {
    this.ratio = inRate / outRate
  }
  push(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.pending.length + input.length)
    buf.set(this.pending)
    buf.set(input, this.pending.length)
    const out: number[] = []
    const r = this.ratio
    const half = Math.max(0, Math.floor(r / 2))
    while (this.pos + 1 < buf.length) {
      const i = Math.floor(this.pos)
      const f = this.pos - i
      let v: number
      if (half >= 1) {
        // average a window around the sample (anti-alias for 48k -> 16k)
        let s = 0
        let n = 0
        for (let k = i - half; k <= i + half; k++) {
          if (k >= 0 && k < buf.length) {
            s += buf[k]
            n++
          }
        }
        v = s / n
      } else {
        v = buf[i] * (1 - f) + buf[i + 1] * f
      }
      out.push(v)
      this.pos += r
    }
    const keepFrom = Math.max(0, Math.floor(this.pos) - half - 1)
    this.pending = buf.slice(keepFrom)
    this.pos -= keepFrom
    return Float32Array.from(out)
  }
}

let workletLoaded = false

export interface MicHandle {
  stop: () => void
  mode: 'worklet' | 'script-processor'
}

export interface StreamOpts {
  onChunk: (pcm: Float32Array) => void
  onLevel: (rms: number) => void
}

export async function startMic(opts: StreamOpts): Promise<MicHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone needs a secure context (open the UI on localhost or https)')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  return startStream(stream, opts, true)
}

/** Any audio stream (the laptop mic, or the caller's voice on an in-app call) -> the same 16 kHz chunks.
 *  `owned`: stop the stream's tracks when done (true for our own mic, false for a remote caller). */
export async function startStream(stream: MediaStream, opts: StreamOpts, owned: boolean): Promise<MicHandle> {
  const ctx = audioCtx()
  if (ctx.state === 'suspended') await ctx.resume()
  const src = ctx.createMediaStreamSource(stream)
  src.connect(getAnalyser()) // drives the voice orb (the analyser is never routed to the speakers for the mic)
  const rs = new Resampler(ctx.sampleRate, TARGET_SR)
  let acc: Float32Array[] = []
  let accLen = 0
  let lastLevel = 0

  const handle = (frame: Float32Array) => {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / Math.max(1, frame.length))
    const now = performance.now()
    if (now - lastLevel > 60) {
      lastLevel = now
      opts.onLevel(rms)
    }
    const out = rs.push(frame)
    if (out.length) {
      acc.push(out)
      accLen += out.length
    }
    if (accLen >= TARGET_SR * CHUNK_S) {
      const chunk = new Float32Array(accLen)
      let o = 0
      for (const a of acc) {
        chunk.set(a, o)
        o += a.length
      }
      acc = []
      accLen = 0
      opts.onChunk(chunk)
    }
  }

  let mode: MicHandle['mode'] = 'worklet'
  let node: AudioNode
  const sink = ctx.createGain()
  sink.gain.value = 0 // keep the graph pulling without playing the mic back
  sink.connect(ctx.destination)
  try {
    if (!ctx.audioWorklet) throw new Error('no worklet')
    if (!workletLoaded) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      workletLoaded = true
    }
    const w = new AudioWorkletNode(ctx, 'tw-tap')
    w.port.onmessage = (e) => handle(e.data as Float32Array)
    node = w
  } catch {
    mode = 'script-processor'
    const sp = ctx.createScriptProcessor(4096, 1, 1)
    sp.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)))
    node = sp
  }
  src.connect(node)
  node.connect(sink)
  if (ctx.state === 'suspended') await ctx.resume()

  return {
    mode,
    stop: () => {
      // flush the tail so the last words are not lost
      if (accLen > TARGET_SR * 0.3) {
        const chunk = new Float32Array(accLen)
        let o = 0
        for (const a of acc) {
          chunk.set(a, o)
          o += a.length
        }
        opts.onChunk(chunk)
      }
      acc = []
      accLen = 0
      try {
        src.disconnect()
        node.disconnect()
      } catch {
        /* already gone */
      }
      try {
        sink.disconnect()
      } catch {
        /* already gone */
      }
      if (owned) stream.getTracks().forEach((t) => t.stop())
      opts.onLevel(0)
    },
  }
}
