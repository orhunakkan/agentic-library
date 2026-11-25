import '@tanstack/react-start/server-only'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { type BundledLanguage, bundledLanguages } from 'shiki/langs'
import type { CodeTokens } from '../../shared/github-repos/md-node.ts'
import { KB } from '../../shared/import/limits.ts'

export const HIGHLIGHT_MAX_BYTES = 256 * KB
export const HIGHLIGHT_MAX_LINES = 10_000
const MAX_LINE_LENGTH = 5000

const LIGHT = 'github-light-default'
const DARK = 'github-dark-default'

const BY_NAME = new Map([
  ['dockerfile', 'docker'],
  ['containerfile', 'docker'],
  ['makefile', 'make'],
  ['gnumakefile', 'make'],
  ['cmakelists.txt', 'cmake'],
  ['justfile', 'just'],
  ['gemfile', 'ruby'],
  ['rakefile', 'ruby'],
  ['podfile', 'ruby'],
  ['vagrantfile', 'ruby'],
  ['brewfile', 'ruby'],
  ['codeowners', 'codeowners'],
  ['.gitignore', 'codeowners'],
  ['.dockerignore', 'codeowners'],
  ['.npmignore', 'codeowners'],
  ['.prettierignore', 'codeowners'],
  ['.eslintignore', 'codeowners'],
  ['.env', 'dotenv'],
  ['.bashrc', 'shellscript'],
  ['.zshrc', 'shellscript'],
  ['.profile', 'shellscript'],
  ['.bash_profile', 'shellscript'],
  ['.editorconfig', 'ini'],
  ['.gitconfig', 'ini'],
  ['.npmrc', 'ini'],
  ['go.mod', 'go'],
])

const BY_EXTENSION = new Map([
  ['h', 'c'],
  ['hpp', 'cpp'],
  ['hh', 'cpp'],
  ['hxx', 'cpp'],
  ['cc', 'cpp'],
  ['cxx', 'cpp'],
  ['htm', 'html'],
  ['xhtml', 'html'],
  ['svg', 'xml'],
  ['plist', 'xml'],
  ['csproj', 'xml'],
  ['pyi', 'python'],
  ['ex', 'elixir'],
  ['exs', 'elixir'],
  ['cfg', 'ini'],
  ['ipynb', 'json'],
  ['markdown', 'markdown'],
  ['mkd', 'markdown'],
  ['bash', 'shellscript'],
  ['ksh', 'shellscript'],
  ['gradle', 'groovy'],
  ['kts', 'kotlin'],
  ['m', 'objective-c'],
  ['mm', 'objective-cpp'],
])

const isBundled = (id: string): id is BundledLanguage => Object.hasOwn(bundledLanguages, id)

export function languageForFence(info: string): string | null {
  const id = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!id) return null
  if (isBundled(id)) return id
  return BY_EXTENSION.get(id) ?? null
}

export function languageFor(fileName: string): string | null {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1).toLowerCase()
  const named = BY_NAME.get(name) ?? (name.startsWith('.env.') ? 'dotenv' : undefined)
  if (named) return named
  if (name.startsWith('dockerfile.')) return 'docker'
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1)
  if (isBundled(extension)) return extension
  return BY_EXTENSION.get(extension) ?? null
}

let highlighter: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<boolean>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light-default.mjs'), import('shiki/themes/github-dark-default.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighter
}

function loadLanguage(core: HighlighterCore, lang: string): Promise<boolean> {
  let pending = loading.get(lang)
  if (!pending) {
    pending = isBundled(lang)
      ? core.loadLanguage(bundledLanguages[lang]).then(
          () => true,
          () => false,
        )
      : Promise.resolve(false)
    loading.set(lang, pending)
  }
  return pending
}

const splitLines = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')

async function plain(text: string): Promise<CodeTokens> {
  const core = await getHighlighter()
  const palette: [string, string][] = [[core.getTheme(LIGHT).fg, core.getTheme(DARK).fg]]
  return { palette, lines: splitLines(text).map((line) => (line ? [[line, 0, 0]] : [])), highlighted: false }
}

export function withinHighlightCaps(text: string): boolean {
  if (Buffer.byteLength(text, 'utf8') > HIGHLIGHT_MAX_BYTES) return false
  let lines = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1))
    if (++lines > HIGHLIGHT_MAX_LINES) return false
  return true
}

export async function highlight(text: string, lang: string | null): Promise<CodeTokens> {
  if (!lang || !withinHighlightCaps(text)) return plain(text)
  const core = await getHighlighter()
  if (!(await loadLanguage(core, lang))) return plain(text)
  const tokens = core.codeToTokensWithThemes(splitLines(text).join('\n'), {
    lang,
    themes: { light: LIGHT, dark: DARK },
    tokenizeMaxLineLength: MAX_LINE_LENGTH,
  })
  const palette: [string, string][] = []
  const index = new Map<string, number>()
  const colour = (light: string, dark: string) => {
    const key = `${light} ${dark}`
    let at = index.get(key)
    if (at === undefined) {
      at = palette.length
      palette.push([light, dark])
      index.set(key, at)
    }
    return at
  }
  const fallback: [string, string] = [core.getTheme(LIGHT).fg, core.getTheme(DARK).fg]
  const lines = tokens.map((line) => {
    const runs: [string, number, number][] = []
    for (const token of line) {
      const light = token.variants.light
      const dark = token.variants.dark
      const at = colour(light?.color ?? fallback[0], dark?.color ?? fallback[1])
      const style = Math.max(0, light?.fontStyle ?? 0)
      const last = runs[runs.length - 1]
      if (last && last[1] === at && last[2] === style) last[0] += token.content
      else runs.push([token.content, at, style])
    }
    return runs
  })
  return { palette, lines, highlighted: true }
}
