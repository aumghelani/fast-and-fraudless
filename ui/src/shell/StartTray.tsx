// Start a call from this screen: two replays and the microphone.
import { useCtl } from '../flow/CtlProvider'
import { cx } from '../lib/format'
import { Button } from '../ui/primitives'

export function StartTray({ compact }: { compact?: boolean }) {
  const ctl = useCtl()
  const busy = ctl.mode === 'starting'
  return (
    <div className={cx('flex flex-wrap items-center', compact ? 'gap-2' : 'gap-3')}>
      <Button variant="ghost" kbd="⇧1" disabled={busy} onClick={() => ctl.replay('CALL-01')}>
        Margaret · replay
      </Button>
      <Button variant="ghost" kbd="⇧2" disabled={busy} onClick={() => ctl.replay('CALL-02')}>
        David · replay
      </Button>
      <Button variant="ghost" kbd="M" disabled={busy} onClick={ctl.toggleMic}>
        {ctl.mode === 'mic' ? 'Stop microphone' : 'Microphone'}
      </Button>
    </div>
  )
}
