import { ImageOff } from 'lucide-react'
import { createElement, Fragment, type ReactNode, useContext } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { type RunCode, RunCodeContext, RunOpenButton } from '~/client/features/run-code/RunButtons'
import type { AlertKind, FrontMatterField, MdNode } from '~/shared/github-repos/md-node'
import { isMdTag } from '~/shared/github-repos/md-node'
import { fenceLang } from '~/shared/run-code/langs'
import { CodeFence, codeText } from './CodeView'
import { repoHref, repoRawHref } from './repos-client'

const ALERT_TITLE: Record<AlertKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

interface Context {
  repoId: string
  showExternal: boolean
  run: RunCode | null
  fences: { count: number }
}

function render(nodes: readonly MdNode[], context: Context): ReactNode {
  // biome-ignore lint/suspicious/noArrayIndexKey: a rendered file's nodes are fixed for its render; their order is their identity.
  return nodes.map((node, i) => <Fragment key={i}>{renderNode(node, context)}</Fragment>)
}

function renderNode(node: MdNode, context: Context): ReactNode {
  switch (node.t) {
    case 'text':
      return node.v
    case 'task':
      return (
        <input type="checkbox" checked={node.checked} disabled readOnly aria-label="Task" data-testid="repo-md-task" />
      )
    case 'code': {
      const { run } = context
      const lang = run ? fenceLang(node.lang) : null
      if (!run || !lang) return <CodeFence code={node.code} lang={node.lang} />
      const n = ++context.fences.count
      return (
        <div className="relative">
          <CodeFence code={node.code} lang={node.lang} runnable />
          <RunOpenButton
            lang={lang}
            n={n}
            tone="site"
            onOpen={(opener) => run.open({ lang, code: codeText(node.code), key: `fence-${n}`, opener })}
          />
        </div>
      )
    }
    case 'alert':
      return (
        <div className="repo-alert" data-kind={node.kind}>
          <p className="repo-alert-title">{ALERT_TITLE[node.kind]}</p>
          {render(node.c, context)}
        </div>
      )
    case 'link': {
      const children = render(node.c, context)
      const { to } = node
      if (to.kind === 'external')
        return (
          <a
            href={to.href}
            title={node.title}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-testid="repo-md-link"
          >
            {children}
          </a>
        )
      if (to.kind === 'anchor')
        return (
          <a href={`#${to.id}`} title={node.title} data-testid="repo-md-link">
            {children}
          </a>
        )
      return (
        <AppLink
          href={repoHref(context.repoId, to.path, 'preview', to.anchor)}
          title={node.title}
          data-testid="repo-md-link"
        >
          {children}
        </AppLink>
      )
    }
    case 'img': {
      const size = { width: node.width, height: node.height, align: node.align }
      if (node.source.kind === 'repo')
        return (
          <img
            src={repoRawHref(context.repoId, node.source.path)}
            alt={node.alt}
            title={node.title}
            loading="lazy"
            {...size}
          />
        )
      if (context.showExternal)
        return (
          <img
            src={node.source.src}
            alt={node.alt}
            title={node.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            {...size}
          />
        )
      return (
        <span
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1 align-middle text-[13px] text-muted"
          data-testid="repo-external-image"
        >
          <ImageOff className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {node.alt || 'Picture'} <span className="text-subtle">({node.source.host})</span>
          </span>
        </span>
      )
    }
    case 'el': {
      if (!isMdTag(node.tag)) return render(node.c, context)
      const { attrs = {} } = node
      const props: Record<string, unknown> = {
        id: attrs.id,
        title: attrs.title,
        align: attrs.align,
        colSpan: attrs.colSpan,
        rowSpan: attrs.rowSpan,
        open: attrs.open,
        start: attrs.start,
      }
      if (node.tag === 'summary') props['data-testid'] = 'repo-md-summary'
      if (node.tag === 'br' || node.tag === 'hr') return createElement(node.tag, props)
      return createElement(node.tag, props, render(node.c, context))
    }
  }
}

function FrontMatter({ fields }: { fields: readonly FrontMatterField[] }) {
  return (
    <table data-testid="repo-front-matter">
      <tbody>
        {fields.map((field) => (
          <tr key={field.key}>
            <th scope="row">{field.key}</th>
            <td>{field.yaml ? <pre>{field.value}</pre> : field.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function MdView({
  repoId,
  nodes,
  frontMatter,
  showExternal,
}: {
  repoId: string
  nodes: readonly MdNode[]
  frontMatter: readonly FrontMatterField[]
  showExternal: boolean
}) {
  const run = useContext(RunCodeContext)
  return (
    <div className="repo-md">
      {frontMatter.length > 0 && <FrontMatter fields={frontMatter} />}
      {render(nodes, { repoId, showExternal, run, fences: { count: 0 } })}
    </div>
  )
}
