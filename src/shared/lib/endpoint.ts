/** How a JSON endpoint refuses: an error code, with whatever extras that code carries. */
export interface ErrorAnswer {
  error: string
}

/**
 * One JSON endpoint, defined once for server and client: its path, the parser the server runs on its
 * body, and, as types only, the body the client sends, the answer it gets back and how it is refused.
 */
export interface Endpoint<Body, Input, Answer, Refusal extends ErrorAnswer> {
  path: string
  parse: (value: unknown) => Input | null
  /** Never set: it carries the body, answer and refusal types from the definition to its callers. */
  readonly types?: { body: Body; answer: Answer; refusal: Refusal }
}

/** Defines an endpoint: `endpoint<Body, Answer, Refusal>()({ path, parse })`. */
export const endpoint =
  <Body, Answer, Refusal extends ErrorAnswer>() =>
  <Input>(definition: Pick<Endpoint<Body, Input, Answer, Refusal>, 'path' | 'parse'>) =>
    definition as Endpoint<Body, Input, Answer, Refusal>
