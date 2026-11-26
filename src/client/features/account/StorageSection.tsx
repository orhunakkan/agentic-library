import type { AccountStorage } from '~/shared/limits/limits'
import { OVER_LIMIT_TEXT, STORAGE_INTRO, storageLines } from './storage-text'
import { Section } from './ui'

export function StorageSection({ storage }: { storage: AccountStorage }) {
  return (
    <Section id="storage" title="Storage">
      <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted">{STORAGE_INTRO}</p>
      <ul className="mt-5 space-y-5">
        {storageLines(storage).map((line) => (
          <li key={line.key} className="space-y-1.5" data-testid={`account-storage-${line.key}`}>
            <p id={`storage-${line.key}`} className="text-[14.5px] text-ink">
              <span className="font-medium">{line.label}:</span> {line.text}
            </p>
            <meter
              aria-labelledby={`storage-${line.key}`}
              min={0}
              max={line.max}
              value={line.value}
              className="h-2 w-full max-w-[360px]"
            />
            {line.over && <p className="text-[13.5px] font-medium text-ink">{OVER_LIMIT_TEXT}</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}
