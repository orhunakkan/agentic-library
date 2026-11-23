import { createFileRoute, Link } from '@tanstack/react-router'
import { legalLink, Part } from '~/client/components/LegalPage'
import { SITE_NAME } from '~/shared/lib/site'
import {
  BASES,
  ENGINE_SOFTWARE,
  FOLIO_VOICES,
  type FolioVoice,
  LICENCES,
  voiceUrl,
} from '~/shared/read-aloud/folio-voices'

const DESCRIPTION = 'Who made the Folio voice: each voice’s dataset and licence, and the software it runs on.'

export const Route = createFileRoute('/credits')({
  head: () => ({
    meta: [
      { title: `Credits | ${SITE_NAME}` },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: `Credits | ${SITE_NAME}` },
      { property: 'og:description', content: DESCRIPTION },
    ],
    links: [{ rel: 'canonical', href: '/credits' }],
  }),
  component: CreditsPage,
})

const languageOf = (lang: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang
  } catch {
    return lang
  }
}

function Licence({ id, testId, dataKey }: { id: FolioVoice['licence']; testId: string; dataKey: string }) {
  const licence = LICENCES[id]
  return licence.url ? (
    <a href={licence.url} className={legalLink} rel="license noreferrer" data-testid={testId} data-key={dataKey}>
      {licence.name}
    </a>
  ) : (
    licence.name.toLowerCase()
  )
}

function VoiceCredit({ voice }: { voice: FolioVoice }) {
  const base = voice.base ? BASES[voice.base] : null
  return (
    <li>
      <strong>{voice.name}</strong>, {languageOf(voice.lang)}
      {voice.dataset.by ? `, by ${voice.dataset.by}` : ''}, from the{' '}
      <a
        href={voice.dataset.url}
        className={legalLink}
        rel="noreferrer"
        data-testid="credits-voice-dataset"
        data-key={voice.id}
      >
        {voice.dataset.name}
      </a>{' '}
      dataset, <Licence id={voice.licence} testId="credits-voice-licence" dataKey={voice.id} />.
      {base?.credit && base.url && (
        <>
          {' '}
          Fine-tuned from Piper’s {base.name} voice, trained on{' '}
          <a
            href={base.url}
            className={legalLink}
            rel="noreferrer"
            data-testid="credits-voice-base"
            data-key={voice.id}
          >
            {base.credit}
          </a>
          , <Licence id={base.licence} testId="credits-base-licence" dataKey={voice.id} />.
        </>
      )}
      {base && !base.credit && <> Fine-tuned from Piper’s {base.name} voice (CC0).</>}{' '}
      <a
        href={voiceUrl(voice.files.card, voice.id)}
        className={legalLink}
        data-testid="credits-voice-card"
        data-key={voice.id}
      >
        Model card
      </a>
    </li>
  )
}

function CreditsPage() {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-[720px] px-4 pt-12 md:px-8 md:pt-16"
      style={{ paddingBottom: 'calc(96px + var(--player-h))' }}
    >
      <p className="eyebrow text-accent">{SITE_NAME}</p>
      <h1
        data-testid="credits-title"
        className="mt-3 font-display text-[clamp(34px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.03em] text-ink"
      >
        Credits
      </h1>
      <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-muted">
        The Folio voice reads books aloud on your device with Piper neural voices. These are the people and projects
        behind it. See also{' '}
        <Link to="/privacy" className={legalLink} data-testid="credits-privacy-link">
          Privacy
        </Link>
        .
      </p>

      <Part id="voices" title="Voices">
        <p>
          Each voice’s licence allows commercial use along its whole training chain. Our copy of each model card is
          linked beside it.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          {FOLIO_VOICES.map((voice) => (
            <VoiceCredit key={voice.id} voice={voice} />
          ))}
        </ul>
      </Part>

      <Part id="software" title="Software">
        <ul className="list-disc space-y-2 pl-5">
          {ENGINE_SOFTWARE.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong>
              {s.version ? ` ${s.version}` : ''}: {s.what}.{' '}
              <a
                href={s.licence.url}
                className={legalLink}
                rel="license noreferrer"
                data-testid="credits-software-licence"
                data-key={s.name}
              >
                {s.licence.name}
              </a>
              ,{' '}
              <a
                href={s.source}
                className={legalLink}
                rel="noreferrer"
                data-testid="credits-software-source"
                data-key={s.name}
              >
                source
              </a>
              {s.parts.map((part) => (
                <span key={part.name}>
                  ,{' '}
                  <a
                    href={part.source}
                    className={legalLink}
                    rel="noreferrer"
                    data-testid="credits-software-part"
                    data-key={part.name}
                  >
                    {part.name}
                  </a>
                </span>
              ))}
              .
            </li>
          ))}
        </ul>
      </Part>
    </main>
  )
}
