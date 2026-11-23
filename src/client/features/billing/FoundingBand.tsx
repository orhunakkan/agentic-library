import { Sparkles } from 'lucide-react'
import { foundingBand } from '~/shared/billing/copy'

export function FoundingBand({ left }: { left: number }) {
  const band = foundingBand(left)
  if (!band) return null
  return (
    <p
      data-testid="founding-band"
      className="mt-8 flex items-start gap-3 rounded-2xl border border-accent-line bg-accent/10 px-5 py-4 text-[16px] text-ink"
    >
      <Sparkles aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
      <span>
        <strong className="font-semibold">{band.strong}</strong>
        {band.rest}
      </span>
    </p>
  )
}
