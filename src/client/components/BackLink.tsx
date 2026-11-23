import { ArrowLeft } from 'lucide-react'
import { AppLink } from './AppLink'

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <AppLink
      href={href}
      data-testid="back-link"
      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-[15px] font-medium text-muted transition hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </AppLink>
  )
}
