import { AppLink } from '~/client/components/AppLink'
import { Button } from '~/client/features/account/ui'
import { agoText } from '~/client/features/github-repos/repo-messages'
import type { ArticleView } from '~/shared/articles/contract'
import { cardLine } from './article-messages'

function Ago({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString('en-GB')} suppressHydrationWarning>
      {agoText(iso)}
    </time>
  )
}

export function ArticleCard({ article }: { article: ArticleView }) {
  return (
    <li
      className="flex flex-wrap items-start gap-3 rounded-[22px] border border-line bg-surface p-5 md:p-6"
      data-testid="article-card"
      data-key={article.id}
    >
      <div className="min-w-0 flex-[1_1_220px]">
        <h2 className="font-display text-[19px] leading-snug font-bold tracking-[-0.01em] break-words text-ink">
          <AppLink
            href={article.readHref}
            preload={false}
            className="underline-offset-4 hover:text-accent hover:underline"
            data-testid="article-read"
            data-key={article.id}
          >
            {article.title}
          </AppLink>
        </h2>
        <p className="mt-2 text-[14px] text-muted">
          {cardLine(article.site, article.words)} · saved <Ago iso={article.savedAt} />
        </p>
      </div>
      <form method="post" action="/account/articles">
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="id" value={article.id} />
        <Button variant="danger" data-testid="article-delete" data-key={article.id}>
          Delete<span className="sr-only"> {article.title}</span>
        </Button>
      </form>
    </li>
  )
}
