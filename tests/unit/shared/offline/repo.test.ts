import { describe, expect, it } from 'vitest'
import { parseOfflineBatch, repoOfflineBatch, repoOfflineHref } from '~/shared/github-repos/offline'
import {
  decodeRepoSummary,
  encodeRepoSummary,
  parseBatchFiles,
  parseOfflinePlan,
  parseRepoCopy,
  parseRepoFile,
  parseTooLarge,
  type RepoCopy,
  repoCommitPrefix,
  repoCopyUrl,
  repoFileUrl,
  repoKeyOf,
  summaryOf,
} from '~/shared/offline/repo'
import { OLD_COMMIT, REPO_FOLDERS, REPO_ID, repoFile, repoPlan, repoView } from '../../../fixtures/offline-repos'

const copy = (patch: Partial<RepoCopy> = {}): RepoCopy => ({
  v: 1,
  id: REPO_ID,
  account: 'ada',
  repo: repoView(),
  folders: REPO_FOLDERS,
  commit: OLD_COMMIT,
  bytes: 1234,
  savedAt: 99,
  ...patch,
})

describe('the keys', () => {
  it('name a copy’s entry, and each file under its commit’s own prefix', () => {
    expect(repoCopyUrl(REPO_ID)).toBe(`/offline-repos/${REPO_ID}.json`)
    expect(repoCommitPrefix(REPO_ID, OLD_COMMIT)).toBe(`/offline-repos/${REPO_ID}/${OLD_COMMIT}/`)
    expect(repoFileUrl(REPO_ID, OLD_COMMIT, 'docs/a b.md')).toBe(
      `/offline-repos/${REPO_ID}/${OLD_COMMIT}/files/docs%2Fa%20b.md.json`,
    )
    expect(repoOfflineHref(REPO_ID)).toBe(`/account/repos/${REPO_ID}/offline`)
    expect(repoOfflineBatch(REPO_ID)).toEqual({ path: repoOfflineHref(REPO_ID), parse: parseOfflineBatch })
  })

  it('read back as what they hold', () => {
    expect(repoKeyOf(repoCopyUrl(REPO_ID))).toEqual({ kind: 'copy', id: REPO_ID })
    expect(repoKeyOf(repoFileUrl(REPO_ID, OLD_COMMIT, 'README.md'))).toEqual({
      kind: 'file',
      id: REPO_ID,
      commit: OLD_COMMIT,
    })
    for (const stray of ['/offline/essays.json', '/offline-repos/nope.json', `/offline-repos/${REPO_ID}/abc/x`, '/x'])
      expect(repoKeyOf(stray)).toBeNull()
  })
})

describe('the summary', () => {
  it('round-trips through its header, and refuses a damaged one', () => {
    const summary = summaryOf(copy())
    expect(summary).toEqual({
      id: REPO_ID,
      account: 'ada',
      owner: 'folio-test',
      name: 'sample',
      commit: OLD_COMMIT,
      bytes: 1234,
      savedAt: 99,
    })
    expect(decodeRepoSummary(encodeRepoSummary(summary))).toEqual(summary)
    expect(decodeRepoSummary(null)).toBeNull()
    expect(decodeRepoSummary('%E0%A4%A')).toBeNull()
    expect(decodeRepoSummary(encodeURIComponent('[]'))).toBeNull()
    for (const patch of [
      { id: 'x' },
      { account: '' },
      { owner: 1 },
      { commit: 'abc' },
      { bytes: -1 },
      { savedAt: 1.5 },
    ])
      expect(decodeRepoSummary(encodeRepoSummary({ ...summary, ...patch } as never))).toBeNull()
  })
})

describe('parseRepoCopy', () => {
  it('takes a whole copy, and refuses one of another version, repository or commit', () => {
    expect(parseRepoCopy(copy())).toEqual(copy())
    expect(parseRepoCopy(null)).toBeNull()
    for (const patch of [
      { v: 2 },
      { id: 'x' },
      { account: '' },
      { commit: 'abc' },
      { bytes: -1 },
      { repo: repoView({ id: '0f8fad5b-d9cb-469f-a165-70867728950e' }) },
      { repo: repoView({ commit: '2'.repeat(40) }) },
      { repo: { ...repoView(), owner: 3 } },
      { folders: [{ path: '', entries: [{ name: 'a', path: 'a', kind: 'door' }], readme: null }] },
      { folders: [{ path: '', entries: [], readme: 4 }] },
      { folders: {} },
    ])
      expect(parseRepoCopy(copy(patch as never))).toBeNull()
  })
})

describe('parseRepoFile', () => {
  it('takes each kind of rendered file, and refuses one missing what its kind shows', () => {
    for (const path of ['README.md', 'src/a.ts', 'logo.png'])
      expect(parseRepoFile(repoFile(path))).toEqual(repoFile(path))
    const notice = { path: 'a', name: 'a', size: 1, lines: null, content: { kind: 'notice', notice: 'lfs' } }
    expect(parseRepoFile(notice)).toEqual(notice)
    const bad = [
      null,
      { ...repoFile('a.ts'), path: 1 },
      { ...repoFile('a.ts'), size: -1 },
      { ...repoFile('a.ts'), lines: 'x' },
      { ...repoFile('a.ts'), content: { kind: 'video' } },
      { ...repoFile('a.ts'), content: { kind: 'code' } },
      { ...repoFile('a.md'), content: { kind: 'markdown', view: 'preview' } },
      { ...repoFile('a.md'), content: { kind: 'markdown', view: 'code' } },
      { ...notice, content: { kind: 'notice' } },
    ]
    for (const value of bad) expect(parseRepoFile(value)).toBeNull()
  })
})

describe('the answers a download reads', () => {
  it('a plan for this repository, with its folders and files', () => {
    expect(parseOfflinePlan(repoPlan(), REPO_ID)).toEqual(repoPlan())
    expect(parseOfflinePlan(repoPlan(), '0f8fad5b-d9cb-469f-a165-70867728950e')).toBeNull()
    expect(parseOfflinePlan('plan', REPO_ID)).toBeNull()
    for (const patch of [
      { repo: { ...repoView(), commit: 'x' } },
      { repo: { ...repoView(), name: null } },
      { folders: [{}] },
      { files: [''] },
      { bytes: 1.5 },
    ])
      expect(parseOfflinePlan(repoPlan(patch as never), REPO_ID)).toBeNull()
  })

  it('too_large, with numbers or with none', () => {
    const caps = { maxFiles: 2000, maxBytes: 9 }
    expect(parseTooLarge({ error: 'too_large', files: 3, bytes: 4, ...caps })).toEqual({ files: 3, bytes: 4, ...caps })
    expect(parseTooLarge({ error: 'too_large', files: null, bytes: null, ...caps })).toEqual({
      files: null,
      bytes: null,
      ...caps,
    })
    expect(parseTooLarge({ error: 'limited' })).toBeNull()
    expect(parseTooLarge({ error: 'too_large', files: 'many', bytes: 1, ...caps })).toBeNull()
    expect(parseTooLarge({ error: 'too_large', files: 1, bytes: 1, maxFiles: 2000 })).toBeNull()
  })

  it('a batch of exactly the paths asked for, in order', () => {
    const paths = ['README.md', 'src/a.ts']
    expect(parseBatchFiles({ files: paths.map((p) => repoFile(p)) }, paths)).toEqual(paths.map((p) => repoFile(p)))
    expect(parseBatchFiles({ files: [repoFile('src/a.ts'), repoFile('README.md')] }, paths)).toBeNull()
    expect(parseBatchFiles({ files: [repoFile('README.md')] }, paths)).toBeNull()
    expect(parseBatchFiles({ files: [repoFile('README.md'), { path: 'src/a.ts' }] }, paths)).toBeNull()
    expect(parseBatchFiles([], paths)).toBeNull()
  })
})

describe('parseOfflineBatch', () => {
  const commit = OLD_COMMIT

  it('takes a commit and 1 to 40 distinct paths, and nothing else', () => {
    expect(parseOfflineBatch({ commit, paths: ['a', 'b/c'] })).toEqual({ commit, paths: ['a', 'b/c'] })
    for (const body of [
      null,
      { commit },
      { commit: 'abc', paths: ['a'] },
      { commit, paths: [] },
      { commit, paths: Array.from({ length: 41 }, (_, i) => `f${i}`) },
      { commit, paths: ['a', 'a'] },
      { commit, paths: [''] },
      { commit, paths: ['x'.repeat(1025)] },
      { commit, paths: [1] },
      { commit, paths: 'a' },
      { commit, paths: ['a'], more: true },
    ])
      expect(parseOfflineBatch(body)).toBeNull()
  })
})
