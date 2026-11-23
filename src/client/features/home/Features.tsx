import { FeatureRow } from './FeatureRow'
import { AskPreview, ReadAloudPreview } from './previews'
import { HighlightsPreview, ImportPreview, SettingsPreview } from './previews-shelf'

export function Features() {
  return (
    <section
      id="features"
      tabIndex={-1}
      aria-labelledby="features-title"
      className="mt-24 scroll-mt-20 outline-none sm:mt-32"
    >
      <p className="text-[14px] font-semibold tracking-[0.14em] text-accent uppercase">What it does</p>
      <h2
        id="features-title"
        className="mt-3 max-w-[720px] font-display text-[34px] leading-tight font-bold tracking-tight text-ink sm:text-[44px]"
      >
        One app for reading, listening and remembering.
      </h2>
      <div className="mt-10">
        <FeatureRow hue="cyan" label="Read aloud" title="Press play on any page." preview={<ReadAloudPreview />}>
          <p>
            Any book can be read aloud by your device’s own voices, with each sentence marked as it’s spoken. The page
            turns by itself, and the reading carries on while you browse the library.
          </p>
        </FeatureRow>
        <FeatureRow
          hue="violet"
          label="Ask the book"
          title="Questions that can’t spoil the ending."
          preview={<AskPreview />}
        >
          <p>
            With an account, ask about what you’re reading and get answers from the book itself, each with a link to the
            page it came from. It only sees the pages you’ve read, unless you ask it to use the whole book. Select a
            passage to have it explained, or ask for a recap of the story so far.
          </p>
          <p className="text-[15px] text-muted">
            Uses your own Anthropic key. Anthropic bills you directly; Folio adds nothing.
          </p>
        </FeatureRow>
        <FeatureRow
          hue="amber"
          label="Highlights and notes"
          title="Mark it once. Find it anywhere."
          preview={<HighlightsPreview />}
        >
          <p>
            With an account, highlight a passage in one of four colours and add a note to it. Your highlights follow you
            to every device and gather on one page across your books. Bookmark a page to come back to, and export every
            book’s highlights as one Markdown file.
          </p>
        </FeatureRow>
        <FeatureRow
          hue="pink"
          label="Your own books"
          title="Bring the EPUBs you already own."
          preview={<ImportPreview />}
        >
          <p>
            With an account, import an EPUB, a Markdown file or a ZIP of Markdown. Your browser reads the file, so it’s
            never uploaded, and the book is yours alone: no one else can open it.
          </p>
        </FeatureRow>
        <FeatureRow
          hue="coral"
          label="Read your way"
          title="Light, sepia or dark. Your font, your size, your spacing."
          preview={<SettingsPreview />}
        >
          <p>
            Pick the page’s colours, one of five reading fonts, the size of the type, the line spacing, the width of the
            column, and whether pages turn or scroll. Folio remembers them, and with an account your theme, font,
            spacing and width follow you to every device.
          </p>
        </FeatureRow>
      </div>
    </section>
  )
}
