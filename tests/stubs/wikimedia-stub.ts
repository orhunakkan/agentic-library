import { readFileSync } from 'node:fs'

const json = (name: string) =>
  JSON.parse(readFileSync(new URL(`./wikimedia/${name}.json`, import.meta.url)).toString('utf8')) as unknown

export const STUB_TERMS = { busy: 'Morris', broken: 'Long' } as const

const DEFINITIONS: Record<string, string> = {
  entail: 'definition-entail',
  entailed: 'definition-entailed',
  bientôt: 'definition-bientot',
  chaise: 'definition-chaise',
  acknowledged: 'definition-acknowledged',
  acknowledge: 'definition-acknowledge',
  however: 'definition-however',
  Netherfield: 'definition-netherfield-proper',
}

const SUMMARIES: Record<string, string> = {
  'en/Hertfordshire': 'summary-hertfordshire',
  'en/Bennet': 'summary-bennet',
  'en/Chaise': 'summary-chaise',
  'en/Michaelmas': 'summary-michaelmas',
  'en/Netherfield': 'summary-netherfield',
  'fr/Paris': 'summary-fr-paris',
}

const missing = () => Response.json({ status: 404, type: 'Internal error' }, { status: 404 })

const titleOf = (segment: string) => decodeURIComponent(segment).replaceAll('_', ' ')

export async function wikimediaStub(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (!/^Folio \(/.test(request.headers.get('user-agent') ?? '')) return new Response('No User-Agent', { status: 403 })
  const definition = /\/wiktionary\/api\/rest_v1\/page\/definition\/([^/]+)$/.exec(url.pathname)
  const summary = /\/wikipedia\/([a-z]{2,3})\/api\/rest_v1\/page\/summary\/([^/]+)$/.exec(url.pathname)
  const term = definition ? titleOf(definition[1] as string) : summary ? titleOf(summary[2] as string) : null
  if (term === null) return new Response('Not found', { status: 404 })

  if (term === STUB_TERMS.busy) return new Response('Too many requests', { status: 503 })
  if (term === STUB_TERMS.broken) return new Response('Error', { status: 500 })
  if (definition && term === 'Redirected') return new Response(null, { status: 302, headers: { location: 'chaise' } })

  if (definition) {
    const saved = DEFINITIONS[term]
    return saved ? Response.json(json(saved)) : missing()
  }
  const lang = (summary as RegExpExecArray)[1] as string
  const capitalised = term.charAt(0).toUpperCase() + term.slice(1)
  const saved = SUMMARIES[`${lang}/${capitalised}`]
  return saved ? Response.json(json(saved)) : missing()
}
