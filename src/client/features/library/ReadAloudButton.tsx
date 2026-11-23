import { AudioLines, Pause } from 'lucide-react'
import { usePlayer } from '~/client/features/player/PlayerProvider'

export function ReadAloudButton({ slug }: { slug: string }) {
  const { readAloud } = usePlayer()
  if (!readAloud.supported) return null
  const reading = readAloud.book?.slug === slug
  const playing = reading && (readAloud.status === 'playing' || readAloud.status === 'loading')
  return (
    <button
      type="button"
      data-testid="book-read-aloud"
      onClick={() => (reading ? readAloud.toggle() : readAloud.start(slug, { kind: 'saved' }))}
      className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-panel active:scale-[.98]"
    >
      {playing ? <Pause className="size-4" aria-hidden /> : <AudioLines className="size-[18px]" aria-hidden />}
      {playing ? 'Pause reading' : 'Read aloud'}
    </button>
  )
}
