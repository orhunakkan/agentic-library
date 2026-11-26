import type { Viewer } from '~/server/auth'
import { ClosingCall } from './ClosingCall'
import { Faq } from './Faq'
import { Features } from './Features'
import { Hero } from './Hero'
import { HomeFooter } from './HomeFooter'
import { HomeHeader } from './HomeHeader'
import { ReaderPreview } from './ReaderPreview'
import { StorybookPanel } from './StorybookPanel'

export function HomePage({ viewer }: { viewer: Viewer | null }) {
  return (
    <div id="top">
      <HomeHeader viewer={viewer} />
      <main id="main" className="page-wrap">
        <Hero viewer={viewer} />
        <ReaderPreview />
        <Features />
        <StorybookPanel />
        <Faq />
        <ClosingCall viewer={viewer} />
      </main>
      <HomeFooter viewer={viewer} />
    </div>
  )
}
