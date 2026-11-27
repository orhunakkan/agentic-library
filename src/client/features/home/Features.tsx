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
        <FeatureRow
          hue="violet"
          label="Ask the AI"
          title="Questions that can’t spoil the ending."
          preview={<AskPreview />}
        >
          <p>
            With an account, ask the AI about what you’re reading and get answers from the book itself, each with a link
            to the page it came from. It only sees the pages you’ve read, unless you ask it to use the whole book.
            Select a passage to have it explained, or ask for a recap of the story so far.
          </p>
          <p>
            Ask out loud and hear the answer spoken. Have it quiz you, or make flashcards from the book, and save the
            prompts you use often.
          </p>
          <p className="text-[15px] text-muted">
            Uses your own Anthropic or OpenAI key, and they bill you directly; Folio adds nothing. Page links need a
            Claude model.
          </p>
        </FeatureRow>
        <FeatureRow
          hue="cyan"
          label="Listen"
          title="Press play on any page, or any audiobook."
          preview={<ReadAloudPreview />}
        >
          <p>
            Any book can be read aloud by your device’s own voices, with each sentence marked as it’s spoken. The page
            turns by itself, and the reading carries on while you browse the library.
          </p>
          <p>
            With an account, import an M4B or MP3 audiobook and play it in the same player, with chapters, a sleep timer
            and listening bookmarks. Ask the AI a question out loud while you listen: the reading pauses, and you hear
            the answer.
          </p>
        </FeatureRow>
        <FeatureRow
          hue="amber"
          label="Remember"
          title="Mark it once. Find it anywhere."
          preview={<HighlightsPreview />}
        >
          <p>
            With an account, highlight a passage in one of four colours and add a note to it. Your highlights follow you
            to every device and gather on one page across your books. Bookmark a page to come back to, and export every
            book’s highlights as one Markdown file.
          </p>
          <p>
            Flashcards come back for review when they’re due. Ask makes the cards from the book, so you don’t have to
            write them.
          </p>
        </FeatureRow>
        <FeatureRow
          hue="pink"
          label="Your own books"
          title="Bring the books you already own."
          preview={<ImportPreview />}
        >
          <p>
            With an account, import an EPUB, a PDF, a Markdown file or a ZIP of Markdown. Your browser reads the file,
            so the file itself is never uploaded, and the book is yours alone: no one else can open it.
          </p>
          <p>
            Add an audiobook as one M4B file or the MP3 files of one book; its audio is uploaded to your account. Save
            web articles to read later, with highlights, Ask and read aloud.
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
