import { LoaderCircle } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, Notice, TextField } from '~/client/features/account/ui'
import { uploadCover } from '~/client/features/book-details/details-client'
import { CoverAndDetails, type ReviewCover } from '~/client/features/import/BookImporter'
import { discardUpload } from '~/client/features/import/import-client'
import { type CoverRefusal, refusalOf } from '~/client/features/import/private-book-save'
import { formatLength } from '~/shared/audiobooks/chapters'
import { fileSize } from '~/shared/content/private-book'
import { isBadIsbn } from '~/shared/import/isbn'
import { finishAudiobook, sendChunk, startAudiobook } from './audiobook-client'
import { type AudiobookProblem, isResumable, problemText } from './audiobook-problems'
import { type AudiobookDraft, AudiobookReadError, readAudiobook } from './read-audiobook'
import { type UploadResult, uploadAll } from './upload'

type Stage =
  | { kind: 'reading'; done: number; total: number }
  | { kind: 'review'; draft: AudiobookDraft; error?: string }
  | { kind: 'uploading'; draft: AudiobookDraft; id: string; sent: number }
  | { kind: 'stopped'; draft: AudiobookDraft; id: string; received: number[]; sent: number }
  | { kind: 'checking'; draft: AudiobookDraft }

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

const sum = (bytes: readonly number[]) => bytes.reduce((n, b) => n + b, 0)

const FROM_TEXT: Record<AudiobookDraft['from'], string> = {
  file: 'Chapters from the file.',
  files: 'One chapter per file, in track order.',
  parts: 'The file has no chapters, so it’s split into parts of an hour.',
}

function summary(draft: AudiobookDraft): string {
  const chapters = `${draft.chapters.length.toLocaleString('en-GB')} ${draft.chapters.length === 1 ? 'chapter' : 'chapters'}`
  const kind = draft.type === 'mp4' ? 'M4B' : `${draft.files.length} MP3 ${draft.files.length === 1 ? 'file' : 'files'}`
  return `${formatLength(draft.totalMs)} · ${chapters} · ${fileSize(draft.bytes)} · ${kind}`
}

export function AudiobookImporter({
  files,
  audioBytesUsed,
  onImported,
  onCancel,
}: {
  files: File[]
  audioBytesUsed: number
  onImported: (id: string, coverRefusal?: CoverRefusal) => Promise<void>
  onCancel: (error?: string) => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'reading', done: 0, total: files.length })
  const [cover, setCover] = useState<ReviewCover | null>(null)
  const controller = useRef<AbortController | null>(null)
  const coverRefusal = useRef<CoverRefusal | undefined>(undefined)
  const cancelled = useRef(onCancel)
  cancelled.current = onCancel

  useEffect(() => {
    const reading = new AbortController()
    void readAudiobook(files, {
      audioBytesUsed,
      signal: reading.signal,
      onProgress: (done, total) => !reading.signal.aborted && setStage({ kind: 'reading', done, total }),
    }).then(
      (draft) => !reading.signal.aborted && setStage({ kind: 'review', draft }),
      (error) => {
        if (reading.signal.aborted || isAbort(error)) return
        const problem = error instanceof AudiobookReadError ? error.problem : null
        cancelled.current(problemText(problem ?? { code: 'unreadable', reason: 'unknown error' }))
      },
    )
    return () => reading.abort()
  }, [files, audioBytesUsed])

  const busy = stage.kind === 'uploading' || stage.kind === 'stopped' || stage.kind === 'checking'
  useEffect(() => {
    if (!busy) return
    const ask = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [busy])
  useEffect(() => () => controller.current?.abort(), [])

  const refused = (draft: AudiobookDraft, id: string | null, problem: AudiobookProblem) => {
    if (id) discardUpload(id)
    setStage({ kind: 'review', draft, error: problemText(problem) })
  }

  async function upload(draft: AudiobookDraft, id: string, received: number[]) {
    const abort = new AbortController()
    controller.current = abort
    const total = (bytes: number) => setStage({ kind: 'uploading', draft, id, sent: bytes })
    total(sum(received))
    let result: UploadResult
    try {
      result = await uploadAll(
        draft.files,
        received,
        (n, offset, bytes, signal) => sendChunk(id, n, offset, bytes, signal),
        {
          signal: abort.signal,
          onProgress: total,
        },
      )
    } catch (error) {
      if (isAbort(error)) return
      return refused(draft, id, { code: 'failed' })
    }
    if (!result.ok) {
      if (isResumable(result.problem)) {
        setStage({ kind: 'stopped', draft, id, received: result.received, sent: sum(result.received) })
        return
      }
      return refused(draft, id, result.problem)
    }
    setStage({ kind: 'checking', draft })
    const finished = await finishAudiobook(id)
    if (!finished.ok) return refused(draft, id, finished.problem)
    await onImported(id, coverRefusal.current)
  }

  async function start(draft: AudiobookDraft) {
    const chapters = draft.chapters.map((c, i) => ({ ...c, title: c.title.trim() || `Chapter ${i + 1}` }))
    const { description, isbn, publisher, publishedYear } = draft.details
    setStage({ kind: 'uploading', draft, id: '', sent: 0 })
    const started = await startAudiobook({
      title: draft.title.trim(),
      author: draft.author.trim(),
      narrator: draft.narrator.trim() || null,
      language: draft.language.trim(),
      details: {
        description: description?.trim() || null,
        isbn: isbn?.trim() || null,
        publisher: publisher?.trim() || null,
        publishedYear,
      },
      files: draft.files.map((f) => ({ type: draft.type, bytes: f.size })),
      chapters,
      cover: cover !== null,
    })
    if (!started.ok) return refused(draft, null, started.problem)
    const { id } = started.value
    coverRefusal.current = undefined
    if (cover) {
      const saved = await uploadCover(id, cover.blob, cover.from)
      if (!saved.ok) coverRefusal.current = refusalOf(saved.problem)
    }
    await upload(
      draft,
      id,
      draft.files.map(() => 0),
    )
  }

  function cancel() {
    controller.current?.abort()
    if ((stage.kind === 'uploading' || stage.kind === 'stopped') && stage.id) discardUpload(stage.id)
    onCancel()
  }

  if (stage.kind === 'reading')
    return (
      <div className="mt-4 grid justify-items-center gap-3 rounded-xl border-2 border-dashed border-line px-5 py-10">
        <p
          role="status"
          className="flex items-center gap-2 text-[15px] text-ink"
          data-testid="audiobook-import-reading"
        >
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          Reading the files… {stage.done.toLocaleString('en-GB')} of {stage.total.toLocaleString('en-GB')}
        </p>
        <Button type="button" variant="secondary" onClick={() => onCancel()} data-testid="audiobook-import-cancel">
          Cancel
        </Button>
      </div>
    )

  const { draft } = stage
  return (
    <Review
      draft={draft}
      error={stage.kind === 'review' ? stage.error : undefined}
      cover={cover}
      onCover={setCover}
      locked={stage.kind !== 'review'}
      onChange={(next) => stage.kind === 'review' && setStage({ kind: 'review', draft: next })}
      onImport={() => void start(draft)}
      onCancel={cancel}
      progress={progressOf(stage)}
    />
  )

  function progressOf(stage: Exclude<Stage, { kind: 'reading' }>) {
    if (stage.kind === 'uploading' || stage.kind === 'stopped')
      return (
        <UploadProgress
          sent={stage.sent}
          total={draft.bytes}
          stopped={stage.kind === 'stopped'}
          onResume={stage.kind === 'stopped' ? () => void upload(draft, stage.id, stage.received) : undefined}
          onCancel={cancel}
        />
      )
    if (stage.kind === 'checking')
      return (
        <p
          role="status"
          className="flex items-center gap-2 text-[15px] text-ink"
          data-testid="audiobook-import-checking"
        >
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          Checking the audiobook…
        </p>
      )
    return null
  }
}

function UploadProgress({
  sent,
  total,
  stopped,
  onResume,
  onCancel,
}: {
  sent: number
  total: number
  stopped: boolean
  onResume?: () => void
  onCancel: () => void
}) {
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024))
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-surface p-4">
      {stopped ? (
        <Notice kind="error" data-testid="audiobook-import-stopped">
          {problemText({ code: 'stopped' })}
        </Notice>
      ) : (
        <p
          role="status"
          className="flex items-center gap-2 text-[15px] text-ink"
          data-testid="audiobook-import-uploading"
        >
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          Uploading… {fileSize(sent)} of {fileSize(total)}
        </p>
      )}
      <progress
        aria-label="Uploading the audiobook"
        aria-valuetext={`${fileSize(sent)} of ${fileSize(total)}`}
        max={Math.max(1, mb(total))}
        value={mb(sent)}
        className="h-2 w-full overflow-hidden rounded-full accent-accent"
        data-testid="audiobook-import-progress"
      />
      <div className="flex flex-wrap gap-3">
        {onResume && (
          <Button type="button" onClick={onResume} data-testid="audiobook-import-resume">
            Resume
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onCancel} data-testid="audiobook-import-cancel">
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Review({
  draft,
  error,
  cover,
  onCover,
  locked,
  onChange,
  onImport,
  onCancel,
  progress,
}: {
  draft: AudiobookDraft
  error?: string
  cover: ReviewCover | null
  onCover: (cover: ReviewCover | null) => void
  locked: boolean
  onChange: (draft: AudiobookDraft) => void
  onImport: () => void
  onCancel: () => void
  progress: ReactNode
}) {
  const badIsbn = isBadIsbn(draft.details.isbn)
  const ready = Boolean(draft.title.trim() && draft.author.trim()) && !badIsbn
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!locked && ready) onImport()
  }
  const rename = (i: number, title: string) =>
    onChange({ ...draft, chapters: draft.chapters.map((c, j) => (j === i ? { ...c, title } : c)) })
  return (
    <form onSubmit={submit} aria-labelledby="audiobook-review-title" className="mt-4 space-y-6">
      <div>
        <h3 id="audiobook-review-title" className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
          Review the audiobook
        </h3>
        <p className="mt-1 text-[14px] text-muted tabular" data-testid="audiobook-summary">
          {summary(draft)}
        </p>
        <p className="mt-1 text-[14px] text-muted">{FROM_TEXT[draft.from]}</p>
      </div>
      {error && (
        <Notice kind="error" id="audiobook-error" data-testid="audiobook-import-error">
          {error}
        </Notice>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={locked}>
        <legend className="sr-only">Audiobook details</legend>
        <TextField
          className="sm:col-span-2"
          label="Title"
          name="title"
          data-testid="audiobook-import-title"
          required
          maxLength={300}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
        <TextField
          label="Author"
          name="author"
          data-testid="audiobook-import-author"
          required
          maxLength={200}
          value={draft.author}
          onChange={(e) => onChange({ ...draft, author: e.target.value })}
        />
        <TextField
          label="Read by"
          name="narrator"
          data-testid="audiobook-import-narrator"
          hint="Optional"
          maxLength={200}
          value={draft.narrator}
          onChange={(e) => onChange({ ...draft, narrator: e.target.value })}
        />
        <TextField
          label="Language"
          name="language"
          data-testid="audiobook-import-language"
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
        busy={locked}
        cover={cover}
        badIsbn={badIsbn}
        onCover={onCover}
        onChange={onChange}
      />

      <fieldset disabled={locked}>
        <legend className="text-[14px] font-medium text-ink">
          Chapters{' '}
          <span className="font-normal text-muted" data-testid="audiobook-import-chapter-count">
            ({draft.chapters.length})
          </span>
        </legend>
        <ol className="mt-3 divide-y divide-line rounded-xl border border-line">
          {draft.chapters.map((chapter, i) => {
            const n = i + 1
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: chapters have no id; their position is their identity here.
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4"
                data-testid="audiobook-import-chapter"
                data-key={n}
              >
                <span className="w-9 shrink-0 text-right text-[13px] text-subtle tabular" aria-hidden>
                  {n}.
                </span>
                <div className="min-w-[160px] flex-1">
                  <label htmlFor={`audio-chapter-${n}`} className="sr-only">
                    Chapter {n} title
                  </label>
                  <input
                    id={`audio-chapter-${n}`}
                    value={chapter.title}
                    maxLength={300}
                    onChange={(e) => rename(i, e.target.value)}
                    data-testid="audiobook-import-chapter-title"
                    data-key={n}
                    className="h-11 w-full rounded-xl border border-line bg-page px-3 text-[15px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                  />
                </div>
                <span className="shrink-0 text-[13px] text-muted tabular">{formatLength(chapter.durationMs)}</span>
              </li>
            )
          })}
        </ol>
      </fieldset>

      {progress ?? (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={locked || !ready} data-testid="audiobook-import-submit">
            Import
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} data-testid="audiobook-import-cancel">
            Cancel
          </Button>
        </div>
      )}
    </form>
  )
}
