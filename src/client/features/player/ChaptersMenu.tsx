import { Menu } from '@base-ui/react/menu'
import { Check, ListOrdered } from 'lucide-react'
import { useCallback } from 'react'
import { partsOf } from './now-playing'
import { pill } from './PlayerFrames'
import { usePlayer } from './PlayerProvider'
import { menuItem, menuPopup } from './SleepMenu'

const chaptersPopup = menuPopup.replace(
  'max-h-[var(--available-height)]',
  'max-h-[min(60vh,480px,var(--available-height))]',
)

export function ChaptersMenu() {
  const player = usePlayer()
  const { items, current } = partsOf(player.now)

  const popupRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const frame = window.requestAnimationFrame(() =>
      el.querySelector('[data-checked]')?.scrollIntoView({ block: 'nearest' }),
    )
    return () => window.cancelAnimationFrame(frame)
  }, [])

  if (items.length === 0) return null
  return (
    <Menu.Root>
      <Menu.Trigger className={pill} data-testid="player-chapters">
        <ListOrdered className="size-4" aria-hidden />
        Chapters
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-[100]">
          <Menu.Popup ref={popupRef} aria-label="Chapters" className={chaptersPopup}>
            <Menu.RadioGroup value={current} onValueChange={(value: string) => player.toPart(value)}>
              {items.map((item) => (
                <Menu.RadioItem
                  key={item.value}
                  value={item.value}
                  closeOnClick
                  label={item.label}
                  className={menuItem}
                  data-testid="player-chapter"
                  data-key={item.value}
                >
                  <span className="grid size-4 shrink-0 place-items-center self-start pt-1">
                    <Menu.RadioItemIndicator>
                      <Check className="size-4 text-accent" aria-hidden />
                    </Menu.RadioItemIndicator>
                  </span>
                  <span className="min-w-0">{item.label}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
