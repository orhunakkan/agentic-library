const SERVICE_WORKER_URL = '/sw.js'

interface Registrar {
  serviceWorker?: { register(url: string, options: RegistrationOptions): Promise<unknown> }
}

export async function registerServiceWorker({
  nav,
  prod,
  embedded,
}: {
  nav: Registrar
  prod: boolean
  embedded: boolean
}): Promise<void> {
  if (!prod || embedded || !nav.serviceWorker) return
  try {
    await nav.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' })
  } catch {}
}
