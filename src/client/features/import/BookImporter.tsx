import { ChevronLeft, ChevronRight, Eye, FileUp, LoaderCircle, Merge, Trash2 } from 'lucide-react'
import {
  type DragEvent,
  type FormEvent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Notice, TextField } from '~/client/features/account/ui'
import { problem, problemText } from '~/client/features/audiobook-import/audiobook-problems'
import { CoverChooser, coverSourceText, IMAGE_PROBLEM_TEXT } from '~/client/features/book-details/CoverChooser'
import { drawCover } from '~/client/features/book-details/cover-image'
import { cn } from '~/client/lib/cn'
import { privateCover } from '~/shared/content/private-book'
import type { BookBlock, DraftBook, DraftChapter, ImageBlock } from '~/shared/import/blocks'
import {
  BOOK_ROOM,
  chapterWords,
  dropChapter,
  ImportError,
  LEFT_OUT_REASONS,
  type LeftOutReason,
  mergeIntoPrevious,
  openBook,
  type PicturePlan,
  type PictureState,
  planPictures,
  previewPages,
  renameChapter,
  saveableChapters,
  sourceKind,
} from '~/shared/import/draft'
import { isBadIsbn } from '~/shared/import/isbn'
import { DESCRIPTION_MAX, MAX_BOOK_IMAGES, MAX_SOURCE_BYTES, MB, PUBLISHER_MAX } from '~/shared/import/limits'
import type { PdfOverrides } from '~/shared/import/pdf/types'
import type { RenderContext } from '~/shared/import/render'
import { formatBytes } from '~/shared/lib/format-bytes'
import type { InstanceLimits } from '~/shared/limits/limits'
import { BOOK_STEPS } from './import-client'
import { BAD_ISBN, importSaveText, PICTURE_FAILED, SAVE_FAILED } from './import-problems'
import { latestPick, type PickToken } from './latest-pick'
import { PdfReading } from './PdfReading'
import type { PdfBook, PdfProgress, PdfRead } from './pdf-open'
import { plural } from './pdf-reading'
import { pickerAccept, pickRefusal, routePick } from './pick'
import { drawPicture } from './picture-draw'
import {
  type CoverFrom,
  type CoverRefusal,
  keptPictures,
  type SaveProgress,
  savePrivateBook,
} from './private-book-save'

const AudiobookImporter = lazy(() =>
  import('~/client/features/audiobook-import/AudiobookImporter').then((m) => ({ default: m.AudiobookImporter })),
)

export interface ReviewCover {
  blob: Blob
  width: number
  height: number
  from: CoverFrom
}

interface PdfReview {
  book: PdfBook
  read: Omit<PdfRead, 'draft'>
  edited: boolean
  rereading: boolean
  run: number
}

type Stage =
  | { kind: 'pick'; error?: string }
  | { kind: 'audio'; files: File[] }
  | { kind: 'reading'; fileName: string; progress?: PdfProgress; cancel?: () => void }
  | { kind: 'review'; draft: DraftBook; fileName: string; error?: string; pdf?: PdfReview }
  | { kind: 'saving'; draft: DraftBook; fileName: string; progress: SaveProgress; pdf?: PdfReview }

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

interface ReviewPicture {
  state: PictureState
  blob?: Blob
  url?: string
}

export function BookImporter({
  imageBytesUsed,
  audiobooks = false,
  audioBytesUsed = 0,
  bookCount = 0,
  limits,
  onImported,
}: {
  imageBytesUsed: number
  bookCount?: number
  limits: InstanceLimits
  audiobooks?: boolean
  audioBytesUsed?: number
  onImported: (id: string, coverRefusal?: CoverRefusal) => Promise<void>
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'pick' })
  const backToPicker = useCallback((error?: string) => setStage({ kind: 'pick', error }), [])
  const [picks] = useState(latestPick)

  const pdfBook = stage.kind === 'review' || stage.kind === 'saving' ? stage.pdf?.book : undefined
  const openPdfBook = useRef<PdfBook | undefined>(undefined)
  useEffect(() => {
    if (openPdfBook.current !== pdfBook) openPdfBook.current?.close()
    openPdfBook.current = pdfBook
  }, [pdfBook])
  useEffect(() => () => openPdfBook.current?.close(), [])

  async function read(file: File) {
    const pick = picks.start()
    if (file.size > MAX_SOURCE_BYTES) {
      setStage({ kind: 'pick', error: `The file is larger than ${MAX_SOURCE_BYTES / MB} MB.` })
      return
    }
    try {
      if (sourceKind(file.name) === 'pdf') {
        await readPdf(file, pick)
        return
      }
      setStage({ kind: 'reading', fileName: file.name })
      const draft = await openBook(file.name, new Uint8Array(await file.arrayBuffer()))
      if (picks.isCurrent(pick)) setStage({ kind: 'review', draft, fileName: file.name })
    } catch (error) {
      if (!picks.isCurrent(pick)) return
      if (isAbort(error)) return setStage({ kind: 'pick' })
      setStage({ kind: 'pick', error: error instanceof ImportError ? error.message : 'This file couldn’t be read.' })
    }
  }

  async function readPdf(file: File, pick: PickToken) {
    const controller = new AbortController()
    const cancel = () => {
      controller.abort()
      picks.invalidate()
      setStage({ kind: 'pick' })
    }
    setStage({ kind: 'reading', fileName: file.name, cancel })
    const { openPdf } = await import('./pdf-open')
    const book = await openPdf(file.name, new Uint8Array(await file.arrayBuffer()), {
      signal: controller.signal,
      onProgress: (progress) => {
        if (picks.isCurrent(pick)) setStage({ kind: 'reading', fileName: file.name, progress, cancel })
      },
    })
    if (!picks.isCurrent(pick)) {
      book.close()
      return
    }
    const { draft, styles, report, overrides } = book
    setStage({
      kind: 'review',
      draft,
      fileName: file.name,
      pdf: { book, read: { styles, report, overrides }, edited: false, rereading: false, run: 0 },
    })
  }

  async function reread(pdf: PdfReview, overrides: PdfOverrides) {
    const pick = picks.current()
    const current = (s: Stage): s is Extract<Stage, { kind: 'review' }> =>
      picks.isCurrent(pick) && s.kind === 'review' && s.pdf?.book === pdf.book
    setStage((s) => (current(s) ? { ...s, error: undefined, pdf: { ...pdf, rereading: true } } : s))
    try {
      const { draft: next, styles, report } = await pdf.book.reread(overrides)
      setStage((previousStage) =>
        current(previousStage)
          ? {
              ...previousStage,
              draft: { ...previousStage.draft, chapters: next.chapters, pictures: next.pictures },
              pdf: {
                book: pdf.book,
                read: { styles, report, overrides },
                edited: false,
                rereading: false,
                run: pdf.run + 1,
              },
            }
          : previousStage,
      )
    } catch (error) {
      const message = error instanceof ImportError ? error.message : 'This file couldn’t be read again.'
      setStage((s) => (current(s) ? { ...s, error: message, pdf: { ...pdf, rereading: false } } : s))
    }
  }

  async function save(
    draft: DraftBook,
    fileName: string,
    cover: ReviewCover | null,
    plan: PicturePlan,
    pictures: ReadonlyMap<number, ReviewPicture>,
  ) {
    const pdf = stage.kind === 'review' ? stage.pdf : undefined
    const fail = (error: string) => setStage({ kind: 'review', draft, fileName, error, pdf })
    const saveable = saveableChapters(plan.chapters)
    if (!saveable.ok) return fail(importSaveText(saveable))
    if (isBadIsbn(draft.details.isbn)) return fail(BAD_ISBN)
    const blobs = keptPictures(plan.uploads, (n) => pictures.get(n)?.blob)
    if (!blobs) return fail(PICTURE_FAILED)

    const { title, author, language, details } = draft
    const saved = await savePrivateBook(
      { book: { title, author, language, ...details }, chapters: saveable.chapters, pictures: blobs, cover },
      BOOK_STEPS,
      (progress) => setStage({ kind: 'saving', draft, fileName, progress, pdf }),
    ).catch(() => null)
    if (!saved) return fail(SAVE_FAILED)
    if (!saved.ok) return fail(importSaveText(saved))
    await onImported(saved.id, saved.coverRefusal)
  }

  function pick(files: File[]) {
    const route = routePick(files)
    if (!route) return
    const refused = pickRefusal(route.kind, bookCount, limits.books)
    if (refused) {
      picks.invalidate()
      return setStage({ kind: 'pick', error: refused })
    }
    if (route.kind === 'book') return void read(route.file)
    picks.invalidate()
    if (route.kind === 'mixed') return setStage({ kind: 'pick', error: problemText(problem('mixed')) })
    if (!audiobooks) return setStage({ kind: 'pick', error: problemText(problem('off')) })
    setStage({ kind: 'audio', files: route.files })
  }

  if (stage.kind === 'pick') return <Picker error={stage.error} reading={null} audiobooks={audiobooks} onFiles={pick} />
  if (stage.kind === 'reading')
    return (
      <Picker reading={{ progress: stage.progress, cancel: stage.cancel }} audiobooks={audiobooks} onFiles={pick} />
    )
  if (stage.kind === 'audio')
    return (
      <Suspense
        fallback={
          <p className="mt-4 text-[14.5px] text-muted" data-testid="audiobook-import-loading">
            Loading the audiobook importer…
          </p>
        }
      >
        <AudiobookImporter
          files={stage.files}
          audioBytesUsed={audioBytesUsed}
          limits={limits}
          onImported={onImported}
          onCancel={backToPicker}
        />
      </Suspense>
    )
  const { pdf } = stage
  return (
    <Review
      key={`${stage.fileName}:${pdf?.run ?? 0}`}
      draft={stage.draft}
      error={stage.kind === 'review' ? stage.error : undefined}
      saving={stage.kind === 'saving' ? stage.progress : null}
      imageBytesLeft={Math.max(0, limits.userPictureBytes - imageBytesUsed)}
      userPictureBytes={limits.userPictureBytes}
      chaptersLocked={pdf?.rereading ?? false}
      howRead={
        pdf && (
          <PdfReading
            styles={pdf.read.styles}
            report={pdf.read.report}
            overrides={pdf.read.overrides}
            edited={pdf.edited}
            rereading={pdf.rereading}
            disabled={stage.kind === 'saving'}
            onReread={(overrides) => void reread(pdf, overrides)}
          />
        )
      }
      onChange={(draft) =>
        setStage({
          kind: 'review',
          draft,
          fileName: stage.fileName,
          pdf: pdf && { ...pdf, edited: pdf.edited || draft.chapters !== stage.draft.chapters },
        })
      }
      onSave={(draft, cover, plan, pictures) => save(draft, stage.fileName, cover, plan, pictures)}
      onCancel={() => {
        picks.invalidate()
        setStage({ kind: 'pick' })
      }}
    />
  )
}

interface Reading {
  progress?: PdfProgress
  cancel?: () => void
}

const DRAWING_NOTICE_MS = 1000

function progressText(progress: PdfProgress | undefined): string {
  if (!progress) return 'Reading the file…'
  const done = progress.done.toLocaleString('en-GB')
  const total = progress.total.toLocaleString('en-GB')
  if (progress.stage === 'drawing') return `Drawing pictures… ${done} of ${total}`
  return `Reading page ${done} of ${total}…`
}

function ReadingStatus({ reading }: { reading: Reading }) {
  const { progress, cancel } = reading
  const drawing = progress?.stage === 'drawing'
  const [showDrawing, setShowDrawing] = useState(false)
  useEffect(() => {
    if (!drawing) return
    const timer = setTimeout(() => setShowDrawing(true), DRAWING_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [drawing])
  const [lastPage, setLastPage] = useState<PdfProgress | null>(null)
  useEffect(() => {
    if (progress?.stage === 'reading') setLastPage(progress)
  }, [progress])
  if (!cancel)
    return (
      <p role="status" className="flex items-center gap-2 text-[15px] text-ink" data-testid="import-reading">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
        Reading the file…
      </p>
    )
  const shown = drawing && showDrawing ? progress : (lastPage ?? progress)
  return (
    <div className="grid w-full max-w-[360px] justify-items-center gap-3">
      <p role="status" className="flex items-center gap-2 text-[15px] text-ink" data-testid="import-reading">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
        {progressText(shown)}
      </p>
      <progress
        aria-label="Reading the PDF"
        max={shown?.total || 1}
        value={shown?.done ?? 0}
        className="h-2 w-full overflow-hidden rounded-full accent-accent"
        data-testid="import-reading-progress"
      />
      <Button type="button" variant="secondary" onClick={cancel} data-testid="import-reading-cancel">
        Cancel
      </Button>
    </div>
  )
}

function Picker({
  error,
  reading,
  audiobooks,
  onFiles,
}: {
  error?: string
  reading: Reading | null
  audiobooks: boolean
  onFiles: (files: File[]) => void
}) {
  const [over, setOver] = useState(false)
  const id = useId()
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = [...e.dataTransfer.files]
    if (files.length && !reading) onFiles(files)
  }
  return (
    <div>
      {error && (
        <Notice kind="error" id={`${id}-error`} data-testid="import-pick-error">
          {error}
        </Notice>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target only; the file input inside is the control. */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        data-testid="drop-zone"
        className={cn(
          'mt-4 grid place-items-center gap-3 rounded-xl border-2 border-dashed px-5 py-10 text-center transition',
          over ? 'border-accent bg-accent-soft' : 'border-line',
        )}
      >
        {reading ? (
          <ReadingStatus reading={reading} />
        ) : (
          <>
            <FileUp className="size-7 text-subtle" aria-hidden />
            <div>
              <input
                id={`${id}-file`}
                type="file"
                accept={pickerAccept(audiobooks)}
                multiple
                className="peer sr-only"
                data-testid="import-file"
                aria-describedby={`${id}-hint ${id}-audio-hint${error ? ` ${id}-error` : ''}`}
                onChange={(e) => {
                  const files = [...(e.currentTarget.files ?? [])]
                  e.currentTarget.value = ''
                  if (files.length) onFiles(files)
                }}
              />
              <label
                htmlFor={`${id}-file`}
                className="inline-flex h-12 cursor-pointer items-center rounded-xl bg-accent-fill px-5 text-[15px] font-semibold text-on-accent transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface hover:brightness-105"
              >
                Choose a book file
              </label>
            </div>
            <p id={`${id}-hint`} className="max-w-[46ch] text-[13.5px] leading-relaxed text-muted">
              Choose an EPUB, PDF, Markdown file or ZIP of Markdown files, up to {MAX_SOURCE_BYTES / MB} MB, or drop it
              here. The file is read in your browser and is not uploaded.
            </p>
            <p id={`${id}-audio-hint`} className="max-w-[46ch] text-[13.5px] leading-relaxed text-muted">
              {audiobooks
                ? 'An audiobook is one M4B file, or all the MP3 files of one audiobook: pick them together.'
                : problemText(problem('off'))}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

interface ReviewProps {
  draft: DraftBook
  error?: string
  saving: SaveProgress | null
  imageBytesLeft: number
  userPictureBytes: number
  howRead?: ReactNode
  chaptersLocked?: boolean
  onChange: (draft: DraftBook) => void
  onSave: (
    draft: DraftBook,
    cover: ReviewCover | null,
    plan: PicturePlan,
    pictures: ReadonlyMap<number, ReviewPicture>,
  ) => void
  onCancel: () => void
}

/** A block that shows one of the book's pictures, not a figure kept only for its caption. */
const isPicture = (block: BookBlock): block is ImageBlock => block.type === 'image' && block.image > 0

function useReviewPictures(draft: DraftBook): { pictures: ReadonlyMap<number, ReviewPicture>; ready: boolean } {
  const [pictures, setPictures] = useState<ReadonlyMap<number, ReviewPicture>>(new Map())
  const [ready, setReady] = useState(false)
  const opened = useRef(draft.chapters)
  const sources = draft.pictures
  useEffect(() => {
    let live = true
    const urls: string[] = []
    const wanted = [...new Set(opened.current.flatMap((c) => c.blocks.filter(isPicture).map((b) => b.image)))]
    void (async () => {
      const drawn = new Map<number, ReviewPicture>()
      for (const pictureNumber of wanted) {
        const source = sources[pictureNumber - 1]
        if (!source || 'problem' in source) {
          drawn.set(pictureNumber, { state: { ok: false, problem: source?.problem ?? 'missing' } })
          continue
        }
        const result = await drawPicture(source.bytes, source.type)
        if (!live) return
        if ('problem' in result) {
          drawn.set(pictureNumber, { state: { ok: false, problem: result.problem } })
          continue
        }
        const url = URL.createObjectURL(result.blob)
        urls.push(url)
        const { width, height } = result
        drawn.set(pictureNumber, {
          state: { ok: true, bytes: result.blob.size, width, height },
          blob: result.blob,
          url,
        })
      }
      if (!live) return
      setPictures(drawn)
      setReady(true)
    })()
    return () => {
      live = false
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [sources])
  return { pictures, ready }
}

function Review({
  draft,
  error,
  saving,
  imageBytesLeft,
  userPictureBytes,
  howRead,
  chaptersLocked = false,
  onChange,
  onSave,
  onCancel,
}: ReviewProps) {
  const [preview, setPreview] = useState<number | null>(null)
  const [cover, setCover] = useState<ReviewCover | null>(null)
  const words = useMemo(() => draft.chapters.map(chapterWords), [draft.chapters])
  const setChapters = (chapters: DraftChapter[]) => onChange({ ...draft, chapters })
  const busy = saving !== null
  const badIsbn = isBadIsbn(draft.details.isbn)
  const { pictures, ready } = useReviewPictures(draft)
  const plan = useMemo(
    () => planPictures(draft.chapters, (n) => pictures.get(n)?.state, BOOK_ROOM(imageBytesLeft)),
    [draft.chapters, pictures, imageBytesLeft],
  )
  const hasPictures = draft.chapters.some((c) => c.blocks.some(isPicture))
  const reading = hasPictures && !ready
  const context = useMemo<RenderContext>(
    () => ({
      imageSrc: (n) => pictures.get(n)?.url ?? '',
      imageSize: (n) => {
        const state = pictures.get(n)?.state
        return plan.numbers.has(n) && state?.ok ? { width: state.width, height: state.height } : null
      },
    }),
    [pictures, plan],
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!busy && !reading) onSave(draft, cover, plan, pictures)
  }
  const edit = (chapters: DraftChapter[], removed: number) => {
    setChapters(chapters)
    if (preview === null) return
    if (preview === removed) setPreview(null)
    else if (preview > removed) setPreview(preview - 1)
  }

  return (
    <form onSubmit={submit} aria-labelledby="review-title" className="space-y-6">
      <div>
        <h3 id="review-title" className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
          Review before saving
        </h3>
        <p className="mt-1 text-[14px] text-muted">
          Check the details and chapters. Nothing is saved until you choose Save to my shelf.
        </p>
      </div>
      {error && (
        <Notice kind="error" id="import-error" data-testid="import-error">
          {error}
        </Notice>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={busy}>
        <legend className="sr-only">Book details</legend>
        <TextField
          className="sm:col-span-2"
          label="Title"
          name="title"
          data-testid="import-title"
          required
          maxLength={300}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
        <TextField
          label="Author"
          name="author"
          data-testid="import-author"
          required
          maxLength={200}
          value={draft.author}
          onChange={(e) => onChange({ ...draft, author: e.target.value })}
        />
        <TextField
          label="Language"
          name="language"
          data-testid="import-language"
          hint="A tag such as en or pt-BR"
          required
          maxLength={35}
          pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}"
          value={draft.language}
          onChange={(e) => onChange({ ...draft, language: e.target.value })}
        />
      </fieldset>

      <CoverAndDetails
        draft={draft}
        busy={busy}
        cover={cover}
        badIsbn={badIsbn}
        onCover={setCover}
        onChange={onChange}
      />

      {howRead}

      <fieldset disabled={busy || chaptersLocked}>
        <legend className="text-[14px] font-medium text-ink">
          Chapters{' '}
          <span className="font-normal text-muted" data-testid="import-chapter-count">
            ({draft.chapters.length})
          </span>
        </legend>
        {hasPictures && (
          <PictureSummary
            reading={reading}
            plan={plan}
            imageBytesLeft={imageBytesLeft}
            userPictureBytes={userPictureBytes}
          />
        )}
        <ol className="mt-3 divide-y divide-line rounded-xl border border-line">
          {draft.chapters.map((chapter, i) => (
            <ChapterRow
              // biome-ignore lint/suspicious/noArrayIndexKey: chapters have no id; the index is their identity here.
              key={i}
              index={i}
              chapter={chapter}
              words={words[i] ?? 0}
              previewing={preview === i}
              onRename={(title) => setChapters(renameChapter(draft.chapters, i, title))}
              onPreview={() => setPreview(preview === i ? null : i)}
              onMerge={() => edit(mergeIntoPrevious(draft.chapters, i), i)}
              onDrop={() => edit(dropChapter(draft.chapters, i), i)}
            />
          ))}
        </ol>
        {draft.chapters.length === 0 && (
          <p className="mt-3 text-[14px] text-muted" data-testid="import-no-chapters">
            Every chapter has been dropped.
          </p>
        )}
      </fieldset>

      {preview !== null && draft.chapters[preview] && (
        <Preview
          index={preview}
          chapter={draft.chapters[preview]}
          language={draft.language}
          context={context}
          onClose={() => setPreview(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || reading || draft.chapters.length === 0} data-testid="import-save">
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Save to my shelf
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onCancel}
          data-testid="import-choose-another"
        >
          Choose another file
        </Button>
        {saving && (
          <p role="status" className="text-[14px] text-muted" data-testid="import-saving">
            {savingText(saving)}
          </p>
        )}
      </div>
    </form>
  )
}

function savingText({ stage, done, total }: SaveProgress): string {
  if (stage === 'cover') return 'Saving the cover…'
  if (stage === 'pictures') return `Uploading pictures… ${done} of ${total}`
  return `Saving chapter ${Math.min(done + 1, total)} of ${total}…`
}

function reasonText(reason: LeftOutReason, n: number, imageBytesLeft: number, userPictureBytes: number): string {
  const count = n.toLocaleString('en-GB')
  switch (reason) {
    case 'remote':
      return `${count} from the web (Folio doesn’t fetch them)`
    case 'large':
      return `${count} too large, even shrunk`
    case 'unreadable':
      return `${count} couldn’t be read`
    case 'missing':
      return `${count} not in the file`
    case 'book':
      return `${count} past this book’s limit of ${MAX_BOOK_IMAGES} pictures or 30 MB`
    case 'room':
      return `${count} past the room left in your library (${formatBytes(imageBytesLeft)} of ${formatBytes(userPictureBytes)})`
  }
}

function PictureSummary({
  reading,
  plan,
  imageBytesLeft,
  userPictureBytes,
}: {
  reading: boolean
  plan: PicturePlan
  imageBytesLeft: number
  userPictureBytes: number
}) {
  if (reading)
    return (
      <p
        role="status"
        className="mt-1 flex items-center gap-2 text-[13.5px] text-muted"
        data-testid="import-pictures-reading"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Reading pictures…
      </p>
    )
  const reasons = LEFT_OUT_REASONS.filter((r) => plan.leftOut[r] > 0)
  const leftOut = reasons.reduce((n, r) => n + plan.leftOut[r], 0)
  const kept = plural(plan.uploads.length, 'picture')
  return (
    <div className="mt-1 text-[13.5px] text-muted" data-testid="picture-summary">
      <p>{leftOut ? `${kept} · ${leftOut.toLocaleString('en-GB')} left out` : kept}</p>
      {leftOut > 0 && (
        <details className="mt-1">
          <summary
            className="cursor-pointer text-ink underline-offset-2 hover:underline"
            data-testid="import-pictures-why"
          >
            Why?
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {reasons.map((r) => (
              <li key={r}>{reasonText(r, plan.leftOut[r], imageBytesLeft, userPictureBytes)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

const reviewField =
  'mt-2 w-full rounded-xl border border-line bg-page px-4 text-[16px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15 aria-[invalid=true]:border-red-500'

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

export interface ReviewBook {
  title: string
  author: string
  details: DraftBook['details']
  cover: DraftBook['cover']
}

export function CoverAndDetails<T extends ReviewBook>({
  draft,
  busy,
  cover,
  badIsbn,
  onCover,
  onChange,
}: {
  draft: T
  busy: boolean
  cover: ReviewCover | null
  badIsbn: boolean
  onCover: (cover: ReviewCover | null) => void
  onChange: (draft: T) => void
}) {
  const [problem, setProblem] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const url = useObjectUrl(cover?.blob ?? null)
  const details = draft.details
  const setDetails = (next: Partial<DraftBook['details']>) => onChange({ ...draft, details: { ...details, ...next } })

  const source = draft.cover
  useEffect(() => {
    if (!source) return
    let live = true
    const bytes = new Uint8Array(source.bytes)
    void drawCover(new Blob([bytes], { type: source.info.type })).then((drawn) => {
      if (!live) return
      if ('problem' in drawn)
        setProblem('This file’s cover couldn’t be read. Choose an image or keep the generated cover.')
      else onCover({ ...drawn, from: source.from })
    })
    return () => {
      live = false
    }
  }, [source, onCover])

  async function choose(file: File) {
    setDrawing(true)
    const drawn = await drawCover(file)
    setDrawing(false)
    if ('problem' in drawn) {
      setProblem(IMAGE_PROBLEM_TEXT[drawn.problem])
      return
    }
    setProblem(null)
    onCover({ ...drawn, from: 'upload' })
  }

  const descriptionLength = (details.description ?? '').length
  return (
    <fieldset disabled={busy} className="space-y-5">
      <legend className="text-[16px] font-semibold text-ink">
        <h4>Cover and details</h4>
      </legend>
      <CoverChooser
        title={draft.title}
        author={draft.author}
        style={privateCover(draft.title)}
        cover={cover && url ? { src: url, width: cover.width, height: cover.height } : null}
        sourceText={coverSourceText(cover?.from ?? null)}
        onChoose={(file) => void choose(file)}
        onGenerated={() => {
          setProblem(null)
          onCover(null)
        }}
        busy={drawing ? 'Reading the image…' : null}
        error={problem}
      />
      <div>
        <label htmlFor="review-description" className="block text-[14px] font-medium text-ink">
          Description
        </label>
        <textarea
          id="review-description"
          rows={5}
          maxLength={DESCRIPTION_MAX}
          value={details.description ?? ''}
          onChange={(e) => setDetails({ description: e.target.value })}
          aria-describedby="review-description-count"
          className={cn(reviewField, 'py-3 leading-relaxed')}
          data-testid="import-description"
        />
        <p
          id="review-description-count"
          className="mt-1 text-[13px] text-muted tabular"
          data-testid="import-description-count"
        >
          {descriptionLength.toLocaleString('en-GB')} of {DESCRIPTION_MAX.toLocaleString('en-GB')}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_120px]">
        <div>
          <label htmlFor="review-isbn" className="block text-[14px] font-medium text-ink">
            ISBN
          </label>
          <input
            id="review-isbn"
            inputMode="numeric"
            maxLength={40}
            value={details.isbn ?? ''}
            onChange={(e) => setDetails({ isbn: e.target.value })}
            aria-invalid={badIsbn || undefined}
            aria-describedby={badIsbn ? 'review-isbn-error' : undefined}
            className={cn(reviewField, 'h-12')}
            data-testid="import-isbn"
          />
          {badIsbn && (
            <p
              id="review-isbn-error"
              className="mt-1 text-[13px] text-red-700 dark:text-red-300"
              data-testid="import-isbn-error"
            >
              {BAD_ISBN}
            </p>
          )}
        </div>
        <label className="block text-[14px] font-medium text-ink">
          Publisher
          <input
            maxLength={PUBLISHER_MAX}
            value={details.publisher ?? ''}
            onChange={(e) => setDetails({ publisher: e.target.value })}
            className={cn(reviewField, 'h-12')}
            data-testid="import-publisher"
          />
        </label>
        <label className="block text-[14px] font-medium text-ink">
          Year
          <input
            inputMode="numeric"
            maxLength={4}
            value={details.publishedYear ?? ''}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
              setDetails({ publishedYear: digits ? Number(digits) : null })
            }}
            className={cn(reviewField, 'h-12')}
            data-testid="import-year"
          />
        </label>
      </div>
    </fieldset>
  )
}

interface ChapterRowProps {
  index: number
  chapter: DraftChapter
  words: number
  previewing: boolean
  onRename: (title: string) => void
  onPreview: () => void
  onMerge: () => void
  onDrop: () => void
}

const rowButton =
  'inline-flex h-11 items-center gap-1.5 rounded-full border border-line px-3.5 text-[13.5px] text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink'

function ChapterRow({ index, chapter, words, previewing, onRename, onPreview, onMerge, onDrop }: ChapterRowProps) {
  const chapterNumber = index + 1
  const id = `chapter-${chapterNumber}-title`
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4"
      data-testid="import-chapter"
      data-key={chapterNumber}
    >
      <span className="w-7 shrink-0 text-right text-[13px] text-subtle tabular" aria-hidden>
        {chapterNumber}
      </span>
      <div className="min-w-[180px] flex-1">
        <label htmlFor={id} className="sr-only">
          Chapter {chapterNumber} title
        </label>
        <input
          id={id}
          value={chapter.title}
          maxLength={300}
          onChange={(e) => onRename(e.target.value)}
          data-testid="import-chapter-title"
          data-key={chapterNumber}
          className="h-11 w-full rounded-xl border border-line bg-page px-3 text-[15px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
      </div>
      <span
        className="w-[88px] shrink-0 text-[13px] text-muted tabular"
        data-testid="import-chapter-words"
        data-key={chapterNumber}
      >
        {words.toLocaleString('en')} words
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          className={cn(rowButton, previewing && 'border-accent text-accent')}
          onClick={onPreview}
          aria-pressed={previewing}
          data-testid="import-chapter-preview"
          data-key={chapterNumber}
        >
          <Eye className="size-4" aria-hidden />
          Preview<span className="sr-only"> chapter {chapterNumber}</span>
        </button>
        <button
          type="button"
          className={rowButton}
          onClick={onMerge}
          disabled={index === 0}
          data-testid="import-chapter-merge"
          data-key={chapterNumber}
        >
          <Merge className="size-4" aria-hidden />
          Merge
          <span className="sr-only"> chapter {chapterNumber} into the one before</span>
        </button>
        <button
          type="button"
          className={rowButton}
          onClick={onDrop}
          data-testid="import-chapter-drop"
          data-key={chapterNumber}
        >
          <Trash2 className="size-4" aria-hidden />
          Drop<span className="sr-only"> chapter {chapterNumber}</span>
        </button>
      </div>
    </li>
  )
}

function Preview({
  index,
  chapter,
  language,
  context,
  onClose,
}: {
  index: number
  chapter: DraftChapter
  language: string
  context: RenderContext
  onClose: () => void
}) {
  const pages = useMemo(() => previewPages(chapter, context), [chapter, context])
  const [page, setPage] = useState(0)
  const shown = Math.min(page, Math.max(0, pages.length - 1))
  return (
    <section aria-labelledby="preview-title" className="rounded-xl border border-line bg-r-page p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-3">
        <h3 id="preview-title" className="text-[14px] font-medium text-ink" data-testid="import-preview-label">
          Preview: chapter {index + 1}, page {shown + 1} of {pages.length}
        </h3>
        <div className="flex gap-1.5">
          <button
            type="button"
            className={rowButton}
            disabled={shown === 0}
            onClick={() => setPage(shown - 1)}
            data-testid="import-preview-previous"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span className="sr-only">Previous page</span>
          </button>
          <button
            type="button"
            className={rowButton}
            disabled={shown >= pages.length - 1}
            onClick={() => setPage(shown + 1)}
            data-testid="import-preview-next"
          >
            <ChevronRight className="size-4" aria-hidden />
            <span className="sr-only">Next page</span>
          </button>
          <button type="button" className={rowButton} onClick={onClose} data-testid="import-preview-close">
            Close preview
          </button>
        </div>
      </div>
      <div
        data-tone="default"
        lang={language}
        className="prose-reader rounded-[3px] border border-r-line bg-r-paper px-5 pt-8 pb-10 sm:px-10"
      >
        {shown === 0 && (
          <div className="mb-8">
            <p className="eyebrow font-sans text-r-accent">Chapter {index + 1}</p>
            <p className="mt-3 text-[clamp(26px,1.5em,36px)] leading-[1.15] font-medium text-r-ink">{chapter.title}</p>
            <div className="mt-6 h-[2px] w-16 bg-r-accent" aria-hidden />
          </div>
        )}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendered by import/render.ts from structured blocks, with every text escaped. */}
        <div dangerouslySetInnerHTML={{ __html: pages[shown] ?? '' }} />
      </div>
    </section>
  )
}
