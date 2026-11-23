import { Menu } from '@base-ui/react/menu'
import { Ellipsis } from 'lucide-react'
import { menuItem, menuPopup } from '~/client/features/player/SleepMenu'
import { cn } from '~/client/lib/cn'
import type { RowAction } from '~/shared/admin/users'
import { ACTION_LABELS } from './admin-client'

export function UserActionsMenu({
  username,
  actions,
  busy,
  onChoose,
}: {
  username: string
  actions: readonly RowAction[]
  busy: boolean
  onChoose: (action: RowAction) => void
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        data-testid="user-actions"
        data-key={username}
        aria-label={`Actions for ${username}`}
        aria-busy={busy || undefined}
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-panel hover:text-ink aria-busy:opacity-60 data-popup-open:bg-panel data-popup-open:text-ink"
      >
        <Ellipsis className="size-5" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-[100]">
          <Menu.Popup
            aria-label={`Actions for ${username}`}
            className={cn(menuPopup, 'w-[min(240px,calc(100vw-24px))]')}
          >
            {actions.map((action) => (
              <Menu.Item
                key={action}
                data-testid="user-action"
                data-key={action}
                disabled={busy}
                onClick={() => onChoose(action)}
                className={cn(menuItem, action === 'delete' && 'text-red-700 dark:text-red-300')}
              >
                {ACTION_LABELS[action]}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
