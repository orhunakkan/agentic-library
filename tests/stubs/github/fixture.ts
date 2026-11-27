import { readFileSync } from 'node:fs'

const picture = new Uint8Array(readFileSync(new URL('../../fixtures/images/tiny.png', import.meta.url)))

export interface FixtureFile {
  content?: string | Uint8Array
  size?: number
  mode?: string
  submodule?: boolean
}

export interface FixtureRepo {
  id: number
  owner: string
  name: string
  defaultBranch: string
  description: string | null
  refs: Record<string, number>
  tags?: Record<string, number>
  commits: { sha: string; files: Record<string, FixtureFile> }[]
  visibility?: 'private'
  rateLimited?: boolean
  truncated?: boolean
  empty?: boolean
  renamedFrom?: string[]
}

const README = `---
title: Sample repository
tags:
  - fixture
  - test
---

# Sample repository

> [!NOTE]
> This repository is a fixture for Folio's tests.

| Name | Kind |
| --- | --- |
| guide | Markdown |
| index | TypeScript |

![The Folio logo](docs/img/logo.png)

![Build passing](https://img.shields.io/badge/build-passing-green)

Read the [guide](docs/guide.md#install) to start. :rocket:
`

const GUIDE = `# Guide

Back to the [README](../README.md).

## Install

Run \`pnpm install\`, then:

\`\`\`ts
export const greeting: string = 'hello'
\`\`\`
`

const INDEX = `// The entry point.
export function add(a: number, b: number): number {
  return a + b
}

export const answer = add(40, 2)
`

const HELLO = `const name = 'Folio'
console.log(\`Hello, \${name}!\`)
`

const SAMPLE_FILES: Record<string, FixtureFile> = {
  'README.md': { content: README },
  'docs/guide.md': { content: GUIDE },
  'docs/img/logo.png': { content: picture },
  'src/index.ts': { content: INDEX },
  'examples/hello.js': { content: HELLO },
  'src/data.bin': { content: new Uint8Array([0, 1, 2, 3, 0, 255]) },
  'assets/huge.bin': { size: Math.round(2.4 * 1024 * 1024) },
  'assets/poster.png': { size: 6 * 1024 * 1024 },
  'models/weights.bin': { content: 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n' },
  latest: { content: 'docs/guide.md', mode: '120000' },
  'vendor/lib': { submodule: true },
  'notes.txt': { content: 'Not a picture, though it is in the tree.\n' },
}

const hex = (digit: string) => digit.repeat(40)

export const SAMPLE_COMMIT = hex('1')
export const MOVING_FIRST = hex('3')
export const MOVING_SECOND = hex('4')

export const FIXTURE_REPOS: FixtureRepo[] = [
  {
    id: 1001,
    owner: 'folio-test',
    name: 'sample',
    defaultBranch: 'main',
    description: 'A fixture repository for Folio’s tests.',
    refs: { main: 0, 'feature/x': 0 },
    tags: { 'v1.0': 0 },
    commits: [{ sha: SAMPLE_COMMIT, files: SAMPLE_FILES }],
  },
  {
    id: 1002,
    owner: 'folio-test',
    name: 'moving',
    defaultBranch: 'main',
    description: 'A fixture repository that gains a commit.',
    refs: { main: 0 },
    commits: [
      { sha: MOVING_FIRST, files: { 'README.md': { content: '# Moving\n\nThe first commit.\n' } } },
      {
        sha: MOVING_SECOND,
        files: {
          'README.md': { content: '# Moving\n\nThe second commit.\n' },
          'CHANGELOG.md': { content: '# Changelog\n\n- The second commit.\n' },
        },
      },
    ],
  },
  {
    id: 1003,
    owner: 'folio-test',
    name: 'new-name',
    defaultBranch: 'trunk',
    description: null,
    refs: { trunk: 0 },
    commits: [{ sha: hex('5'), files: { 'README.md': { content: '# Renamed\n' } } }],
    renamedFrom: ['old-name'],
  },
  {
    id: 1004,
    owner: 'folio-test',
    name: 'empty',
    defaultBranch: 'main',
    description: null,
    refs: {},
    commits: [],
    empty: true,
  },
  {
    id: 1005,
    owner: 'folio-test',
    name: 'private-repo',
    defaultBranch: 'main',
    description: null,
    refs: { main: 0 },
    commits: [{ sha: hex('6'), files: { 'README.md': { content: '# Secret\n' } } }],
    visibility: 'private',
  },
  {
    id: 1006,
    owner: 'folio-test',
    name: 'limited',
    defaultBranch: 'main',
    description: null,
    refs: { main: 0 },
    commits: [{ sha: hex('7'), files: { 'README.md': { content: '# Limited\n' } } }],
    rateLimited: true,
  },
  {
    id: 1007,
    owner: 'folio-test',
    name: 'huge',
    defaultBranch: 'main',
    description: 'A tree GitHub truncates.',
    refs: { main: 0 },
    commits: [
      {
        sha: hex('8'),
        files: {
          'README.md': { content: '# Huge\n' },
          'deep/a/b.md': { content: '# B\n' },
          'deep/c.txt': { content: 'c' },
        },
      },
    ],
    truncated: true,
  },
  {
    id: 1008,
    owner: 'folio-test',
    name: 'bulky',
    defaultBranch: 'main',
    description: 'More source than a download may fetch.',
    refs: { main: 0 },
    commits: [
      {
        sha: hex('9'),
        files: {
          'README.md': { content: '# Bulky\n' },
          ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`data/part${i}.txt`, { size: 1024 * 1024 }])),
        },
      },
    ],
  },
]
