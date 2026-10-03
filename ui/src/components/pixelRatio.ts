// Browser zoom changes devicePixelRatio without always resizing elements; WebGL canvases must react to both.
export function watchPixelRatio(onChange: () => void): () => void {
  let mq: MediaQueryList | null = null
  const fire = () => {
    onChange()
    listen()
  }
  const listen = () => {
    mq?.removeEventListener('change', fire)
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mq.addEventListener('change', fire)
  }
  listen()
  window.addEventListener('resize', onChange)
  return () => {
    mq?.removeEventListener('change', fire)
    window.removeEventListener('resize', onChange)
  }
}
