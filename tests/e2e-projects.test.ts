import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config, { specs } from '../playwright.config.ts'

type Project = NonNullable<typeof config.projects>[number]

const SPECS = 'tests/e2e/specs'
const projects = config.projects ?? []
const files = readdirSync(SPECS).filter((file) => file.endsWith('.spec.ts'))
const pathOf = (file: string) => resolve(SPECS, file)

const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

const matches = (patterns: unknown, path: string) =>
  asList(patterns).some((pattern) => (pattern instanceof RegExp ? pattern.test(path) : false))

function runsSpec(project: Project, path: string): boolean {
  if (project.testMatch !== undefined && !matches(project.testMatch, path)) return false
  return !matches(project.testIgnore, path)
}

const skipsHttp = (project: Project) => asList(project.grepInvert).some((pattern) => pattern.test('a test @http'))

describe('playwright.config.ts', () => {
  it('runs every project on Chromium', () => {
    expect(projects.length).toBeGreaterThan(0)
    for (const project of projects) expect(project.use?.browserName, project.name).toBe('chromium')
  })

  it.each(files)('runs %s on at least one project', (file) => {
    expect(projects.filter((p) => runsSpec(p, pathOf(file))).map((p) => p.name)).not.toEqual([])
  })

  it('runs @http tests on desktop alone', () => {
    const desktop = projects.find((p) => p.name === 'desktop')
    expect(desktop && skipsHttp(desktop)).toBe(false)
    for (const project of projects.filter((p) => p.name !== 'desktop')) {
      expect(skipsHttp(project), project.name).toBe(true)
    }
    for (const file of files.filter((f) => readFileSync(pathOf(f), 'utf8').includes('@http'))) {
      expect(desktop && runsSpec(desktop, pathOf(file)), file).toBe(true)
    }
  })

  it('matches spec names whole, so one name is never the end of another', () => {
    expect(specs('bookmarks').test(pathOf('bookmarks.spec.ts'))).toBe(true)
    expect(specs('bookmarks').test(pathOf('audio-bookmarks.spec.ts'))).toBe(false)
    expect(specs('read-aloud').test(pathOf('read-aloud-elevenlabs.spec.ts'))).toBe(false)
  })
})
