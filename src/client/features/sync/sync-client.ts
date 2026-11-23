import type { SyncBatch, SyncState } from '~/shared/sync/sync'

export type SendResult = 'ok' | 'signed_out' | 'invalid' | 'failed'

export async function sendBatch(
  batch: SyncBatch,
  { keepalive }: { keepalive: boolean },
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const response = await fetcher('/account/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
      credentials: 'same-origin',
      keepalive,
    })
    if (response.ok) return 'ok'
    if (response.status === 401) return 'signed_out'
    if (response.status === 400 || response.status === 413 || response.status === 415) return 'invalid'
    return 'failed'
  } catch {
    return 'failed'
  }
}

export async function readState(read: () => Promise<SyncState>): Promise<SyncState> {
  try {
    return await read()
  } catch {
    return { state: 'unavailable' }
  }
}
