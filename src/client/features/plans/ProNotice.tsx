import { proNotice } from '~/shared/plans/copy'
import { PRO_LINK, type ProFeature } from '~/shared/plans/plans'

export function SeeProLink({ className }: { className?: string }) {
  return (
    <a
      href={PRO_LINK}
      data-testid="pro-see-pro"
      className={className ?? 'font-semibold text-accent underline-offset-2 hover:underline'}
    >
      See Pro
    </a>
  )
}

export function ProNotice({
  feature,
  compact = false,
  className,
  linkClassName,
}: {
  feature: ProFeature
  compact?: boolean
  className?: string
  linkClassName?: string
}) {
  const { heading, sentence } = proNotice(feature)
  if (compact) {
    return (
      <p className={className ?? 'text-[14px]'} data-pro-notice={feature} data-testid="pro-notice" data-key={feature}>
        {heading} <SeeProLink className={linkClassName} />
      </p>
    )
  }
  return (
    <div
      className={className ?? 'space-y-2 text-[14.5px] leading-relaxed'}
      data-pro-notice={feature}
      data-testid="pro-notice"
      data-key={feature}
    >
      <p className="font-semibold">{heading}</p>
      <p>{sentence}</p>
      <p>
        <SeeProLink className={linkClassName} />
      </p>
    </div>
  )
}
