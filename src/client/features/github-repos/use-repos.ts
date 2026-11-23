import { useState } from 'react'
import type { RepoView } from '~/shared/github-repos/contract'
import { addRepo, refreshRepo, removeRepo } from './repos-client'

export function useRepos(initial: readonly RepoView[]) {
  const [repos, setRepos] = useState<readonly RepoView[]>(initial)
  const [paths, setPaths] = useState<Readonly<Record<string, string>>>({})

  const add = async (url: string) => {
    const result = await addRepo(url)
    if (result.ok) {
      const { repo, path } = result.value
      setRepos((list) => [repo, ...list.filter((r) => r.id !== repo.id)])
      if (path) setPaths((p) => ({ ...p, [repo.id]: path }))
    }
    return result
  }

  const refresh = async (id: string) => {
    const result = await refreshRepo(id)
    if (result.ok) setRepos((list) => list.map((r) => (r.id === id ? result.value.repo : r)))
    return result
  }

  const remove = async (id: string) => {
    const result = await removeRepo(id)
    if (result.ok) setRepos((list) => list.filter((r) => r.id !== id))
    return result
  }

  return { repos, paths, add, refresh, remove }
}
