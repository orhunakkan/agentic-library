import { Drawer } from '@base-ui/react/drawer'
import { useRouteContext, useRouter, useRouterState } from '@tanstack/react-router'
import { ArrowLeft, CloudOff, List, Maximize, Minimize, Share2 } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppLink, isPlainClick } from '~/client/components/AppLink'
import { useToast } from '~/client/components/Toast'
import { AskPanel } from '~/client/features/ask/AskPanel'
import { QUOTE_MAX } from '~/client/features/ask/ask-client'
import { EXPLAIN_QUESTION } from '~/client/features/ask/suggestions'
import { useAsk } from '~/client/features/ask/use-ask'
import { useAskVoice } from '~/client/features/ask-voice/use-ask-voice'
import { BookmarkRibbon } from '~/client/features/bookmarks/BookmarkRibbon'
import { BookmarksTab, bookmarkCount } from '~/client/features/bookmarks/BookmarksTab'
import { useAudioBookmarks } from '~/client/features/bookmarks/use-audio-bookmarks'
import { useBookmarks } from '~/client/features/bookmarks/use-bookmarks'
import { rangeFor, readPage } from '~/client/features/highlights/dom-text'
import { HighlightPopover } from '~/client/features/highlights/HighlightPopover'
import { type Editing, HighlightsTab } from '~/client/features/highlights/HighlightsTab'
import { clearPaint, hitTest, paintPages, paintSpeaking, paintWord } from '~/client/features/highlights/paint'
import { type Selected, SelectionToolbar } from '~/client/features/highlights/SelectionToolbar'
import { type HighlightItem, type NewHighlight, useHighlights } from '~/client/features/highlights/use-highlights'
import { LookupCard } from '~/client/features/lookup/LookupCard'
import { useLookup } from '~/client/features/lookup/use-lookup'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { type WordSpan, wordMark } from '~/client/features/read-aloud/word-mark'
import { noteFinished } from '~/client/features/reading-stats/finish'
import { RunCodeContext } from '~/client/features/run-code/RunButtons'
import { RunDialog, type RunTarget, useRunEdits } from '~/client/features/run-code/RunDialog'
import { runAccess } from '~/client/features/run-code/run-access'
import { ReadElsewhere } from '~/client/features/sync/ReadElsewhere'
import { useMediaQuery } from '~/client/lib/use-media-query'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import type { NavTarget } from '~/shared/content/navigation'
import { toStored } from '~/shared/content/position'
import { labelOf, positionOf, type ReaderView } from '~/shared/content/reader-view'
import { AskButton, IconButton, ReadAloudButton } from './ChromeButtons'
import { ContentsDrawer, TocPanel, type TocTab } from './Contents'
import { rememberReading } from './continue-reading'
import * as navigation from './navigation-intent'
import { type Direction, type OnRoot, Page, type PageRoot, type Turn, turnFor } from './Page'
import { BottomBar, SideArrows } from './PageNav'
import { PictureViewer, usePictureLinks } from './PictureViewer'
import { keyTurn, TYPING_OR_DIALOG } from './page-keys'
import { type ColumnHandle, ScrollColumn } from './ScrollColumn'
import { SettingsPopover } from './SettingsPopover'
import { AskSheet, FootnoteSheet } from './Sheets'
import type { ColumnPage } from './scroll-column'
import { useReaderPrefs } from './use-reader-prefs'

function useEmbedded(): boolean {
  const [embedded, setEmbedded] = useState(false)
  useEffect(() => setEmbedded(document.documentElement.getAttribute('data-embed') === 'on'), [])
  return embedded
}

export function Reader({
  view,
  signedIn,
  offline = false,
}: {
  view: ReaderView
  signedIn: boolean
  offline?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const desktop = useMediaQuery('(min-width: 900px)')
  const [prefs, update] = useReaderPrefs()
  const scrollMode = prefs.layout === 'scroll'
  const [columnPages, setColumnPages] = useState<readonly ColumnPage[]>([])
  const column = useRef<ColumnHandle | null>(null)
  const [settingsOpen, setSettingsOpen] = useState<'toolbar' | 'floating' | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [footnoteAt, setFootnoteAt] = useState<{ path: string; id: string } | null>(null)
  const [turn, setTurn] = useState<Turn>('fade')
  const intent = useNavigationIntent()
  const ask = useAsk(view.book.slug, positionOf(view))
  const [askSheetOpen, setAskSheetOpen] = useState(false)
  const askButton = useRef<HTMLButtonElement>(null)
  const askBox = useRef<HTMLTextAreaElement>(null)
  const askFocus = useRef<'box' | 'button' | null>(null)
  const [askQuote, setAskQuote] = useState<string | null>(null)
  const readingArea = useRef<HTMLDivElement>(null)
  const panelOpen = desktop && prefs.askOpen
  const sheetOpen = askSheetOpen && !desktop
  const askVoice = useAskVoice({
    ask,
    lang: view.book.language,
    privateBook: isPrivateBookSlug(view.book.slug),
    active: panelOpen || sheetOpen,
    send: (text) => {
      void ask.ask(text, askQuote, { spoken: true })
      setAskQuote(null)
    },
  })
  const reduce = useReducedMotion()

  const embedded = useEmbedded()
  const highlights = useHighlights(view.book.slug, { signedIn, embedded })
  const bookmarks = useBookmarks(view.book.slug, { signedIn, embedded })
  const lookup = useLookup({ book: view.book.slug, lang: view.book.language, signedIn })
  const audioBookmarks = useAudioBookmarks(view.book.slug)
  const listening = embedded ? null : audioBookmarks
  const [tocTab, setTocTab] = useState<TocTab>('contents')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [popover, setPopover] = useState<{ key: string; rect: DOMRect } | null>(null)
  const { picture, close: closePicture } = usePictureLinks(readingArea)
  const viewer = useRouteContext({ from: '__root__' }).viewer
  const [runTarget, setRunTarget] = useState<RunTarget | null>(null)
  const runEdits = useRunEdits(view.book.slug)
  const runCode = useMemo(() => (offline ? null : { open: setRunTarget }), [offline])
  const [flash, setFlash] = useState<string | null>(null)
  const mounted: readonly ReaderView[] = useMemo(
    () => (scrollMode && columnPages.length > 0 ? columnPages.map((p) => p.view) : [view]),
    [scrollMode, columnPages, view],
  )
  const viewFor = useCallback((path: string) => mounted.find((v) => v.canonicalPath === path) ?? null, [mounted])
  const [roots, setRoots] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map())
  const onRoot: OnRoot = useCallback(({ el, path }, isMounted) => {
    setRoots((current) => {
      if (isMounted ? current.get(path) === el : current.get(path) !== el) return current
      const next = new Map(current)
      if (isMounted) next.set(path, el)
      else next.delete(path)
      return next
    })
  }, [])
  const pageRoot = roots.get(view.canonicalPath) ?? null
  const rootOf = useCallback(
    (node: Node): PageRoot | null => {
      for (const [path, el] of roots) if (viewFor(path) && el.contains(node)) return { el, path }
      return null
    },
    [roots, viewFor],
  )
  const itemsOn = useCallback(
    (path: string) => highlights.items.filter((h) => h.place?.pageHref === path),
    [highlights.items],
  )
  const pageItems = useMemo(() => itemsOn(view.canonicalPath), [itemsOn, view.canonicalPath])
  const highlightPages = useMemo(
    () =>
      highlights.items.flatMap((h) =>
        h.place && h.status !== 'missing' && h.place.chapterIndex === view.chapterIndex ? [h.place.page] : [],
      ),
    [highlights.items, view.chapterIndex],
  )
  const ranges = useRef<{ key: string; range: Range }[]>([])
  const popoverKey = popover?.key ?? null
  useEffect(() => {
    const pages = [...roots].flatMap(([path, el]) =>
      viewFor(path) ? [{ page: readPage(el), items: itemsOn(path) }] : [],
    )
    ranges.current = paintPages(pages, popoverKey, flash)
  }, [roots, viewFor, itemsOn, popoverKey, flash])
  useEffect(() => clearPaint, [])

  const { canReadAloud, readingHere, readAloudHere, readAloudFrom, stopFollowing, voicePlacesPage } = useVoiceOnPage(
    view,
    roots,
    viewFor,
    embedded,
    scrollMode ? column : null,
    intent,
  )

  const toggleAsk = () => {
    if (!desktop) {
      setAskSheetOpen(true)
      return
    }
    askFocus.current = prefs.askOpen ? 'button' : 'box'
    update({ askOpen: !prefs.askOpen })
  }
  const openAsk = () => {
    if (!desktop) {
      setAskSheetOpen(true)
      return
    }
    if (prefs.askOpen) askBox.current?.focus()
    else {
      askFocus.current = 'box'
      update({ askOpen: true })
    }
  }
  const askAbout = (quote: string) => {
    setAskQuote(quote)
    openAsk()
  }
  const askAction = (action: 'explain' | 'define', quote: string, question: string) => {
    if (!signedIn) return askAbout(quote)
    openAsk()
    void ask.ask(question, quote, { action })
  }
  const explain = (quote: string) => askAction('explain', quote, EXPLAIN_QUESTION)
  const popoverItem = (popover && highlights.items.find((h) => h.key === popover.key)) || null
  const popoverQuote = () =>
    popoverItem ? [...popoverItem.text.replace(/\s+/g, ' ')].slice(0, QUOTE_MAX).join('') : null
  const showTocTab = (tab: TocTab) => {
    setTocTab(tab)
    if (!desktop) setTocOpen(true)
    else if (prefs.sidebarHidden) update({ sidebarHidden: false })
  }
  const openHighlights = (next: Editing | null) => {
    showTocTab('highlights')
    setEditing(next)
  }
  const openBookmarks = () => showTocTab('bookmarks')
  const ribbonFor = (page: ReaderView) =>
    offline || bookmarks.state === 'off' ? null : (
      <BookmarkRibbon
        pressed={bookmarks.onPage(page.canonicalPath).length > 0}
        state={bookmarks.state}
        onToggle={() => (bookmarks.state === 'signed_out' ? openBookmarks() : bookmarks.toggle(page))}
      />
    )
  const openContents = () => {
    setTocTab('contents')
    setTocOpen(true)
  }
  const openPopover = (key: string) => {
    const rect = paintedRect(ranges.current, key)
    if (rect) setPopover({ key, rect })
  }

  const highlightSelection = (passage: Selected, withNote: boolean, path: string) => {
    document.getSelection()?.removeAllRanges()
    if (highlights.state === 'signed_out') {
      openHighlights(null)
      return
    }
    const page = viewFor(path)
    if (!page) return
    const twin = itemsOn(path).find((h) => h.place?.start === passage.start && h.place?.end === passage.end)
    if (twin) {
      if (withNote) openHighlights({ key: twin.key, focus: true })
      else openPopover(twin.key)
      return
    }
    const key = highlights.create(newHighlight(page, passage))
    if (withNote) openHighlights({ key, focus: true })
    else {
      toast('Highlighted')
      document.getElementById('reader-content')?.focus({ preventScroll: true })
    }
  }

  useEffect(() => {
    const area = readingArea.current
    if (!area) return
    const onClick = (e: MouseEvent) => {
      if (document.getSelection()?.isCollapsed === false) return
      if ((e.target as HTMLElement).closest?.('a, button, input, textarea, [data-run-layer]')) return
      const key = hitTest(ranges.current, e.clientX, e.clientY)
      if (!key) return
      const rect = paintedRect(ranges.current, key)
      if (rect) setPopover({ key, rect })
    }
    area.addEventListener('click', onClick)
    return () => area.removeEventListener('click', onClick)
  }, [])

  useHighlightArrival(view.canonicalPath, pageItems, pageRoot, reduce, setFlash)

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the panel opens or closes
  useEffect(() => {
    const target = askFocus.current
    askFocus.current = null
    if (target === 'box') askBox.current?.focus()
    else if (target === 'button') askButton.current?.focus()
  }, [panelOpen])

  const navRef = useRef(view.nav)
  navRef.current = view.nav

  const goTo = useCallback(
    (target: NavTarget, direction: Turn) => {
      if (target.kind === 'start' || target.kind === 'end' || !intent.canTurn()) return
      stopFollowing()
      if (scrollMode && target.kind === 'page' && column.current) {
        column.current.reveal(target.href, { scroll: true })
        return
      }
      intent.send({ type: 'turned', turn: direction })
      router.navigate({ href: target.href }).catch(() => intent.send({ type: 'turnFailed' }))
    },
    [router, stopFollowing, scrollMode, intent],
  )
  const turnPage = useCallback(
    (direction: Direction) =>
      goTo(direction === 'next' ? navRef.current.next : navRef.current.prev, turnFor(direction)),
    [goTo],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page.
  useEffect(() => {
    const arrived = intent.arrival(view.canonicalPath, false)
    intent.send({ type: 'arrived', href: view.canonicalPath })
    if (view.nav.next.kind === 'end') void noteFinished(view.book.slug, view.book.title, { signedIn, toast })
    if (arrived.turn !== null) setTurn(arrived.turn)
    if (arrived.closeOverlays) {
      setFootnoteAt(null)
      setTocOpen(false)
      setPopover(null)
      lookup.dispatch({ type: 'close' })
      closePicture()
    }
    rememberReading(view)
  }, [view.canonicalPath])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = keyTurn(event, {
        settings: Boolean(settingsOpen),
        contents: tocOpen,
        footnote: Boolean(footnoteAt),
        askSheet: askSheetOpen,
        popover: Boolean(popover),
        lookup: Boolean(lookup.target),
        picture: Boolean(picture),
        runCode: Boolean(runTarget),
      })
      if (direction) turnPage(direction)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turnPage, settingsOpen, tocOpen, footnoteAt, askSheetOpen, popover, lookup.target, picture, runTarget])

  const [fullscreen, toggleFullscreen] = useFullscreen()

  const voicePlacesRef = useRef(voicePlacesPage)
  voicePlacesRef.current = voicePlacesPage
  const [columnIntent] = useState<navigation.ColumnIntent>(() => ({
    follow: (href) => {
      intent.send({ type: 'scrolledTo', href })
      void router
        .navigate({ href, replace: true, resetScroll: false })
        .catch(() => intent.send({ type: 'scrollFailed', href }))
    },
    arrival: (href) => intent.arrival(href, voicePlacesRef.current(href)).column,
  }))
  const leftScroll = useRef(false)
  const updatePrefs = (patch: Partial<typeof prefs>) => {
    if (patch.layout === 'pages' && scrollMode) {
      const href = column.current?.pageAtLine()
      if (href && href !== view.canonicalPath) void router.navigate({ href, replace: true })
      leftScroll.current = true
    }
    update(patch)
  }
  useEffect(() => {
    if (!scrollMode && leftScroll.current) window.scrollTo({ top: 0 })
  }, [scrollMode])
  const settingsClosed = () => {
    if (scrollMode || !leftScroll.current) return
    leftScroll.current = false
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }
  const scrollToLinked = (event: React.MouseEvent) => {
    if (!scrollMode || !isPlainClick(event)) return
    const link = (event.target as HTMLElement).closest?.('a[href^="/read/"]')
    const href = link?.getAttribute('href')
    if (!href || href.includes('#') || !view.nav.dots.some((d) => d.href === href) || !column.current) return
    event.preventDefault()
    setTocOpen(false)
    column.current.reveal(href, { scroll: true })
  }

  const share = async () => {
    const url = new URL(view.canonicalPath, window.location.origin).toString()
    const title = `${view.book.title} · ${view.chapterTitle}`
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch (error) {
        if ((error as DOMException).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied')
    } catch {
      toast(url)
    }
  }

  const footnotePage = footnoteAt ? viewFor(footnoteAt.path)?.page : undefined
  const footnote =
    footnotePage?.kind === 'paged' ? footnotePage.footnotes.find((f) => f.id === footnoteAt?.id) : undefined
  const settingsButton = (
    <button
      type="button"
      data-testid="reader-settings"
      className="inline-flex h-11 items-center gap-2 rounded-full border border-r-line bg-r-paper/90 px-3.5 text-[13.5px] text-r-ink shadow-sm backdrop-blur transition hover:border-r-accent/50"
    >
      <span className="font-serif text-[16px]" aria-hidden>
        Aa
      </span>
      <span className="max-sm:sr-only">Settings</span>
    </button>
  )
  const settingsPopover = (where: 'toolbar' | 'floating') => (
    <SettingsPopover
      tone={view.book.tone}
      prefs={prefs}
      update={updatePrefs}
      showPanel={where === 'floating'}
      syncs={signedIn && !embedded}
      open={settingsOpen === where}
      onOpenChange={(open) => setSettingsOpen(open ? where : null)}
      onClosed={settingsClosed}
      trigger={settingsButton}
    />
  )
  const tocTabs = (onNavigate?: () => void) => ({
    tab: tocTab,
    onTab: setTocTab,
    highlights:
      highlights.state === 'off' ? null : (
        <HighlightsTab
          api={highlights}
          view={view}
          editing={editing}
          setEditing={setEditing}
          onNavigate={onNavigate}
          offline={offline}
        />
      ),
    highlightCount: highlights.items.length,
    bookmarks:
      bookmarks.state === 'off' ? null : (
        <BookmarksTab
          api={bookmarks}
          audio={listening}
          canPlay={canReadAloud}
          view={view}
          onNavigate={onNavigate}
          offline={offline}
        />
      ),
    bookmarkCount: bookmarkCount(bookmarks, listening),
  })

  return (
    <div
      data-reader
      data-tone={view.book.tone}
      className="min-h-[calc(100dvh-var(--site-nav-h))] bg-r-page text-r-ink transition-colors duration-300"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest?.('a[href^="/"]')) stopFollowing()
        scrollToLinked(e)
      }}
    >
      <a
        href="#reader-content"
        data-testid="reader-skip-link"
        className="sr-only z-[80] rounded-full bg-r-accent px-4 py-2 text-sm font-medium text-r-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <LoadingBar shows={intent.showsLoadingBar} />

      <div
        data-chrome
        className="sticky top-[var(--site-nav-h)] z-30 flex h-12 items-center gap-1 border-b border-r-line bg-r-page/92 px-2 backdrop-blur-md min-[900px]:hidden"
      >
        <IconButton label="Contents" data-testid="reader-contents" onClick={openContents} expanded={tocOpen}>
          <List className="size-5" />
        </IconButton>
        <AppLink
          href={view.book.href}
          data-testid="reader-book-link"
          className="flex min-w-0 flex-1 items-center gap-1 px-1 text-[14px] text-r-muted"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{view.book.title}</span>
        </AppLink>
        <IconButton label="Share" data-testid="reader-share" onClick={share}>
          <Share2 className="size-[18px]" />
        </IconButton>
        {canReadAloud && <ReadAloudButton reading={readingHere} onClick={readAloudHere} compact />}
        {offline ? <OfflineChip /> : <AskButton onClick={toggleAsk} expanded={askSheetOpen} compact />}
        {settingsPopover('toolbar')}
        <IconButton label="Read fullscreen" data-testid="reader-fullscreen" onClick={toggleFullscreen}>
          <Maximize className="size-[18px]" />
        </IconButton>
      </div>

      <div className="flex">
        <aside
          aria-label="Book contents panel"
          data-chrome
          className="sticky top-[var(--site-nav-h)] flex h-[calc(100dvh-var(--site-nav-h)-var(--player-h))] w-[288px] shrink-0 flex-col border-r border-r-line bg-r-page max-[899px]:hidden rail-hidden:hidden"
        >
          <TocPanel view={view} onCollapse={() => update({ sidebarHidden: true })} {...tocTabs()} />
        </aside>

        <div className="relative min-w-0 flex-1 pb-[calc(60px+var(--player-h)+40px)]">
          <button
            type="button"
            data-chrome
            data-testid="reader-show-contents"
            onClick={() => {
              setTocTab('contents')
              update({ sidebarHidden: false })
            }}
            className="fixed top-[calc(var(--site-nav-h)+16px)] left-4 z-20 hidden h-11 items-center gap-2 rounded-full border border-r-line bg-r-paper/90 px-3.5 text-[13.5px] shadow-sm backdrop-blur transition hover:border-r-accent/50 min-[900px]:rail-hidden:inline-flex"
          >
            <List className="size-4" aria-hidden />
            Contents
          </button>
          <div
            data-chrome
            className="sticky top-[calc(var(--site-nav-h)+16px)] z-20 float-right mr-4 flex items-center gap-2 max-[899px]:hidden"
          >
            {canReadAloud && <ReadAloudButton reading={readingHere} onClick={readAloudHere} />}
            {offline ? <OfflineChip /> : <AskButton ref={askButton} onClick={toggleAsk} expanded={prefs.askOpen} />}
            {settingsPopover('floating')}
            <IconButton
              label="Read fullscreen"
              title="Read fullscreen — hide menus"
              data-testid="reader-fullscreen"
              onClick={toggleFullscreen}
              bordered
            >
              <Maximize className="size-[18px]" />
            </IconButton>
          </div>

          {fullscreen && (
            <button
              type="button"
              data-testid="reader-exit-fullscreen"
              onClick={toggleFullscreen}
              className="fixed top-4 right-4 z-40 inline-flex h-11 items-center gap-2 rounded-full border border-r-line bg-r-paper/90 px-3.5 text-[13.5px] shadow-sm backdrop-blur transition hover:border-r-accent/50"
            >
              <Minimize className="size-4" aria-hidden />
              Exit fullscreen
            </button>
          )}

          <ReadElsewhere view={view} signedIn={signedIn} embedded={embedded} />
          <RunCodeContext.Provider value={runCode}>
            {scrollMode ? (
              <ScrollColumn
                view={view}
                areaRef={readingArea}
                onRoot={onRoot}
                onFootnote={(path, id) => setFootnoteAt({ path, id })}
                corner={ribbonFor}
                onPages={setColumnPages}
                intent={columnIntent}
                handle={column}
              />
            ) : (
              <Page
                view={view}
                turn={turn}
                onFootnote={(id) => setFootnoteAt({ path: view.canonicalPath, id })}
                onSwipe={turnPage}
                areaRef={readingArea}
                onRoot={onRoot}
                corner={ribbonFor(view)}
              />
            )}
          </RunCodeContext.Provider>
          {!offline && (
            <SelectionToolbar
              area={readingArea}
              rootOf={rootOf}
              highlighting={!embedded}
              onAsk={askAbout}
              onExplain={explain}
              explainDisabled={ask.busy}
              onHighlight={highlightSelection}
              onReadAloud={canReadAloud ? readAloudFrom : undefined}
              lang={view.book.language}
              onLookUp={
                embedded
                  ? undefined
                  : (selected) => {
                      document.getSelection()?.removeAllRanges()
                      lookup.open(selected)
                    }
              }
            />
          )}

          <SideArrows view={view} turnPage={turnPage} />
          <PictureViewer picture={picture} onClose={closePicture} />
          <RunDialog
            target={runTarget}
            access={runAccess(viewer)}
            edits={runEdits}
            onClose={() => setRunTarget(null)}
          />
        </div>

        {!offline && (
          <aside
            aria-label="Ask this book"
            data-chrome
            className="sticky top-[var(--site-nav-h)] hidden h-[calc(100dvh-var(--site-nav-h)-var(--player-h))] w-[380px] shrink-0 flex-col border-l border-r-line bg-r-page min-[900px]:ask-open:flex embed:hidden!"
          >
            <AskPanel
              view={view}
              signedIn={signedIn}
              ask={ask}
              voice={askVoice}
              active={panelOpen}
              heading={<h2 className="font-display text-[16px] font-semibold">Ask this book</h2>}
              onClose={toggleAsk}
              textareaRef={askBox}
              currentHref={view.canonicalPath}
              quote={askQuote}
              onClearQuote={() => setAskQuote(null)}
              highlightPages={highlightPages}
            />
          </aside>
        )}
      </div>

      <BottomBar view={view} goTo={goTo} onShare={share} />

      <ContentsDrawer
        view={view}
        open={tocOpen && !desktop}
        onOpenChange={setTocOpen}
        {...tocTabs(() => setTocOpen(false))}
      />
      <HighlightPopover
        item={popoverItem}
        rect={popover?.rect ?? null}
        tone={view.book.tone}
        onClose={() => setPopover(null)}
        onColor={(color) => popoverItem && highlights.recolor(popoverItem.key, color)}
        onNote={() => {
          setPopover(null)
          if (popoverItem) openHighlights({ key: popoverItem.key, focus: true })
        }}
        onAsk={() => {
          const quote = popoverQuote()
          setPopover(null)
          if (quote) askAbout(quote)
        }}
        onExplain={() => {
          const quote = popoverQuote()
          setPopover(null)
          if (quote) explain(quote)
        }}
        explainDisabled={ask.busy}
        onCopy={async () => {
          const text = popoverItem?.text ?? ''
          setPopover(null)
          try {
            await navigator.clipboard.writeText(text)
            toast('Copied')
          } catch {
            toast('Couldn’t copy the passage')
          }
        }}
        onDelete={() => {
          setPopover(null)
          if (popoverItem) void highlights.remove(popoverItem.key)
        }}
      />
      <LookupCard
        lookup={lookup}
        signedIn={signedIn}
        bookLang={view.book.language}
        tone={view.book.tone}
        desktop={desktop}
        currentHref={view.canonicalPath}
        explainDisabled={ask.busy}
        onExplain={(term, quote) => {
          lookup.dispatch({ type: 'close' })
          askAction('define', quote, `What does “${term}” mean here?`)
        }}
      />
      <FootnoteSheet tone={view.book.tone} footnote={footnote} onClose={() => setFootnoteAt(null)} />
      <AskSheet open={sheetOpen && !offline} onOpenChange={setAskSheetOpen} tone={view.book.tone}>
        <AskPanel
          view={view}
          signedIn={signedIn}
          ask={ask}
          voice={askVoice}
          active={sheetOpen}
          heading={<Drawer.Title className="font-display text-[16px] font-semibold">Ask this book</Drawer.Title>}
          onClose={() => setAskSheetOpen(false)}
          onNavigate={() => setAskSheetOpen(false)}
          currentHref={view.canonicalPath}
          quote={askQuote}
          onClearQuote={() => setAskQuote(null)}
          highlightPages={highlightPages}
        />
      </AskSheet>
    </div>
  )
}

function OfflineChip() {
  return (
    <span
      data-chrome
      data-testid="reader-offline"
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-r-line bg-r-paper/90 px-3 text-[13px] font-medium text-r-muted"
    >
      <CloudOff className="size-4" aria-hidden />
      Offline
    </span>
  )
}

/** Where the painted highlight with this key starts on screen: its first line box, or its whole box. */
function paintedRect(ranges: readonly { key: string; range: Range }[], key: string): DOMRect | undefined {
  const range = ranges.find((r) => r.key === key)?.range
  return range?.getClientRects()[0] ?? range?.getBoundingClientRect()
}

function newHighlight(view: ReaderView, passage: Selected): NewHighlight {
  const position = positionOf(view)
  return {
    position,
    start: passage.start,
    end: passage.end,
    text: passage.text,
    place: {
      chapterIndex: view.chapterIndex,
      chapterTitle: view.chapterTitle,
      ...toStored(position),
      pageHref: view.canonicalPath,
      label: labelOf(view),
      position: view.nav.progress.position - 1,
      start: passage.start,
      end: passage.end,
    },
  }
}

const FLASH_MS = 2000
const FLASH_PULSES = [0, 400, 700, 1100, 1400]

/** Scrolls to the highlight a `#highlight-<id>` hash names on this page and flashes it, once per page and highlight. */
function useHighlightArrival(
  path: string,
  pageItems: readonly HighlightItem[],
  pageRoot: HTMLElement | null,
  reduce: boolean | null,
  setFlash: (key: string | null) => void,
) {
  const hash = useRouterState({ select: (s) => s.location.hash })
  const arrived = useRef<string | null>(null)
  useEffect(() => {
    const id = /^#?highlight-([0-9a-f-]{36})$/.exec(hash)?.[1]
    const item = id ? pageItems.find((h) => h.id === id) : undefined
    if (!item?.place || !pageRoot || arrived.current === `${path}#${item.id}`) return
    const range = rangeFor(readPage(pageRoot), item.place.start, item.place.end)
    if (!range) return
    arrived.current = `${path}#${item.id}`
    const rect = range.getBoundingClientRect()
    window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: reduce ? 'auto' : 'smooth' })
    const timers = (reduce ? [0] : FLASH_PULSES).map((at, i) =>
      window.setTimeout(() => setFlash(i % 2 === 0 ? item.key : null), at),
    )
    timers.push(window.setTimeout(() => setFlash(null), FLASH_MS))
    return () => {
      for (const t of timers) window.clearTimeout(t)
      setFlash(null)
    }
  }, [hash, pageItems, pageRoot, path, reduce, setFlash])
}

const SCROLL_KEYS = new Set(['PageUp', 'PageDown', ' ', 'Home', 'End', 'ArrowUp', 'ArrowDown'])

function useVoiceOnPage(
  view: ReaderView,
  roots: ReadonlyMap<string, HTMLElement>,
  viewFor: (path: string) => ReaderView | null,
  embedded: boolean,
  column: React.RefObject<ColumnHandle | null> | null,
  intent: NavigationIntent,
) {
  const router = useRouter()
  const reduce = useReducedMotion()
  const { readAloud } = usePlayer()
  const canReadAloud = readAloud.supported && !embedded
  const voiceOnBook = readAloud.book?.slug === view.book.slug
  const voiceHref = voiceOnBook ? (readAloud.page?.href ?? null) : null
  const voiceHere = voiceHref === view.canonicalPath
  const voiceRoot = voiceHref && viewFor(voiceHref) ? (roots.get(voiceHref) ?? null) : null
  const readingHere =
    (voiceHere && readAloud.status === 'playing') || (readAloud.status === 'loading' && voiceOnBook && !voiceHref)
  const readAloudHere = () => {
    if (voiceHere) {
      readAloud.setFollowing(true)
      readAloud.toggle()
      return
    }
    readAloud.start(view.book.slug, { kind: 'page', chapter: view.chapterIndex, position: positionOf(view) })
  }
  const readAloudFrom = (offset: number, path: string) => {
    document.getSelection()?.removeAllRanges()
    const page = viewFor(path) ?? view
    readAloud.start(page.book.slug, {
      kind: 'offset',
      chapter: page.chapterIndex,
      position: positionOf(page),
      offset,
    })
  }
  const followingRef = useRef(false)
  followingRef.current = voiceOnBook && readAloud.following
  const { setFollowing } = readAloud
  const stopFollowing = useCallback(() => {
    if (followingRef.current) setFollowing(false)
  }, [setFollowing])

  const utterance = readAloud.utterance
  const following = readAloud.following
  useEffect(() => {
    if (!voiceRoot || !utterance) {
      paintSpeaking(null)
      return
    }
    const range = rangeFor(readPage(voiceRoot), utterance.start, utterance.end)
    paintSpeaking(range)
    if (!range || !following) return
    const rect = range.getBoundingClientRect()
    if (rect.top < 80 || rect.bottom > window.innerHeight - 160)
      window.scrollBy({
        top: rect.top + rect.height / 2 - window.innerHeight / 2,
        behavior: reduce ? 'auto' : 'smooth',
      })
  }, [voiceRoot, utterance, following, reduce])
  useEffect(() => () => paintSpeaking(null), [])

  useEffect(() => {
    if (!voiceRoot || !utterance) {
      paintWord(null)
      return
    }
    const page = readPage(voiceRoot)
    const paint = (span: WordSpan) => paintWord(span && rangeFor(page, span.start, span.end))
    paint(wordMark.get())
    const unsubscribe = wordMark.subscribe(paint)
    return () => {
      unsubscribe()
      paintWord(null)
    }
  }, [voiceRoot, utterance])

  const turningTo = useRef<string | null>(null)
  useEffect(() => {
    if (!voiceHref || voiceHere || !following || readAloud.status !== 'playing') return
    if (turningTo.current === voiceHref) return
    turningTo.current = voiceHref
    if (column?.current && view.nav.dots.some((d) => d.href === voiceHref)) {
      column.current.reveal(voiceHref, { scroll: false })
      return
    }
    intent.send({ type: 'voiceTurned' })
    router
      .navigate({ href: voiceHref, replace: true })
      .catch(() => intent.send({ type: 'voiceTurnFailed' }))
      .finally(() => {
        if (turningTo.current === voiceHref) turningTo.current = null
      })
  }, [voiceHref, voiceHere, following, readAloud.status, router, column, view.nav.dots, intent])
  useEffect(() => {
    if (!following) turningTo.current = null
  }, [following])

  const scrollFollowing = column !== null && following && voiceOnBook
  useEffect(() => {
    if (!scrollFollowing) return
    const outside = (e: Event) => !(e.target as HTMLElement | null)?.closest?.('aside, [role="dialog"]')
    const onPointer = (e: Event) => {
      if (outside(e)) stopFollowing()
    }
    const onKey = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
      const el = event.target as HTMLElement | null
      if (el?.closest(TYPING_OR_DIALOG)) return
      if (event.key === ' ' && el?.closest('button, a, [role="button"], [role="slider"]')) return
      stopFollowing()
    }
    window.addEventListener('wheel', onPointer, { passive: true })
    window.addEventListener('touchmove', onPointer, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onPointer)
      window.removeEventListener('touchmove', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [scrollFollowing, stopFollowing])

  const voicePlacesPage = useCallback((href: string) => followingRef.current && voiceHref === href, [voiceHref])

  return { canReadAloud, readingHere, readAloudHere, readAloudFrom, stopFollowing, voicePlacesPage }
}

const FULLSCREEN_KEY = 'reader-fullscreen'

function clearFullscreenFlag() {
  document.documentElement.removeAttribute('data-reader-fullscreen')
  sessionStorage.removeItem(FULLSCREEN_KEY)
}

function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    if (sessionStorage.getItem(FULLSCREEN_KEY) === 'on') {
      root.setAttribute('data-reader-fullscreen', 'on')
      setFullscreen(true)
    }
    root.removeAttribute('data-reader-fullscreen-pending')
    const onChange = () => {
      if (!document.fullscreenElement && root.getAttribute('data-reader-fullscreen') === 'on') {
        clearFullscreenFlag()
        setFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      clearFullscreenFlag()
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const toggleFullscreen = async () => {
    const root = document.documentElement
    if (fullscreen) {
      clearFullscreenFlag()
      setFullscreen(false)
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      return
    }
    root.setAttribute('data-reader-fullscreen', 'on')
    sessionStorage.setItem(FULLSCREEN_KEY, 'on')
    setFullscreen(true)
    await root.requestFullscreen?.().catch(() => {})
  }

  return [fullscreen, toggleFullscreen] as const
}

function useNavigationIntent() {
  const state = useRef<navigation.Intent>(navigation.IDLE)
  const [intent] = useState(() => ({
    send: (event: navigation.IntentEvent) => {
      state.current = navigation.next(state.current, event)
    },
    arrival: (href: string, voicePlaces: boolean) => navigation.arrival(state.current, href, voicePlaces),
    canTurn: () => navigation.canTurn(state.current),
    showsLoadingBar: () => navigation.showsLoadingBar(state.current),
  }))
  return intent
}
type NavigationIntent = ReturnType<typeof useNavigationIntent>

function LoadingBar({ shows }: { shows: () => boolean }) {
  const loading = useRouterState({ select: (s) => s.status === 'pending' })
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!loading || !shows()) {
      setShow(false)
      return
    }
    const timer = setTimeout(() => setShow(true), 260)
    return () => clearTimeout(timer)
  }, [loading, shows])
  if (!show) return null
  return (
    <div
      className="fixed inset-x-0 top-0 z-[100] h-[2px] overflow-hidden bg-r-accent/15"
      role="progressbar"
      data-testid="reader-loading"
      aria-label="Loading page"
    >
      <div className="h-full w-2/5 animate-[indeterminate_1s_ease-in-out_infinite] bg-r-accent" />
    </div>
  )
}
