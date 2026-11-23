export function rebaseAudioUrl(url: string, base: string | undefined): string {
  if (!base) return url
  const [folder, file] = new URL(url).pathname.split('/').slice(-2)
  return `${base.replace(/\/+$/, '')}/${folder}/${file}`
}
