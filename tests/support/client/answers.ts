/**
 * A refusal as the server sends it: `{ error: <code> }`, with whatever else that code carries, such as a `retryAt` or
 * a `max`. A fake answer typed with a contract's error codes, as in
 * `{ error: 'not_found' } satisfies ErrorAnswer<ArticleErrorCode>`, stops `pnpm typecheck` when the contract renames or
 * drops that code, so a test can't stay green on an answer the server no longer sends.
 */
export type ErrorAnswer<Code extends string> = { error: Code } & Record<string, unknown>
