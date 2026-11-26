import { legalLink } from '~/client/components/LegalPage'

/** The link to Folio's code, from `SOURCE_URL`, or the plain words when it isn't set, so there's never a dead link. */
export function SourceLink({ sourceUrl, children }: { sourceUrl: string | null; children: string }) {
  if (!sourceUrl) return <>{children}</>
  return (
    <a href={sourceUrl} rel="noopener" className={legalLink} data-testid="legal-source-link">
      {children}
    </a>
  )
}
