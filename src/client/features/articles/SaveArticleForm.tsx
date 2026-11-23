import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { Button, Notice, TextField } from '~/client/features/account/ui'
import { discardUpload, finishBook, uploadChapter, uploadPicture } from '~/client/features/import/import-client'
import { drawPicture } from '~/client/features/import/picture-draw'
import { parseArticleUrl } from '~/shared/articles/article-url'
import type { ArticleView } from '~/shared/articles/contract'
import { privateBookHref } from '~/shared/content/private-book'
import type { Plan } from '~/shared/plans/plans'
import { articleProblemText, canRetry, progressText, type SaveStage, savedText } from './article-messages'
import type { SaveSteps } from './article-save'
import { type ArticleFailure, fetchArticle, fetchArticlePicture, startArticle } from './articles-client'

async function loadSaver() {
  const [{ saveArticle }, { readArticle }, { draftArticle }] = await Promise.all([
    import('./article-save'),
    import('./readability'),
    import('./article-draft'),
  ])
  const steps: SaveSteps = {
    fetchArticle,
    read: async (html, finalUrl) => readArticle(html, finalUrl),
    draft: async (result, finalUrl) => draftArticle(result, finalUrl),
    fetchPicture: fetchArticlePicture,
    drawPicture,
    startArticle,
    upload: { uploadPicture, uploadChapter, finish: finishBook, discard: discardUpload },
  }
  return { saveArticle, steps }
}

type State =
  | { kind: 'idle' }
  | { kind: 'saving'; progress: SaveStage }
  | { kind: 'saved'; id: string; failed: number; capped: number }
  | { kind: 'error'; failure: ArticleFailure }

const link = 'font-semibold underline underline-offset-2'

export function SaveArticleForm({
  initialUrl = '',
  plan,
  max,
  testHosts,
  imageBytesUsed,
  articles,
}: {
  initialUrl?: string
  plan: Plan
  max: number
  testHosts: readonly string[]
  imageBytesUsed: number
  articles: readonly ArticleView[]
}) {
  const router = useRouter()
  const [url, setUrl] = useState(initialUrl)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const saving = state.kind === 'saving'
  const readHref = (id: string) => articles.find((a) => a.id === id)?.readHref ?? privateBookHref(id)

  const submit = async () => {
    const ownHosts = typeof window === 'undefined' ? [] : [window.location.hostname]
    const parsed = parseArticleUrl(url, { ownHosts, testHosts })
    if (!parsed.ok) {
      setState({ kind: 'error', failure: { problem: parsed.reason } })
      return
    }
    setState({ kind: 'saving', progress: { stage: 'fetching' } })
    try {
      const { saveArticle, steps } = await loadSaver()
      const outcome = await saveArticle(url, steps, { imageBytesUsed }, (progress) =>
        setState({ kind: 'saving', progress }),
      )
      if (!outcome.ok) {
        setState({ kind: 'error', failure: outcome.failure })
        return
      }
      await router.invalidate()
      setUrl('')
      setState({ kind: 'saved', id: outcome.id, failed: outcome.failed, capped: outcome.capped })
    } catch {
      setState({ kind: 'error', failure: { problem: 'failed' } })
    }
  }

  const failure = state.kind === 'error' ? state.failure : null
  return (
    <form
      className="mt-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!saving) void submit()
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          label="Article address"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com/a-long-read"
          className="min-w-0 flex-1"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={failure ? true : undefined}
          aria-describedby={failure ? 'articles-error' : undefined}
          data-testid="articles-url"
        />
        <Button data-testid="articles-save" disabled={saving} aria-busy={saving || undefined} className="shrink-0">
          Save
        </Button>
      </div>
      <p className="mt-3 min-h-[1.5em] text-[14.5px] text-muted" aria-live="polite" data-testid="articles-progress">
        {state.kind === 'saving' && progressText(state.progress)}
        {state.kind === 'saved' && (
          <>
            {savedText(state.failed, state.capped)}{' '}
            <AppLink
              href={readHref(state.id)}
              preload={false}
              className={`${link} text-ink`}
              data-testid="articles-read-new"
            >
              Read it
            </AppLink>
          </>
        )}
      </p>
      {failure && (
        <Notice kind="error" id="articles-error" data-testid="articles-error">
          {articleProblemText(failure.problem, {
            plan: failure.plan ?? plan,
            max: failure.max ?? max,
            retryAt: failure.retryAt,
          })}
          {failure.problem === 'not_html' && (
            <>
              {' '}
              <AppLink href="/account/books" className={link} data-testid="articles-my-books">
                My books
              </AppLink>
            </>
          )}
          {failure.problem === 'exists' && failure.existingId && (
            <>
              {' '}
              <AppLink
                href={readHref(failure.existingId)}
                preload={false}
                className={link}
                data-testid="articles-open-existing"
              >
                Read it
              </AppLink>
            </>
          )}
          {canRetry(failure.problem) && (
            <>
              {' '}
              <button type="button" className={link} onClick={() => void submit()} data-testid="articles-retry">
                Retry
              </button>
            </>
          )}
        </Notice>
      )}
    </form>
  )
}
