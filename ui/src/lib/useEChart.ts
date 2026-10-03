import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

/** Mount an ECharts instance on a div and keep it in sync with `option` and the container size. */
export function useEChart(option: EChartsOption, deps: unknown[]) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: false, lazyUpdate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}
