// In-app phone line (WebRTC). The box relays only the offer and answer; the voices go browser to browser.

export interface Line {
  state: 'idle' | 'ringing' | 'connected'
  id?: string
  name?: string
  offer?: string
  answer?: string
}

async function j<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

export const line = {
  state: () => j<Line>('/api/rtc/state'),
  call: (sdp: string, name: string) => j<{ id: string }>('/api/rtc/call', { sdp, name }),
  answer: (id: string, sdp: string) => j<{ ok: boolean }>('/api/rtc/answer', { id, sdp }),
  hangup: (id?: string) => j<{ ok: boolean }>('/api/rtc/hangup', { id }),
}

/** Same network, so no relay servers: the laptops reach each other directly. */
export const newPeer = () => new RTCPeerConnection({ iceServers: [] })

/** Wait until the description carries its network candidates (one exchange instead of a stream of them). */
export function gathered(pc: RTCPeerConnection, maxMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((res) => {
    const t = setTimeout(res, maxMs)
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t)
        res()
      }
    })
  })
}

/** The microphone, with echo cancellation so the other side does not hear itself. */
export async function phoneMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure')
  return navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
}
