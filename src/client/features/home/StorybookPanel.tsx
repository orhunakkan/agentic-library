import { cn } from '~/client/lib/cn'
import { HUE_CLASSES } from '~/client/lib/hue-classes'

export function StorybookPanel() {
  return (
    <section
      aria-labelledby="storybook-title"
      className={cn('mt-20 rounded-2xl border px-6 py-10 text-center sm:px-12 sm:py-14', HUE_CLASSES.pink.tint)}
    >
      <p
        className={cn(
          'mx-auto inline-flex rounded-full bg-surface px-3 py-1 text-[13px] font-semibold',
          HUE_CLASSES.pink.ink,
        )}
      >
        In the works
      </p>
      <h2
        id="storybook-title"
        className="mt-4 font-display text-[30px] leading-tight font-bold tracking-tight text-ink sm:text-[40px]"
      >
        Storybook, for bedtime.
      </h2>
      <p className="mx-auto mt-4 max-w-[560px] text-[17px] leading-relaxed text-body">
        Classic children’s stories with a picture on every page, read aloud with each sentence marked, so little ones
        can follow along.
      </p>
    </section>
  )
}
