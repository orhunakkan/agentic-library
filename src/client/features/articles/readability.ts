import { Readability } from '@mozilla/readability'
import { codeLang } from '~/shared/run-code/langs'
import type { ReadabilityResult } from './article-draft'

const OPTIONS = { charThreshold: 500, keepClasses: false }

export function readArticle(html: string, finalUrl: string): ReadabilityResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const base = doc.createElement('base')
  base.setAttribute('href', finalUrl)
  doc.head.prepend(base)
  for (const pre of doc.querySelectorAll('pre')) {
    const code = pre.children.length === 1 && pre.firstElementChild?.tagName === 'CODE' ? pre.firstElementChild : null
    const lang = codeLang(code ? [pre, code] : [pre])
    if (lang) pre.setAttribute('data-code-language', lang)
  }
  const pageTitle = doc.title
  const result = new Readability(doc, OPTIONS).parse()
  if (!result) return null
  const { title, byline, content, excerpt, siteName, lang, publishedTime } = result
  return { title, byline, content, excerpt, siteName, lang, publishedTime, pageTitle }
}
