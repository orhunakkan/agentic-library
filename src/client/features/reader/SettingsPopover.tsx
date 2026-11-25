import { Popover } from '@base-ui/react/popover'
import { BookOpen, Minus, Plus, ScrollText } from 'lucide-react'
import { useId } from 'react'
import { cn } from '~/client/lib/cn'
import type { Tone } from '~/shared/content/schema'
import {
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_OPTIONS as FONTS,
  LAYOUT_OPTIONS as LAYOUTS,
  LEADING_OPTIONS as LEADINGS,
  type Measure,
  type ReaderPrefs,
  stepFontSize,
  THEME_OPTIONS as THEMES,
} from './prefs'

interface Props {
  tone: Tone
  prefs: ReaderPrefs
  update: (patch: Partial<ReaderPrefs>) => void
  showPanel: boolean
  syncs: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: () => void
  trigger: React.ReactElement
}

const MEASURES: { value: Measure; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
]

export function SettingsPopover({
  tone,
  prefs,
  update,
  showPanel,
  syncs,
  open,
  onOpenChange,
  onClosed,
  trigger,
}: Props) {
  const sizeIndex = FONT_SIZES.indexOf(prefs.fontSize as never)
  return (
    <Popover.Root
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed?.()
      }}
    >
      <Popover.Trigger render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={10} collisionPadding={12} className="z-[70]">
          <Popover.Popup
            data-tone={tone}
            data-testid="reader-settings-popover"
            aria-modal="true"
            className="max-h-[var(--available-height)] w-[min(328px,calc(100vw-24px))] origin-[var(--transform-origin)] overflow-y-auto overscroll-contain rounded-2xl border border-r-line bg-r-paper p-5 font-sans text-r-ink shadow-[0_30px_70px_-24px_rgba(9,13,27,.45)] transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <Popover.Title className="sr-only">Reading settings</Popover.Title>

            <RadioGroup
              label="Theme"
              name="reader-theme"
              testId="reader-settings-theme"
              options={THEMES}
              value={prefs.theme}
              onChange={(theme) => update({ theme })}
            >
              {(theme) => (
                <>
                  <span
                    className={cn(
                      'grid size-9 place-items-center rounded-full border font-serif text-[15px]',
                      theme.swatch,
                    )}
                    aria-hidden
                  >
                    Aa
                  </span>
                  <span className="text-[12.5px]">{theme.label}</span>
                </>
              )}
            </RadioGroup>

            <RadioGroup
              label="Font"
              name="reader-font"
              testId="reader-settings-font"
              options={FONTS}
              value={prefs.font}
              onChange={(font) => update({ font })}
              columns={2}
            >
              {(f) => (
                <span className="text-center text-[14px] leading-tight" style={{ fontFamily: FONT_FAMILIES[f.value] }}>
                  {f.label}
                </span>
              )}
            </RadioGroup>

            <Group label="Font size">
              {() => (
                <div className="flex items-center gap-3">
                  <StepButton
                    label="Decrease font size"
                    testId="reader-settings-font-smaller"
                    disabled={sizeIndex <= 0}
                    onClick={() => update({ fontSize: stepFontSize(prefs.fontSize, -1) })}
                  >
                    <Minus className="size-4" />
                    <span className="font-serif text-[13px]">A</span>
                  </StepButton>
                  <div className="flex flex-1 items-center gap-1" aria-hidden>
                    {FONT_SIZES.map((size, i) => (
                      <span
                        key={size}
                        className={cn(
                          'h-1 flex-1 rounded-full transition',
                          i <= sizeIndex ? 'bg-r-accent' : 'bg-r-line',
                        )}
                      />
                    ))}
                  </div>
                  <StepButton
                    label="Increase font size"
                    testId="reader-settings-font-larger"
                    disabled={sizeIndex >= FONT_SIZES.length - 1}
                    onClick={() => update({ fontSize: stepFontSize(prefs.fontSize, 1) })}
                  >
                    <span className="font-serif text-[17px]">A</span>
                    <Plus className="size-4" />
                  </StepButton>
                  <span className="sr-only" aria-live="polite" data-testid="reader-settings-font-size">
                    Font size {prefs.fontSize} pixels
                  </span>
                </div>
              )}
            </Group>

            <RadioGroup
              label="Line spacing"
              name="reader-leading"
              testId="reader-settings-line-spacing"
              options={LEADINGS}
              value={prefs.leading}
              onChange={(leading) => update({ leading })}
            >
              {(l) => <span className="text-[13px]">{l.label}</span>}
            </RadioGroup>

            <RadioGroup
              label="Page width"
              name="reader-measure"
              testId="reader-settings-page-width"
              options={MEASURES}
              value={prefs.measure}
              onChange={(measure) => update({ measure })}
            >
              {(m) => <span className="text-[13px]">{m.label}</span>}
            </RadioGroup>

            <RadioGroup
              label="Reading mode"
              name="reader-layout"
              testId="reader-settings-mode"
              options={LAYOUTS}
              value={prefs.layout}
              onChange={(layout) => update({ layout })}
              columns={2}
              last={!showPanel}
            >
              {(layout) => (
                <>
                  {layout.value === 'pages' ? (
                    <BookOpen className="size-5" aria-hidden />
                  ) : (
                    <ScrollText className="size-5" aria-hidden />
                  )}
                  <span className="text-[13px]">{layout.label}</span>
                </>
              )}
            </RadioGroup>

            {showPanel && (
              <Group label="Panel" last>
                {() => (
                  <button
                    type="button"
                    data-testid="reader-settings-panel"
                    aria-pressed={!prefs.sidebarHidden}
                    onClick={() => update({ sidebarHidden: !prefs.sidebarHidden })}
                    className="flex w-full items-center justify-between rounded-xl border border-r-line px-3.5 py-2.5 text-[13.5px] transition hover:border-r-accent/50"
                  >
                    Contents panel
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
                        prefs.sidebarHidden ? 'bg-r-line text-r-muted' : 'bg-r-accent text-r-paper',
                      )}
                    >
                      {prefs.sidebarHidden ? 'Off' : 'On'}
                    </span>
                  </button>
                )}
              </Group>
            )}

            {syncs && (
              <p className="mt-5 border-t border-r-line pt-3 text-[13px] leading-snug text-r-muted">
                Theme, font, line spacing and page width follow you to your other devices.
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Group({
  label,
  children,
  last,
}: {
  label: string
  children: (labelId: string) => React.ReactNode
  last?: boolean
}) {
  const id = useId()
  return (
    <div className={cn(!last && 'mb-5')}>
      <p id={id} className="mb-2 text-[11px] font-bold tracking-[0.12em] text-r-muted uppercase">
        {label}
      </p>
      {children(id)}
    </div>
  )
}

function RadioGroup<V extends string, O extends { value: V; label: string }>({
  label,
  name,
  testId,
  options,
  value,
  onChange,
  columns = 3,
  last,
  children,
}: {
  label: string
  name: string
  testId: string
  options: readonly O[]
  value: V
  onChange: (value: V) => void
  columns?: 2 | 3
  last?: boolean
  children: (option: O) => React.ReactNode
}) {
  return (
    <Group label={label} last={last}>
      {(labelId) => (
        <div
          role="radiogroup"
          data-testid={testId}
          aria-labelledby={labelId}
          className={cn('grid gap-2', columns === 2 ? 'grid-cols-2' : 'grid-cols-3')}
        >
          {options.map((option) => (
            <RadioTile
              key={option.value}
              name={name}
              testId={`${testId}-option`}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            >
              {children(option)}
            </RadioTile>
          ))}
        </div>
      )}
    </Group>
  )
}

function RadioTile({
  name,
  testId,
  value,
  checked,
  onChange,
  children,
}: {
  name: string
  testId: string
  value: string
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-r-accent',
        checked ? 'border-r-accent bg-r-accent text-r-paper' : 'border-r-line hover:border-r-accent/50',
      )}
    >
      <input
        type="radio"
        name={name}
        data-testid={testId}
        data-key={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {children}
    </label>
  )
}

function StepButton({
  label,
  testId,
  disabled,
  onClick,
  children,
}: {
  label: string
  testId: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 items-center gap-0.5 rounded-xl border border-r-line px-2.5 transition hover:border-r-accent/50 disabled:opacity-35"
    >
      {children}
    </button>
  )
}
