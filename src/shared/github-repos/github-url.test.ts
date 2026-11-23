import { describe, expect, it } from 'vitest'
import { MAX_REPO_URL_LENGTH } from './contract'
import { githubBlobUrl, parseRepoUrl, RESERVED_OWNERS } from './github-url'

const repo = (owner: string, name: string, mode: 'tree' | 'blob' | null = null, segments: string[] = []) => ({
  ok: true,
  owner,
  name,
  mode,
  segments,
})

describe('parseRepoUrl accepts', () => {
  it.each([
    ['https://github.com/addyosmani/agent-skills', repo('addyosmani', 'agent-skills')],
    ['http://github.com/addyosmani/agent-skills', repo('addyosmani', 'agent-skills')],
    ['github.com/addyosmani/agent-skills', repo('addyosmani', 'agent-skills')],
    ['  https://www.github.com/a/b  ', repo('a', 'b')],
    ['HTTPS://GitHub.com/a/b/', repo('a', 'b')],
    ['github.com/a/b.git', repo('a', 'b')],
    ['https://github.com/a/b?tab=readme-ov-file', repo('a', 'b')],
    ['https://github.com/a/b#readme', repo('a', 'b')],
    ['https://github.com/a/b/tree/main', repo('a', 'b', 'tree', ['main'])],
    ['https://github.com/a/b/tree/feature/x/docs', repo('a', 'b', 'tree', ['feature', 'x', 'docs'])],
    ['https://github.com/a/b/blob/main/README.md', repo('a', 'b', 'blob', ['main', 'README.md'])],
    ['https://github.com/a/b/blob/main/My%20Notes.md', repo('a', 'b', 'blob', ['main', 'My Notes.md'])],
    ['https://github.com/my-org/some.name_v2', repo('my-org', 'some.name_v2')],
    ['https://github.com/a/.github', repo('a', '.github')],
    [`https://github.com/${'a'.repeat(39)}/b`, repo('a'.repeat(39), 'b')],
  ])('%s', (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected)
  })
})

describe('parseRepoUrl refuses', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    [`https://github.com/a/${'b'.repeat(490)}`, 'too_long'],
    ['not a url', 'not_url'],
    ['ftp://github.com/a/b', 'not_url'],
    ['https://github.com/a/%E0%A4%A', 'not_url'],
    ['gitlab.com/a/b', 'not_github'],
    ['https://gist.github.com/a/b', 'not_github'],
    ['https://a.github.io/b', 'not_github'],
    ['https://raw.githubusercontent.com/a/b/main/x', 'not_github'],
    ['https://api.github.com/repos/a/b', 'not_github'],
    ['https://github.com.evil.com/a/b', 'not_github'],
    ['https://user@github.com/a/b', 'not_github'],
    ['https://github.com:8080/a/b', 'not_github'],
    ['https://github.com', 'not_repository'],
    ['https://github.com/addyosmani', 'not_repository'],
    ['https://github.com/settings/profile', 'not_repository'],
    ['https://github.com/a/b/issues/3', 'not_repository'],
    ['https://github.com/a/b/pulls', 'not_repository'],
    ['https://github.com/a/b/wiki', 'not_repository'],
    ['https://github.com/a/b/actions', 'not_repository'],
    ['https://github.com/a/b/tree', 'not_repository'],
    ['https://github.com/a/b/blob/main', 'not_repository'],
    ['https://github.com/a--b/c', 'not_repository'],
    ['https://github.com/-a/c', 'not_repository'],
    ['https://github.com/a-/c', 'not_repository'],
    [`https://github.com/${'a'.repeat(40)}/b`, 'not_repository'],
    ['https://github.com/a/..', 'not_repository'],
    ['https://github.com/a/%2E%2E', 'not_repository'],
    ['https://github.com/a/b%20c', 'not_repository'],
  ])('%s → %s', (input, reason) => {
    expect(parseRepoUrl(input)).toEqual({ ok: false, reason })
  })

  it('the 501st character', () => {
    expect(MAX_REPO_URL_LENGTH).toBe(500)
    expect(parseRepoUrl('a'.repeat(500))).not.toEqual({ ok: false, reason: 'too_long' })
    expect(parseRepoUrl('a'.repeat(501))).toEqual({ ok: false, reason: 'too_long' })
  })

  it.each([...RESERVED_OWNERS])('the GitHub page /%s/x', (owner) => {
    expect(parseRepoUrl(`https://github.com/${owner}/x`)).toEqual({ ok: false, reason: 'not_repository' })
  })

  it('a reserved word in any case', () => {
    expect(parseRepoUrl('https://github.com/Settings/x')).toEqual({ ok: false, reason: 'not_repository' })
  })
})

describe('githubBlobUrl', () => {
  it('builds tree and blob addresses with each segment encoded', () => {
    const sha = 'a'.repeat(40)
    expect(githubBlobUrl('o', 'r', sha, '', 'tree')).toBe(`https://github.com/o/r/tree/${sha}`)
    expect(githubBlobUrl('o', 'r', sha, 'docs/My Notes#1.md', 'blob')).toBe(
      `https://github.com/o/r/blob/${sha}/docs/My%20Notes%231.md`,
    )
  })
})
