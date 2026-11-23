export interface EpisodeWindow {
  audioUrl: string
  startMs: number
  durationMs: number
}

export const END_SLACK_MS = 250

export const timeInEpisode = (elementMs: number, episode: EpisodeWindow) =>
  Math.max(0, Math.min(elementMs - episode.startMs, episode.durationMs))

export const elementTime = (episodeMs: number, episode: EpisodeWindow) =>
  episode.startMs + Math.max(0, Math.min(episodeMs, episode.durationMs))

export const isWindowed = (episodes: readonly EpisodeWindow[], episode: EpisodeWindow) =>
  episode.startMs > 0 || episodes.some((e) => e !== episode && e.audioUrl === episode.audioUrl)

export function endsInsideFile(episodes: readonly EpisodeWindow[], episode: EpisodeWindow): boolean {
  const next = episodes[episodes.indexOf(episode) + 1]
  return episodes.includes(episode) && next?.audioUrl === episode.audioUrl
}

export const reachedEnd = (elementMs: number, episode: EpisodeWindow) =>
  elementMs >= episode.startMs + episode.durationMs - END_SLACK_MS

export function needsSeek(elementMs: number, current: EpisodeWindow | null, next: EpisodeWindow, atMs: number) {
  if (!current || current.audioUrl !== next.audioUrl) return true
  return Math.abs(elementTime(atMs, next) - elementMs) > 1000
}
