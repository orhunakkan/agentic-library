import { BookmarkPlus } from 'lucide-react'
import { useAudioBookmarks, useSignedIn } from '~/client/features/bookmarks/use-audio-bookmarks'
import { momentOf } from './now-playing'
import { dockButton, pill } from './PlayerFrames'
import { usePlayer } from './PlayerProvider'

export function BookmarkMomentButton({ variant, book }: { variant: 'dock' | 'sheet'; book: string }) {
  const player = usePlayer()
  const signedIn = useSignedIn()
  const bookmarks = useAudioBookmarks(book)
  const moment = momentOf(player.now)
  const press = () => {
    if (!signedIn) {
      player.setFocusBookmarks(true)
      player.setExpanded(true)
      return
    }
    if (moment) bookmarks.add(moment)
  }
  if (variant === 'dock') {
    return (
      <button
        type="button"
        onClick={press}
        aria-label="Bookmark this moment"
        title="Bookmark this moment"
        className={dockButton}
        data-testid="player-bookmark-moment"
      >
        <BookmarkPlus className="size-5" aria-hidden />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={press}
      aria-label="Bookmark this moment"
      className={pill}
      data-testid="player-bookmark-moment"
    >
      <BookmarkPlus className="size-4" aria-hidden />
      Bookmark
    </button>
  )
}
