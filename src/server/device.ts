export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const browser =
    (/Edg\//.test(ua) && 'Edge') ||
    (/OPR\/|Opera/.test(ua) && 'Opera') ||
    (/Firefox\/|FxiOS/.test(ua) && 'Firefox') ||
    (/Chrome\/|CriOS/.test(ua) && 'Chrome') ||
    (/Safari\//.test(ua) && 'Safari') ||
    null
  const os =
    (/iPhone/.test(ua) && 'iPhone') ||
    (/iPad/.test(ua) && 'iPad') ||
    (/Android/.test(ua) && 'Android') ||
    (/Windows/.test(ua) && 'Windows') ||
    (/Mac OS X|Macintosh/.test(ua) && 'macOS') ||
    (/CrOS/.test(ua) && 'ChromeOS') ||
    (/Linux/.test(ua) && 'Linux') ||
    null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? 'Unknown device'
}
