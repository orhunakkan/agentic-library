import type { CSSProperties } from 'react'
import { cn } from '~/client/lib/cn'
import {
  type CodeTokens,
  FONT_BOLD,
  FONT_ITALIC,
  FONT_STRIKETHROUGH,
  FONT_UNDERLINE,
} from '~/shared/github-repos/md-node'

function Runs({ code, line }: { code: CodeTokens; line: CodeTokens['lines'][number] }) {
  return line.map(([text, colour, style], i) => {
    const [light, dark] = code.palette[colour] ?? ['inherit', 'inherit']
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: runs are fixed for a render and have no identity of their own.
        key={i}
        className={cn(
          'repo-tok',
          (style & FONT_ITALIC) !== 0 && 'italic',
          (style & FONT_BOLD) !== 0 && 'font-bold',
          (style & FONT_UNDERLINE) !== 0 && 'underline',
          (style & FONT_STRIKETHROUGH) !== 0 && 'line-through',
        )}
        style={{ '--l': light, '--d': dark } as CSSProperties}
      >
        {text}
      </span>
    )
  })
}

export function codeText(code: CodeTokens): string {
  return code.lines.map((line) => line.map(([text]) => text).join('')).join('\n')
}

export function CodeLines({ code, 'data-testid': testId }: { code: CodeTokens; 'data-testid': string }) {
  const gutter = `${Math.max(3, String(code.lines.length).length)}ch`
  return (
    <div className="repo-code repo-lines" style={{ '--gutter': gutter } as CSSProperties} data-testid={testId}>
      {code.lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's number is its identity.
        <div key={i} className="repo-line" data-n={i + 1}>
          <span>
            <Runs code={code} line={line} />
            {line.length === 0 && '\n'}
          </span>
        </div>
      ))}
    </div>
  )
}

export function CodeFence({
  code,
  lang,
  runnable = false,
}: {
  code: CodeTokens
  lang: string | null
  runnable?: boolean
}) {
  return (
    <pre
      className="repo-code repo-fence"
      data-lang={lang ?? undefined}
      style={runnable ? { paddingRight: '5.5rem' } : undefined}
    >
      <code>
        {code.lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line's number is its identity.
          <span key={i}>
            <Runs code={code} line={line} />
            {i < code.lines.length - 1 && '\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}
