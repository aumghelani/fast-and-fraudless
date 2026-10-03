// REST calls from the README contract. All paths are relative (dev: Vite proxy, prod: served by the backend).

async function post<T = any>(path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: raw ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const text = await r.text()
  let data: any = text
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    /* plain text */
  }
  if (!r.ok) {
    const msg = (data && (data.detail || data.error)) || text || r.statusText
    throw new Error(`${r.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }
  return data as T
}

export const api = {
  startCall: (scenario?: string, name?: string) =>
    post<{ call_id: string }>('/api/calls/start', { ...(scenario ? { scenario } : {}), ...(name ? { name } : {}) }),
  sendAudio: (id: string, pcm: Float32Array) => {
    // raw little-endian float32 (every browser we target is little-endian; enforce anyway)
    const buf = new ArrayBuffer(pcm.length * 4)
    const view = new DataView(buf)
    for (let i = 0; i < pcm.length; i++) view.setFloat32(i * 4, pcm[i], true)
    return post(`/api/calls/${id}/audio`, undefined, buf)
  },
  replay: (id: string, clip: string) => post<{ audio_url?: string }>(`/api/calls/${id}/replay`, { clip }),
  endCall: (id: string) => post(`/api/calls/${id}/end`, {}),
  callDecision: (id: string, decision: 'hold' | 'release') => post(`/api/calls/${id}/decision`, { decision }),
  sarDecision: (sarId: string, decision: 'approve' | 'reject') =>
    post(`/api/sar/${encodeURIComponent(sarId)}/decision`, { decision }),
  exfil: () => post<{ blocked?: boolean | null; exit?: number | null; error?: string; stderr?: string[] }>(
    '/api/demo/exfil', {}),
}
