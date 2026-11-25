import { KeySquare } from 'lucide-react'
import { shortDate } from '~/shared/lib/site'
import {
  ACCESS_TOKEN_REVOKED,
  ACCESS_TOKENS_EMPTY,
  ACCESS_TOKENS_INTRO,
  tokenExpiryText,
  tokenUseText,
} from './access-token-text'
import { Button, Notice, Section } from './ui'

export interface AccessTokenItem {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
}

export function AccessTokensSection({ tokens, revoked }: { tokens: AccessTokenItem[]; revoked: boolean }) {
  return (
    <Section id="access-tokens" title="Access tokens">
      <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted">{ACCESS_TOKENS_INTRO}</p>
      {revoked && (
        <Notice kind="success" data-testid="account-token-revoked">
          {ACCESS_TOKEN_REVOKED}
        </Notice>
      )}
      {tokens.length === 0 ? (
        <p className="mt-5 text-[15px] text-ink" data-testid="account-tokens-empty">
          {ACCESS_TOKENS_EMPTY}
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line" aria-label="Your access tokens">
          {tokens.map((token) => (
            <li
              key={token.id}
              data-testid="account-token"
              data-key={token.id}
              className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3 text-[14.5px]">
                <KeySquare className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium break-words text-ink" data-testid="account-token-name">
                    {token.name}
                  </p>
                  <p className="text-muted">{tokenUseText(token)}</p>
                  <p className="text-muted">{tokenExpiryText(token)}</p>
                </div>
              </div>
              <form method="post" action="/account" className="shrink-0">
                <input type="hidden" name="intent" value="token-revoke" />
                <input type="hidden" name="token" value={token.id} />
                <Button
                  variant="secondary"
                  data-testid="account-token-revoke"
                  data-key={token.id}
                  aria-label={`Revoke ${token.name}, created ${shortDate(token.createdAt)}`}
                >
                  Revoke
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
