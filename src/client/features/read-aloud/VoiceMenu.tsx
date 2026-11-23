import { Menu } from '@base-ui/react/menu'
import { Link } from '@tanstack/react-router'
import { AudioLines, Check, Download, RotateCw, Trash2 } from 'lucide-react'
import { pill } from '~/client/features/player/PlayerFrames'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { menuItem, menuPopup } from '~/client/features/player/SleepMenu'
import { proNotice } from '~/shared/plans/copy'
import { PRO_LINK } from '~/shared/plans/plans'
import { useOnline } from './FolioOffer'
import { LOCAL_NOTE, localVoiceDetail, removeLabel, SLOW_NOTE } from './messages'
import { cloudNote, onlineNote, regionName, type VoiceLike, voiceName } from './voices'

const groupLabel = 'px-3 pt-2 pb-1 text-[12px] font-semibold tracking-[0.08em] text-muted uppercase'
const note = 'mx-1.5 mt-1 border-t border-line px-1.5 pt-2.5 pb-1.5 text-[12.5px] leading-snug text-muted'

function VoiceItem({ voice, details }: { voice: VoiceLike; details: (string | null)[] }) {
  return (
    <Menu.RadioItem
      value={voice.voiceURI}
      closeOnClick
      label={voiceName(voice)}
      className={menuItem}
      data-testid="voice-option"
      data-key={voice.voiceURI}
    >
      <span className="grid size-4 shrink-0 place-items-center self-start pt-1">
        <Menu.RadioItemIndicator>
          <Check className="size-4 text-accent" aria-hidden />
        </Menu.RadioItemIndicator>
      </span>
      <span className="min-w-0">
        <span className="block">{voiceName(voice)}</span>
        {details.filter(Boolean).map((line) => (
          <span key={line} className="block text-[12.5px] leading-snug text-muted">
            {line}
          </span>
        ))}
      </span>
    </Menu.RadioItem>
  )
}

function FolioGroup({ value, pick }: { value: string | null; pick: (uri: string) => void }) {
  const { readAloud } = usePlayer()
  const online = useOnline()
  const { voices, removable, slow } = readAloud.local
  if (voices.length === 0) return null
  return (
    <Menu.Group className="mb-1 border-b border-line pb-1">
      <Menu.GroupLabel className={groupLabel}>Folio voice</Menu.GroupLabel>
      <Menu.RadioGroup value={value} onValueChange={pick}>
        {voices.map((v) => {
          const detail = localVoiceDetail({ ...v, labels: v.voice.labels ?? null }, online)
          if (v.state === 'ready') return <VoiceItem key={v.id} voice={v.voice} details={[detail]} />
          return (
            <Menu.Item
              key={v.id}
              disabled={v.state === 'downloading' || !online}
              closeOnClick
              onClick={() => readAloud.downloadLocal(v.id)}
              label={v.voice.name}
              className={`${menuItem} data-disabled:opacity-70`}
              data-testid="voice-folio-download"
              data-key={v.id}
            >
              <span className="grid size-4 shrink-0 place-items-center self-start pt-1">
                <Download className="size-4 text-muted" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block">{v.voice.name}</span>
                <span className="block text-[12.5px] leading-snug text-muted">{detail}</span>
              </span>
            </Menu.Item>
          )
        })}
      </Menu.RadioGroup>
      <p className={note}>
        {LOCAL_NOTE}{' '}
        <Menu.LinkItem
          closeOnClick
          render={<Link to="/credits" />}
          data-testid="voice-credits"
          className="font-medium text-accent underline underline-offset-2 outline-none data-highlighted:bg-panel"
        >
          Credits
        </Menu.LinkItem>
      </p>
      {slow && (
        <p className="px-3 pt-1 pb-2 text-[12.5px] leading-snug text-muted" data-testid="voice-folio-slow">
          {SLOW_NOTE}
        </p>
      )}
      {removable > 0 && (
        <Menu.Item
          closeOnClick
          onClick={readAloud.removeLocal}
          className={`${menuItem} text-body`}
          data-testid="voice-folio-remove"
        >
          <Trash2 className="size-4 shrink-0 text-muted" aria-hidden />
          {removeLabel(removable)}
        </Menu.Item>
      )}
    </Menu.Group>
  )
}

export function VoiceMenu() {
  const { readAloud } = usePlayer()
  const current = readAloud.voice
  const cloud = readAloud.cloudVoices
  const value = current?.voiceURI ?? null
  const pick = (uri: string) => readAloud.setVoice(uri)
  return (
    <Menu.Root>
      <Menu.Trigger className={pill} data-testid="voice-menu">
        <AudioLines className="size-4" aria-hidden />
        Voice
        {current && (
          <span className="max-w-[16ch] truncate font-normal text-muted" data-testid="voice-current">
            {voiceName(current)}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-[100]">
          <Menu.Popup aria-label="Voice" className={menuPopup}>
            <FolioGroup value={value} pick={pick} />
            <Menu.Group>
              <Menu.GroupLabel className={groupLabel}>On this device</Menu.GroupLabel>
              {readAloud.voices.length > 0 ? (
                <Menu.RadioGroup value={value} onValueChange={pick}>
                  {readAloud.voices.map((voice) => (
                    <VoiceItem
                      key={voice.voiceURI}
                      voice={voice}
                      details={[[regionName(voice.lang), onlineNote(voice)].filter(Boolean).join(' · ') || null]}
                    />
                  ))}
                </Menu.RadioGroup>
              ) : (
                <p className="px-3 py-2 text-[14px] text-body">The browser’s default voice</p>
              )}
              <p className={note}>Voices come from your device. Add more in your system’s speech settings.</p>
              {cloud === 'no-key' && (
                <p className="px-3 pt-1 pb-2 text-[12.5px] leading-snug text-muted">
                  Use an ElevenLabs voice:{' '}
                  <Menu.LinkItem
                    closeOnClick
                    render={<Link to="/account/api-keys" hash="elevenlabs" />}
                    data-testid="voice-add-key"
                    className="font-medium text-accent underline underline-offset-2 outline-none data-highlighted:bg-panel"
                  >
                    add your key on the API keys page
                  </Menu.LinkItem>
                  .
                </p>
              )}
            </Menu.Group>
            {cloud === 'pro' && (
              <Menu.Group className="mt-1 border-t border-line pt-1">
                <Menu.GroupLabel className={groupLabel}>ElevenLabs</Menu.GroupLabel>
                <p className="px-3 py-2 text-[14px] text-body">
                  {proNotice('elevenlabs').heading}{' '}
                  <Menu.LinkItem
                    closeOnClick
                    render={<a href={PRO_LINK} />}
                    data-testid="voice-see-pro"
                    className="font-semibold text-accent underline-offset-2 outline-none hover:underline data-highlighted:bg-panel"
                  >
                    See Pro
                  </Menu.LinkItem>
                </p>
              </Menu.Group>
            )}
            {cloud !== 'off' && cloud !== 'no-key' && cloud !== 'pro' && (
              <Menu.Group className="mt-1 border-t border-line pt-1">
                <Menu.GroupLabel className={groupLabel}>ElevenLabs</Menu.GroupLabel>
                {cloud === 'loading' && (
                  <p className="px-3 py-2 text-[14px] text-body" data-testid="voice-cloud-loading">
                    Loading your ElevenLabs voices…
                  </p>
                )}
                {cloud === 'failed' && (
                  <div
                    className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-[14px] text-body"
                    data-testid="voice-cloud-error"
                  >
                    Couldn’t load your ElevenLabs voices.
                    <Menu.Item
                      closeOnClick={false}
                      onClick={readAloud.retryCloudVoices}
                      data-testid="voice-cloud-retry"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1.5 font-semibold text-accent outline-none data-highlighted:bg-panel"
                    >
                      <RotateCw className="size-4" aria-hidden />
                      Retry
                    </Menu.Item>
                  </div>
                )}
                {cloud === 'permission' && (
                  <p className="px-3 py-2 text-[14px] text-body" data-testid="voice-cloud-permission">
                    This key can’t read your voices. In ElevenLabs, allow it Voices (read) and Text to Speech.
                  </p>
                )}
                {Array.isArray(cloud) &&
                  (cloud.length > 0 ? (
                    <Menu.RadioGroup value={value} onValueChange={pick}>
                      {cloud.map((voice) => (
                        <VoiceItem
                          key={voice.voiceURI}
                          voice={voice}
                          details={[voice.labels ?? null, cloudNote(readAloud.cloudModel)]}
                        />
                      ))}
                    </Menu.RadioGroup>
                  ) : (
                    <p className="px-3 py-2 text-[14px] text-body" data-testid="voice-cloud-empty">
                      Your ElevenLabs account has no voices yet.
                    </p>
                  ))}
              </Menu.Group>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
