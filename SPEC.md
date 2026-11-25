# Spec: OpenAI API key for Ask and Translate — V1

Status: approved (2026-11-24)

## Objective

Pro users can save their own OpenAI API key on `/account/api-keys` and pick a GPT model. Ask the book and Translate/Explain then run on that model, using that key, and OpenAI bills the user directly. Today these features need an Anthropic key and a Claude model. Afterwards, a reader who only has an OpenAI account can use them too.

**Users:** Pro readers who already pay for OpenAI, or prefer it, and don't want to open an Anthropic account.

**Decided with the user:**
- The key powers **Ask and Translate**, not read aloud.
- GPT answers in Ask **have no page links**, because OpenAI has nothing like Claude's citations. **Quizzes and flashcards stay Claude-only**, since their source pages come from citations.
- The key is **Pro only**, like the Anthropic and ElevenLabs keys.
- Users **choose their GPT model**, just as they choose their Claude model today: several GPT models (a capable one, a fast and cheap one, and so on), not one fixed model. They're all in the **one shared "Model for agent features" list**, and the model picked decides the key.

### User stories / acceptance criteria

1. **Save a key.** On `/account/api-keys` a Pro user sees an "OpenAI" section next to the Anthropic one. They paste a key, Folio checks it with OpenAI, then stores it encrypted, showing only `sk-…last4`, when it was saved and when it was last used. Replace and Delete work as they do for Anthropic. A free user sees the section locked behind the Pro notice; if they still have a key saved from before, they can delete it but not save one.
2. **Reject bad keys.** If the key isn't shaped like an OpenAI key, the user sees a format error. If they paste an Anthropic key (`sk-ant-…`) into the OpenAI form, the error says so, and the Anthropic form gives the opposite warning for an OpenAI key. If OpenAI rejects the key, they see "rejected". If OpenAI can't be reached, they see "unavailable". The `api-key` quota limit applies.
3. **Pick a model.** The one "Model for agent features" list shows the Claude models and a choice of GPT models, each labelled with its provider and with a rough cost line, as the Claude models have. The user picks any one, and it's saved in `users.ai_model` as today. The model chosen decides which key is used. If no key is saved for the chosen model's provider, the list says so next to the model, but it can still be saved.
4. **Ask on GPT.** With a GPT model chosen and an OpenAI key saved, Ask streams the answer the same way it does for Claude, but with no citation events. The panel shows the GPT model's name. The privacy note under the box says the text goes to **OpenAI**. Asking from a quote, whole-book questions, highlights, saved prompts and spoken questions all work the same as on Claude.
5. **Quizzes and flashcards stay on Claude.** With a GPT model chosen, the Quiz and Flashcards actions are still visible but disabled, with a short reason: they need a Claude model. The server refuses them with `409 needs_claude`. In this version they never fall back to Claude quietly, even when an Anthropic key is also saved.
5a. **A book too long for the model.** Ask keeps its current context budget for every model. If OpenAI refuses a request because it exceeds the model's context window, the user gets the existing `too_long` error, naming OpenAI.
6. **Translate on GPT.** With a GPT model chosen, Translate/Explain uses the same prompt and output rules as today, on the OpenAI key. The card says "Translated by <GPT model> with your OpenAI key."
7. **Errors name the right provider.** For a missing key, a rejected key, billing or quota problems, a busy service and a too-long book, the messages in Ask and Translate name OpenAI when the request went to OpenAI, using the existing error codes.
8. **Usage records stay the same.** The `ask` and `translate` quota records keep `model`, `servedBy` and token counts, and gain `provider: 'openai' | 'anthropic'`.
9. **Nothing leaks.** OpenAI keys never appear in logs: `redact.ts` masks them as it masks `sk-ant-` keys. Rotating the encryption key (KEK) re-encrypts OpenAI keys. The account-data export lists an OpenAI key's status the same way it lists the others.

## Tech Stack

The stack stays as it is: TanStack Start, React 19, Postgres, Vitest, Playwright and Biome. The only addition is the OpenAI client, as decided with the user:
- **The official `openai` npm SDK** (approved as a new dependency), used the way `@anthropic-ai/sdk` is used: an injected `fetch` and `baseURL`, a request timeout, and no SDK logging.
- **The Responses API** (`client.responses.create` / `client.responses.stream`), not Chat Completions. The version is pinned with an exact `package.json` entry, as `vitest` and `shiki` are.

## Commands

```
Install:     pnpm install
Dev:         pnpm dev
Unit tests:  pnpm test
DB tests:    pnpm test:db
Typecheck:   pnpm typecheck
Lint / fix:  pnpm lint / pnpm lint:fix
All checks:  pnpm check
Build:       pnpm build
E2E:         pnpm e2e:local
Migrate:     pnpm db:migrate
```

## Project Structure (what this touches)

```
db/migrations/0028_openai_keys.sql      NEW: widen api_keys_provider_check to ('anthropic','elevenlabs','openai')
src/server/openai.ts                    NEW: checkOpenAiKey, isOpenAiKeyShape, client factory, error mapping
src/server/openai.test.ts               NEW
src/server/api-keys.ts                  Provider += 'openai'; PROVIDERS
src/server/config.ts (+ test)           openAiApiBase from OPENAI_API_BASE (default https://api.openai.com)
src/server/redact.ts (+ test)           also mask OpenAI keys
src/server/account-actions.ts           shape and check for 'openai'; Pro gate on save; cross-provider shape hints
src/shared/lib/ai-models.ts             each model gains provider: 'anthropic' | 'openai'; GPT entries; providerOf(id)
src/server/ask/ask.ts                   choose the key and client from the model's provider; needs_claude refusal
src/server/ask/openai-stream.ts (+test) NEW: map OpenAI stream events to the existing AskEvent ndjson
src/server/ask/setup.ts                 report the keys saved per provider, and the provider of the chosen model
src/server/lookup/translate.ts          OpenAI path for runTranslation
src/server/lookup/actions.ts            key check follows the model's provider
src/shared/ask/events.ts                AskRefusal / error codes += 'needs_claude' (where shared)
src/routes/account/api-keys.tsx         OpenAI section, provider labels in the model list
src/client/features/account/account-messages.ts (+test)   OpenAI shape and cross-provider errors
src/client/features/ask/ask-problems.ts (+test)           messages that name the provider; needs_claude
src/client/features/ask/AskPanel.tsx                      provider in the privacy note; study actions disabled on GPT
src/client/features/lookup/lookup-messages.ts (+test), LookupCard.tsx   messages that name the provider
src/shared/plans/plans.ts, copy.ts; src/client/features/home/{Faq,Features,PricingSection}.tsx;
src/routes/privacy.tsx                  copy: "your own Anthropic or OpenAI key"
tests/e2e/support/openai-stub.ts        NEW, modelled on anthropic-stub.ts; wired in test-server.ts and playwright.config.ts
tests/e2e/specs/{account,ask,lookup}.spec.ts   OpenAI cases
```

No column changes: `users.ai_model` has no check constraint and already stores any model id. An unknown id falls back to the default, as it does today.

## Code Style

Follow the existing per-provider pattern: a provider module with a shape check and a live check, and the provider chosen by data rather than by `if` chains spread through callers. For example:

```ts
// src/shared/lib/ai-models.ts
export type AiProvider = 'anthropic' | 'openai'
export const AI_MODELS = [
  { id: 'claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5', description: '…' },
  // …
  { id: '<gpt-model-id>', provider: 'openai', name: '<GPT name>', description: '…' },
] as const
export const providerOf = (id: AiModelId): AiProvider => AI_MODELS.find((m) => m.id === id)?.provider ?? 'anthropic'
```

```ts
// src/server/openai.ts: mirrors checkAnthropicKey
export async function checkOpenAiKey(key: string, apiBase: string, fetchFn: typeof fetch = fetch) {
  // GET {apiBase}/v1/models with Authorization: Bearer; 200 → valid, 401/403 → rejected, else unavailable
}
export function isOpenAiKeyShape(key: string): boolean {
  return key.startsWith('sk-') && !key.startsWith('sk-ant-') && key.length >= 20 && key.length <= 300 && !/\s/.test(key)
}
```

Conventions: `.ts` import suffixes on the server; `import '@tanstack/react-start/server-only'` in server modules; injectable `fetch` for tests; no logging of keys or prompts; user-facing copy written in the existing voice (British spelling, curly apostrophes).

## Testing Strategy

- **Unit (Vitest, colocated `*.test.ts`):** `isOpenAiKeyShape` (good keys, `sk-ant-` keys and keys with spaces rejected); `checkOpenAiKey` against a fake `fetch` (200, 401, 403, 500, network error); mapping OpenAI errors to `key_rejected`, `billing` (insufficient quota), `busy` (rate limit, 5xx), `too_long` (context length) and `failed`; mapping stream events to `text`, `done` and `error` with no citation events; `providerOf`; `redact` masking OpenAI keys; client messages naming the provider.
- **DB tests (`*.db.test.ts`):** the migration widens the check; save, delete and rotate work for an `openai` row; free users can't save an OpenAI key; Ask and Translate pick the key that matches the model, refuse with `no_key` when it's missing and with `needs_claude` for study actions on GPT; quota records include `provider`.
- **E2E (Playwright):** an OpenAI stub served from the test server, like `anthropic-stub.ts`. Account: save, replace and delete an OpenAI key, and see the errors for a rejected key and for an Anthropic key in the wrong form. Ask: choose a GPT model, get a streamed answer with no page links, and see Quiz and Flashcards disabled. Lookup: translate with GPT, and see the "with your OpenAI key" line.
- **Coverage:** `pnpm coverage:ratchet` must not drop; new server and shared modules are covered on their changed lines (`pnpm coverage:changed`).
- **Before calling it done:** `pnpm check`, `pnpm test:db` and `pnpm e2e:local` pass.

## Boundaries

- **Always:** store OpenAI keys only through `saveKey` (AES-GCM sealed, with associated data `(userId, 'openai')`); check every key live before saving it; keep keys and prompt text out of logs and audit details; gate on `canUse(plan, 'ask' | 'translate')` on the server; keep Claude behaviour identical for users who don't switch; write the migration so a rollback is safe (only widen the check).
- **Ask first:** adding any dependency other than `openai`; the exact GPT model ids, names and cost lines; changing the default model; changing the `api-key`, `ask` or `translate` quota limits; letting quizzes and flashcards fall back to Claude.
- **Never:** send a user's key to any host other than the configured OpenAI API base; use Folio's own OpenAI key for user requests; quietly switch providers when a key is missing or rejected; delete or rewrite existing `api_keys` rows in the migration; weaken existing tests or coverage thresholds to get green.

## Success Criteria

- [ ] A Pro user can save, replace and delete an OpenAI key. A free user can't save one, but can delete an existing one.
- [ ] Wrong-format keys, Anthropic keys in the OpenAI form, and keys OpenAI rejects are all refused before saving, each with its own message.
- [ ] Choosing a GPT model makes Ask stream an answer through the OpenAI API on the user's key, with no citation events and the same `done` and `error` handling.
- [ ] With a GPT model chosen, Quiz and Flashcards are disabled in the UI and refused with `409 needs_claude` by the server.
- [ ] With a GPT model chosen, Translate/Explain returns a translation through OpenAI and credits the GPT model and the user's OpenAI key.
- [ ] Every user-facing error and privacy line names the provider that actually received the request.
- [ ] `ask` and `translate` usage records include `provider`; token counts are filled in from OpenAI's usage fields.
- [ ] Logs mask OpenAI keys; KEK rotation and the account-data export cover `openai` rows.
- [ ] **Unchanged:** the Claude path for Ask, study and Translate (same requests, same events, same tests passing), and the ElevenLabs path.
- [ ] `pnpm check`, `pnpm test:db` and `pnpm e2e:local` are green, and coverage does not drop.

## Out of Scope (Deferred)

- **Page links for GPT answers** (prompting for page markers and parsing them): it is less reliable and much more work. Revisit if users miss the links.
- **Quizzes and flashcards on GPT:** they depend on citations for their source pages.
- **OpenAI voices for read aloud:** a separate speech-provider change.
- **A separate model choice per key or per feature** (a Claude model saved and a GPT model saved, with a provider switch between them): ruled out in favour of one shared list, so there's a single model setting.
- **Quietly falling back to the other provider when one key fails.**
- **Other providers** (Gemini, Mistral, OpenAI-compatible endpoints): the per-provider structure should make them easy later.
- **A context budget per model** in `context.ts`: V1 relies on the `too_long` error. Revisit if GPT users hit it often on long books.

## Decisions (resolved questions)

1. **GPT models:** offer a choice of GPT models in the shared list; Claude Opus stays the overall default. **Still open for planning:** the exact ids, names and cost lines. I'll read OpenAI's current model list and propose two or three for approval. Ids and prices won't be guessed.
2. **Client:** the official `openai` SDK (dependency approved).
3. **API:** the Responses API.
4. **Quizzes and flashcards on GPT:** disabled with a reason; no quiet fallback to Claude.
5. **Long books:** keep the current context budget; OpenAI's context-length refusal maps to `too_long`. A budget per model is deferred.
