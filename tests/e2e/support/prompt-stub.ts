/** What the Anthropic and OpenAI stubs read from Folio's prompts, which the server builds the same for either. */

const asText = (content: unknown) => (typeof content === 'string' ? content : '')

/** The kind of request a reader's message makes, such as a quiz, from its `<request kind>` tag. */
export const requestKind = (last: unknown) => /<request kind="(\w+)">/.exec(asText(last))?.[1]

/** What the reader's last message sent besides the book, as the stubs' answers repeat it after "pages of the book". */
export function sentBesidesTheBook(last: unknown): string {
  const text = asText(last)
  const quoted = text.includes('<passage>') ? ' and the passage you selected' : ''
  const highlights = text.includes('<highlights>')
    ? ` and ${text.match(/<highlight /g)?.length ?? 0} of your highlights`
    : ''
  const kind = requestKind(text)
  const prompt = /<reader-prompt>\n([\s\S]*?)\n<\/reader-prompt>/.exec(text)?.[1]
  const request =
    (kind ? ` Request: ${kind}.` : '') + (prompt === undefined ? '' : ` Prompt: ${[...prompt].slice(0, 40).join('')}.`)
  return `${quoted}${highlights}.${request} `
}

interface TranslationAsk {
  to: string
  text: string
  context: string | null
}

const unescaped = (t: string) => t.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

/** A translate request's target language, from its instructions, and its text and context, from its one message. */
export function translationAsk(instructions: unknown, message: unknown): TranslationAsk {
  const content = String(message ?? '')
  const text = /<text>\n([\s\S]*?)\n<\/text>/.exec(content)?.[1]
  const context = /<context>\n([\s\S]*?)\n<\/context>/.exec(content)?.[1]
  return {
    to: / \(([\w-]+)\)\. If it is a single word/.exec(String(instructions))?.[1] ?? '',
    text: unescaped(text ?? ''),
    context: context === undefined ? null : unescaped(context),
  }
}

/** The stubs' translation: the text tagged with its language, then, when it came with a context, a Sense line. */
export const translated = ({ to, text, context }: TranslationAsk) =>
  `[${to}] ${text}${context ? `\nSense: ${context.split(/\s+/)[0]}` : ''}`
