import { useEffect, useState } from 'react'
import { AccountPage, Notice } from '~/client/features/account/ui'
import type { ArticlesState } from '~/shared/articles/contract'
import { ArticleCard } from './ArticleCard'
import { articleProblemText, countText, DELETE_NOTE, EMPTY_TEXT, INTRO, NEEDS_JAVASCRIPT } from './article-messages'
import { SaveArticleForm } from './SaveArticleForm'

export type ArticlesNotice = 'deleted' | 'missing' | 'invalid' | 'unavailable'

const NOTICE_TEXT: Record<Exclude<ArticlesNotice, 'deleted'>, string> = {
  missing: 'That article wasn’t found. It may have been deleted already.',
  invalid: 'That request wasn’t understood. Try again.',
  unavailable: 'Something went wrong. Try again in a few minutes.',
}

export function ArticlesPage({
  state,
  initialUrl,
  notice,
}: {
  state: ArticlesState
  initialUrl?: string
  notice?: ArticlesNotice
}) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return (
    <AccountPage eyebrow="Account" title="Articles" titleTestId="articles-title" lead={INTRO}>
      {notice === 'deleted' && (
        <Notice kind="success" data-testid="articles-deleted">
          Article deleted.
        </Notice>
      )}
      {notice && notice !== 'deleted' && (
        <Notice kind="error" data-testid="articles-notice">
          {NOTICE_TEXT[notice]}
        </Notice>
      )}
      {state.state === 'ready' ? (
        <>
          {hydrated ? (
            <SaveArticleForm
              initialUrl={initialUrl}
              max={state.max}
              testHosts={state.testHosts}
              imageBytesUsed={state.imageBytesUsed}
              limits={state.limits}
              articles={state.articles}
            />
          ) : (
            <p className="mt-8 text-[14.5px] font-medium text-ink" data-testid="articles-needs-javascript">
              {NEEDS_JAVASCRIPT}
            </p>
          )}
          <p className="mt-10 text-[14px] font-medium text-muted" data-testid="articles-count">
            {countText(state.articles.length, state.max)}
          </p>
          {state.articles.length === 0 ? (
            <p className="mt-4 text-[15px] text-body" data-testid="articles-empty">
              {EMPTY_TEXT}
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {state.articles.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </ul>
          )}
          <p className="mt-5 text-[13.5px] text-muted">{DELETE_NOTE}</p>
        </>
      ) : (
        <Notice kind="error" data-testid="articles-error">
          {articleProblemText(state.state === 'signed_out' ? 'signed_out' : 'failed')}
        </Notice>
      )}
    </AccountPage>
  )
}
