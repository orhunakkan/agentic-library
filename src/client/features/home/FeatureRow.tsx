import type { ReactNode } from 'react'
import { cn } from '~/client/lib/cn'
import { HUE_CLASSES } from '~/client/lib/hue-classes'
import type { Hue } from '~/shared/content/hues'

interface Props {
  hue: Hue
  label: string
  title: string
  children: ReactNode
  preview: ReactNode
}

export function FeatureRow({ hue, label, title, children, preview }: Props) {
  const hueClass = HUE_CLASSES[hue]
  return (
    <article className="grid items-center gap-8 border-t border-line-soft py-12 md:grid-cols-2 md:gap-14 md:py-16">
      <div>
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          <span aria-hidden="true" className={cn('size-2.5 rounded-full', hueClass.dot)} />
          <span className={hueClass.ink}>{label}</span>
        </p>
        <h3 className="mt-3 font-display text-[28px] leading-tight font-bold tracking-tight text-ink sm:text-[34px]">
          {title}
        </h3>
        <div className="mt-4 flex max-w-[480px] flex-col gap-3 text-[17px] leading-relaxed text-body">{children}</div>
      </div>
      <div aria-hidden="true" className="min-w-0">
        {preview}
      </div>
    </article>
  )
}
