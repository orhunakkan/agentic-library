import type { ReactNode } from 'react'
import type { SiteContact } from '~/server/config'
import { SITE_NAME, shortDate } from '~/shared/lib/site'

export const legalLink = 'font-medium text-accent underline-offset-2 hover:underline'

export function LegalPage({
  title,
  titleTestId,
  lead,
  updated,
  children,
}: {
  title: string
  titleTestId: string
  lead: string
  updated: string
  children: ReactNode
}) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-[720px] px-4 pt-12 md:px-8 md:pt-16"
      style={{ paddingBottom: 'calc(96px + var(--player-h))' }}
    >
      <p className="eyebrow text-accent">{SITE_NAME}</p>
      <h1
        className="mt-3 font-display text-[clamp(34px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.03em] text-ink"
        data-testid={titleTestId}
      >
        {title}
      </h1>
      <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-muted">
        {lead} Last updated <time dateTime={updated}>{shortDate(updated)}</time>.
      </p>
      {children}
    </main>
  )
}

export function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[16px] leading-relaxed text-ink">{children}</div>
    </section>
  )
}

export function Contact({ contact }: { contact: SiteContact | null }) {
  if (contact?.kind === 'email')
    return (
      <a href={`mailto:${contact.value}`} className={legalLink} data-testid="legal-contact">
        {contact.value}
      </a>
    )
  if (contact?.kind === 'url')
    return (
      <a href={contact.value} className={legalLink} rel="noopener" data-testid="legal-contact">
        {contact.value}
      </a>
    )
  return <>ask the site’s owner</>
}
