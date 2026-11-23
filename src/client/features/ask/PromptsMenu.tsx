import { Menu } from '@base-ui/react/menu'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Settings2, Sparkles } from 'lucide-react'
import { menuItem, menuPopup } from '~/client/features/player/SleepMenu'
import type { AskPromptChoice } from '~/shared/ask-prompts/prompts'
import { menuHeading } from './prompts'

export function PromptsMenu({
  prompts,
  hasQuote,
  onRun,
}: {
  prompts: readonly AskPromptChoice[]
  hasQuote: boolean
  onRun: (prompt: AskPromptChoice) => void
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        data-testid="ask-prompts-menu"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-r-line px-3.5 text-[13px] transition hover:border-r-accent/60 data-popup-open:border-r-accent"
      >
        <Sparkles className="size-3.5 text-r-muted" aria-hidden />
        Your prompts
        <ChevronDown className="size-3.5 text-r-muted" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-[100]">
          <Menu.Popup aria-label="Your prompts" className={menuPopup}>
            <Menu.Group>
              <Menu.GroupLabel className="px-3 pt-2 pb-1 text-[12px] font-semibold tracking-[0.08em] text-muted uppercase">
                {menuHeading(hasQuote)}
              </Menu.GroupLabel>
              {prompts.map((prompt) => (
                <Menu.Item
                  key={prompt.id}
                  closeOnClick
                  onClick={() => onRun(prompt)}
                  label={prompt.name}
                  className={`${menuItem} [overflow-wrap:anywhere]`}
                  data-testid="ask-prompt"
                  data-key={prompt.id}
                >
                  {prompt.name}
                </Menu.Item>
              ))}
            </Menu.Group>
            <Menu.Separator className="mx-1.5 my-1 border-t border-line" />
            <Menu.LinkItem
              closeOnClick
              render={<Link to="/account/prompts" />}
              className={`${menuItem} text-body`}
              data-testid="ask-prompts-manage"
            >
              <Settings2 className="size-4 shrink-0 text-muted" aria-hidden />
              Manage your prompts
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
