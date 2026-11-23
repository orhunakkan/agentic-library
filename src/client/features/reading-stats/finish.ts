import { setFinished } from './stats-client'
import { finishedToast } from './stats-copy'

const noted = new Set<string>()

export async function noteFinished(
  book: string,
  title: string,
  { signedIn, toast }: { signedIn: boolean; toast: (message: string) => void },
): Promise<void> {
  if (!signedIn || noted.has(book)) return
  if (document.documentElement.dataset.embed === 'on' || !navigator.onLine) return
  noted.add(book)
  const result = await setFinished(book, true)
  if (!result.ok) {
    noted.delete(book)
    return
  }
  if (result.value.added) toast(finishedToast(title))
}

export const forgetFinished = (book: string) => void noted.delete(book)
