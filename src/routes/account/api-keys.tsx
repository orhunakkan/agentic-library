import { createFileRoute, redirect } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  API_KEY_ERRORS,
  API_KEY_STATUS_TEXT,
  API_KEY_STATUSES,
  type ApiKeyError,
  type ApiKeyStatus,
  apiKeyErrorText,
} from '~/client/features/account/account-messages'
import { AccountPage, Button, DateTime, Notice, Section, TextField } from '~/client/features/account/ui'
import { ProNotice } from '~/client/features/plans/ProNotice'
import { handleApiKeys } from '~/server/account-actions'
import { getApiKeysPage } from '~/server/account-functions'
import type { Provider } from '~/server/api-keys'
import { AI_MODELS, type AiModelId, DEFAULT_AI_MODEL } from '~/shared/lib/ai-models'
import { SITE_NAME } from '~/shared/lib/site'
import {
  DEFAULT_SPEECH_MODEL,
  SPEECH_MODELS,
  type SpeechModelId,
  speechModelDescription,
  speechModelName,
  usd,
} from '~/shared/lib/speech-models'

const SEARCH_PROVIDERS = ['anthropic', 'elevenlabs'] as const

interface ApiKeysSearch {
  status?: ApiKeyStatus
  error?: ApiKeyError
  provider?: Provider
}

const PROVIDER_NAMES: Record<Provider, string> = { anthropic: 'Anthropic', elevenlabs: 'ElevenLabs' }

type PageData = Awaited<ReturnType<typeof getApiKeysPage>>
type KeyEntry = PageData['keys'][number]

export const Route = createFileRoute('/account/api-keys')({
  validateSearch: (search: Record<string, unknown>): ApiKeysSearch => ({
    status: API_KEY_STATUSES.find((s) => s === search.status),
    error: API_KEY_ERRORS.find((e) => e === search.error),
    provider: SEARCH_PROVIDERS.find((p) => p === search.provider),
  }),
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account/api-keys' } })
  },
  loader: () => getApiKeysPage(),
  head: () => ({ meta: [{ title: `API keys | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  server: { handlers: { POST: ({ request }) => handleApiKeys(request) } },
  component: ApiKeysScreen,
})

function ApiKeysScreen() {
  const data = Route.useLoaderData()
  const { status, error, provider } = Route.useSearch()
  const anthropic = data.keys.find((k) => k.provider === 'anthropic')
  const elevenlabs = data.keys.find((k) => k.provider === 'elevenlabs')
  const elevenlabsPro = Route.useRouteContext().viewer?.plan === 'pro'
  const notices = (here: Provider | undefined) =>
    provider === here ? <Notices status={status} error={error} provider={here} /> : null
  return (
    <AccountPage
      eyebrow="Account"
      title="API keys"
      titleTestId="api-keys-title"
      lead="Save your own API keys for the agent features and for read aloud’s voices. Each is checked with the provider, stored encrypted, and never shown again in full."
      nav
    >
      {notices(undefined)}
      {anthropic && (
        <ProviderKey entry={anthropic} invalid={provider === 'anthropic' && isKeyError(error)}>
          {notices('anthropic')}
        </ProviderKey>
      )}
      <Section id="model" title="Model for agent features">
        <ModelForm current={data.model} />
      </Section>
      {elevenlabs && !elevenlabsPro && (
        <Section id="elevenlabs" title="ElevenLabs">
          {notices('elevenlabs') && <div className="-mt-6 mb-5">{notices('elevenlabs')}</div>}
          <ProNotice feature="elevenlabs" className="space-y-2 text-[14.5px] leading-relaxed text-body" />
          {elevenlabs.saved && <SavedKeyToDelete saved={elevenlabs.saved} />}
        </Section>
      )}
      {elevenlabs && elevenlabsPro && (
        <ProviderKey
          entry={elevenlabs}
          invalid={provider === 'elevenlabs' && isKeyError(error)}
          after={
            <>
              {elevenlabs.saved && <UsageLine usage={data.speechUsage} model={data.speechModel} />}
              <SpeechModelForm current={data.speechModel} />
            </>
          }
        >
          {notices('elevenlabs')}
        </ProviderKey>
      )}
    </AccountPage>
  )
}

const isKeyError = (error: ApiKeyError | undefined) =>
  error === 'shape' || error === 'anthropic' || error === 'rejected' || error === 'permission'

function Notices({
  status,
  error,
  provider,
}: {
  status: ApiKeysSearch['status']
  error: ApiKeysSearch['error']
  provider: Provider | undefined
}) {
  return (
    <>
      {status && (
        <Notice kind="success" data-testid="api-keys-saved">
          {API_KEY_STATUS_TEXT[status]}
        </Notice>
      )}
      {error && (
        <Notice kind="error" id={`${provider ?? 'page'}-key-error`} data-testid="api-keys-error">
          {apiKeyErrorText(error, provider)}
        </Notice>
      )}
    </>
  )
}

function ModelForm({ current }: { current: AiModelId }) {
  return (
    <form method="post" action="/account/api-keys" className="space-y-4">
      <input type="hidden" name="intent" value="model" />
      <fieldset>
        <legend className="text-[14.5px] leading-relaxed text-muted">
          Ask the book uses this model with your Anthropic key, and Anthropic bills you for it. Costs are rough.
        </legend>
        <div className="mt-3 space-y-2">
          {AI_MODELS.map((m) => (
            <ModelChoice
              key={m.id}
              testId="api-keys-model"
              id={m.id}
              name={m.name}
              description={m.description}
              checked={m.id === current}
              isDefault={m.id === DEFAULT_AI_MODEL}
            />
          ))}
        </div>
      </fieldset>
      <Button data-testid="api-keys-save-model">Save model</Button>
    </form>
  )
}

function SpeechModelForm({ current }: { current: SpeechModelId }) {
  return (
    <form
      id="speech-model"
      method="post"
      action="/account/api-keys"
      className="mt-6 space-y-4 border-t border-line pt-6"
    >
      <input type="hidden" name="intent" value="speech-model" />
      <fieldset>
        <legend className="text-[15px] font-medium text-ink">Voice model</legend>
        <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
          Prices are ElevenLabs’ pay-as-you-go rates; a subscription’s included characters cost less.
        </p>
        <div className="mt-3 space-y-2">
          {SPEECH_MODELS.map((m) => (
            <ModelChoice
              key={m.id}
              testId="api-keys-speech-model"
              id={m.id}
              name={m.name}
              description={speechModelDescription(m.id)}
              checked={m.id === current}
              isDefault={m.id === DEFAULT_SPEECH_MODEL}
            />
          ))}
        </div>
      </fieldset>
      <Button data-testid="api-keys-save-speech-model">Save voice model</Button>
    </form>
  )
}

function ModelChoice({
  testId,
  id,
  name,
  description,
  checked,
  isDefault,
}: {
  testId: string
  id: string
  name: string
  description: string
  checked: boolean
  isDefault: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-page px-4 py-3 transition has-[:checked]:border-accent has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15">
      <input
        type="radio"
        name="model"
        value={id}
        data-testid={testId}
        data-key={id}
        defaultChecked={checked}
        aria-describedby={`model-${id}-about`}
        className="mt-1 size-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">
          {name}
          {isDefault && <span className="font-normal text-muted"> (default)</span>}
        </span>
        <span id={`model-${id}-about`} className="block text-[13.5px] leading-relaxed text-muted">
          {description}
        </span>
      </span>
    </label>
  )
}

function UsageLine({ usage, model }: { usage: PageData['speechUsage']; model: SpeechModelId }) {
  return (
    <p className="mt-5 text-[14.5px] leading-relaxed text-muted" data-testid="speech-usage">
      {usage.characters > 0
        ? `Read aloud used ${usage.characters.toLocaleString('en-GB')} characters on this key in the last 30 days (about ${usd(usage.cost)} at ${speechModelName(model)}’s pay-as-you-go price).`
        : 'Read aloud hasn’t used this key in the last 30 days.'}
    </p>
  )
}

const ABOUT: Record<Provider, ReactNode> = {
  anthropic: null,
  elevenlabs: (
    <p className="mb-4 text-[14.5px] leading-relaxed text-muted">
      ElevenLabs voices read books aloud in Read aloud, on your key.
    </p>
  ),
}

const NOTE: Record<Provider, ReactNode> = {
  anthropic: null,
  elevenlabs: (
    <p className="text-[13.5px] leading-relaxed text-muted">
      Create a key in ElevenLabs under Developers → API keys. It needs Text to Speech and Voices (read). On ElevenLabs’
      free plan, what it speaks is for your own non-commercial use.
    </p>
  ),
}

function ProviderKey({
  entry,
  invalid,
  children,
  after,
}: {
  entry: KeyEntry
  invalid: boolean
  children?: ReactNode
  after?: ReactNode
}) {
  const name = PROVIDER_NAMES[entry.provider]
  return (
    <Section id={entry.provider} title={name}>
      {children && <div className="-mt-6 mb-5">{children}</div>}
      {entry.saved ? (
        <SavedKey provider={entry.provider} name={name} saved={entry.saved} invalid={invalid} />
      ) : (
        <>
          {ABOUT[entry.provider]}
          <KeyForm provider={entry.provider} label={`${name} API key`} invalid={invalid} />
        </>
      )}
      {after}
    </Section>
  )
}

function SavedKey({
  provider,
  name,
  saved,
  invalid,
}: {
  provider: Provider
  name: string
  saved: NonNullable<KeyEntry['saved']>
  invalid: boolean
}) {
  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
        <div className="min-w-0 flex-1 text-[14.5px]">
          <p className="font-mono text-ink" data-testid="saved-key">
            {provider === 'anthropic' ? 'sk-ant-' : ''}…{saved.last4}
          </p>
          <p className="text-muted">
            Saved <DateTime iso={saved.createdAt} /> ·{' '}
            {saved.lastUsedAt ? (
              <>
                last used <DateTime iso={saved.lastUsedAt} />
              </>
            ) : (
              'not used yet'
            )}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-start gap-2">
        <details className="group basis-full">
          <summary
            data-testid="api-keys-replace"
            data-key={provider}
            className="inline-flex h-11 cursor-pointer list-none items-center rounded-full border border-line px-5 text-[14.5px] font-medium text-ink transition hover:border-accent hover:text-accent group-open:hidden [&::-webkit-details-marker]:hidden"
          >
            Replace
          </summary>
          <KeyForm provider={provider} label={`New ${name} API key`} invalid={invalid} />
        </details>
        <DeleteKeyForm provider={provider} />
      </div>
    </>
  )
}

function SavedKeyToDelete({ saved }: { saved: NonNullable<KeyEntry['saved']> }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      <KeyRound className="size-5 shrink-0 text-subtle" aria-hidden />
      <p className="min-w-0 flex-1 font-mono text-[14.5px] text-ink" data-testid="saved-key">
        …{saved.last4}
      </p>
      <DeleteKeyForm provider="elevenlabs" />
    </div>
  )
}

function DeleteKeyForm({ provider }: { provider: Provider }) {
  return (
    <form method="post" action="/account/api-keys">
      <input type="hidden" name="intent" value="delete" />
      <input type="hidden" name="provider" value={provider} />
      <Button variant="danger" data-testid="api-keys-delete" data-key={provider}>
        Delete
      </Button>
    </form>
  )
}

function KeyForm({ provider, label, invalid }: { provider: Provider; label: string; invalid: boolean }) {
  return (
    <form method="post" action="/account/api-keys" className="space-y-4">
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="provider" value={provider} />
      <TextField
        id={`${provider}-key`}
        label={label}
        name="key"
        data-testid="api-keys-key"
        data-key={provider}
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        maxLength={300}
        placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'Your ElevenLabs API key'}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${provider}-key-error` : undefined}
      />
      {NOTE[provider]}
      <Button data-testid="api-keys-save" data-key={provider}>
        {provider === 'anthropic' ? 'Save' : 'Save key'}
      </Button>
    </form>
  )
}
