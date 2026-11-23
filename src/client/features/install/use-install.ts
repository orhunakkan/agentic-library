import { useEffect, useSyncExternalStore } from 'react'
import { useToast } from '~/client/components/Toast'
import { createInstallStore, type InstallOffer, type InstallOutcome, type InstallStore } from './install-offer'

let store: InstallStore | null = null

function pageStore(): InstallStore {
  store ??= createInstallStore(window)
  return store
}

const subscribe = (listener: () => void) => pageStore().subscribe(listener)
const getSnapshot = () => pageStore().getSnapshot()
const getServerSnapshot = (): InstallOffer => null

export function useInstall(): { offer: InstallOffer; promptInstall: () => Promise<InstallOutcome> } {
  const offer = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const toast = useToast()
  useEffect(() => pageStore().onInstalled(() => toast('Folio is installed.')), [toast])
  return { offer, promptInstall: () => pageStore().promptInstall() }
}
