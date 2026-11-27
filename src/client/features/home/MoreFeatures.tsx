import {
  BookA,
  Fingerprint,
  Flame,
  FolderGit2,
  Library,
  type LucideIcon,
  MonitorDown,
  MonitorSmartphone,
  SquareTerminal,
  WifiOff,
} from 'lucide-react'
import { cn } from '~/client/lib/cn'
import { HUE_CLASSES } from '~/client/lib/hue-classes'
import type { Hue } from '~/shared/content/hues'

interface Tile {
  icon: LucideIcon
  hue: Hue
  title: string
  text: string
}

/** The smaller features, each in one line. Every one needs an account except installing the app. */
const TILES: readonly Tile[] = [
  {
    icon: BookA,
    hue: 'violet',
    title: 'Look up any word',
    text: 'See it in Wiktionary and Wikipedia, or have the AI translate it or explain it in context.',
  },
  {
    icon: SquareTerminal,
    hue: 'cyan',
    title: 'Run the code in a book',
    text: 'JavaScript, TypeScript, Python and SQL code blocks run in your browser.',
  },
  {
    icon: FolderGit2,
    hue: 'lime',
    title: 'Read GitHub repositories',
    text: 'Browse public repositories as they were at the last refresh. Folio never changes anything on GitHub.',
  },
  {
    icon: Flame,
    hue: 'amber',
    title: 'Reading goals and streaks',
    text: 'Set a daily goal, keep your streak going, and see the books you finished this year.',
  },
  {
    icon: Library,
    hue: 'pink',
    title: 'Shelves and ratings',
    text: 'Sort your books onto shelves of your own, and rate them.',
  },
  {
    icon: WifiOff,
    hue: 'coral',
    title: 'Read offline',
    text: 'Download a book to read it without a connection.',
  },
  {
    icon: MonitorDown,
    hue: 'cyan',
    title: 'Install it as an app',
    text: 'Add Folio to your home screen or desktop. No account needed.',
  },
  {
    icon: MonitorSmartphone,
    hue: 'violet',
    title: 'Pick up on any device',
    text: 'Open a book on another device, and Folio offers the place you reached.',
  },
  {
    icon: Fingerprint,
    hue: 'amber',
    title: 'Sign in with a passkey',
    text: 'Use your fingerprint, face or device PIN, with no password to type.',
  },
]

export function MoreFeatures() {
  return (
    <section aria-labelledby="more-features-title" className="mt-20">
      <h2
        id="more-features-title"
        className="font-display text-[30px] leading-tight font-bold tracking-tight text-ink sm:text-[40px]"
      >
        And everything around the reading.
      </h2>
      <p className="mt-3 text-[17px] leading-relaxed text-body">With an account, except installing Folio as an app.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map(({ icon: Icon, hue, title, text }) => (
          <li key={title} className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <span
              aria-hidden="true"
              className={cn('grid size-10 place-items-center rounded-xl border', HUE_CLASSES[hue].tint)}
            >
              <Icon className={cn('size-5', HUE_CLASSES[hue].ink)} />
            </span>
            <h3 className="mt-4 font-display text-[19px] leading-snug font-bold text-ink">{title}</h3>
            <p className="mt-1.5 text-[15.5px] leading-relaxed text-body">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
