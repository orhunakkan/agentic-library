import { Menu } from '@base-ui/react/menu'
import { Check, Moon } from 'lucide-react'
import { pill } from './PlayerFrames'
import { usePlayer } from './PlayerProvider'
import { choiceLabel, label, type Part, SLEEP_CHOICES, type SleepChoice } from './sleep'

export const menuPopup =
  'max-h-[var(--available-height)] w-[min(320px,calc(100vw-24px))] origin-[var(--transform-origin)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-1.5 text-ink shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)] outline-none transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0'

export const menuItem =
  'flex min-h-11 cursor-default items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] outline-none select-none data-highlighted:bg-panel'

export function SleepMenu({ part }: { part: Part }) {
  const { sleep, sleepChoice, setSleep } = usePlayer()
  return (
    <Menu.Root>
      <Menu.Trigger className={pill} data-testid="player-sleep">
        <Moon className="size-4" aria-hidden />
        {label(sleep, part) ?? 'Sleep timer'}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-[100]">
          <Menu.Popup aria-label="Sleep timer" className={menuPopup}>
            <Menu.RadioGroup value={sleepChoice} onValueChange={(value: SleepChoice) => setSleep(value)}>
              {SLEEP_CHOICES.map((choice) => (
                <Menu.RadioItem
                  key={String(choice)}
                  value={choice}
                  closeOnClick
                  className={menuItem}
                  data-testid="player-sleep-choice"
                  data-key={String(choice)}
                >
                  <span className="grid size-4 place-items-center">
                    <Menu.RadioItemIndicator>
                      <Check className="size-4 text-accent" aria-hidden />
                    </Menu.RadioItemIndicator>
                  </span>
                  {choiceLabel(choice, part)}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
