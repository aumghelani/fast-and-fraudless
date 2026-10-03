// Keyboard shortcut sheet (?). Closes on Esc, ? or a click anywhere.
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../lib/store'
import { setHelp } from '../flow/story'
import { Eyebrow, Kbd } from '../ui/primitives'
import { DUR, EASE } from '../ui/tokens'

const ROWS: [string[], string][] = [
  [['←', '→'], 'Previous or next scene'],
  [['1', '6'], 'Jump to a scene · Home and End for first and last'],
  [['⇧1'], 'Replay Margaret’s call'],
  [['⇧2'], 'Replay David’s call'],
  [['M'], 'Microphone call on or off (Watching and Call)'],
  [['E'], 'Leak test: the sandboxed agent tries to send data out'],
  [['A'], 'Auto-advance on or off'],
  [['D'], 'Details for this scene'],
  [['Esc'], 'Close the drawer or this sheet'],
]

export function ShortcutSheet() {
  const open = useStore((s) => s.story.help)
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="help"
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: DUR.fast } }}
          exit={{ opacity: 0, transition: { duration: DUR.fast } }}
          onClick={() => setHelp(false)}
        >
          <motion.div
            role="dialog"
            aria-label="Keyboard shortcuts"
            className="w-160 rounded-xl border border-line bg-surface p-8"
            initial={{ y: 12 }}
            animate={{ y: 0, transition: { duration: DUR.base, ease: EASE } }}
          >
            <Eyebrow className="mb-6">Keyboard</Eyebrow>
            <div className="grid grid-cols-[8rem_1fr] gap-x-6 gap-y-4 text-body">
              {ROWS.map(([keys, what]) => (
                <div key={what} className="contents">
                  <div className="flex items-center gap-1.5 text-ink-2">
                    {keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-meta text-mute">{keys.length === 2 && k === '6' ? '-' : '/'}</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </div>
                  <div className="text-ink-2">{what}</div>
                </div>
              ))}
            </div>
            <p className="mt-8 text-meta text-mute">Hold, Release, Approve and Reject are mouse only.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
