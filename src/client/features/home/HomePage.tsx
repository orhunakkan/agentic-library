import type { Viewer } from '~/server/auth'
import { ClosingCall } from './ClosingCall'
import { Faq } from './Faq'
import { Features } from './Features'
import { Hero } from './Hero'
import { HomeFooter } from './HomeFooter'
import { HomeHeader } from './HomeHeader'
import { MoreFeatures } from './MoreFeatures'
import { ReaderPreview } from './ReaderPreview'

export function HomePage({ viewer, sourceUrl }: { viewer: Viewer | null; sourceUrl: string | null }) {
  return (
    <div id="top">
      <HomeHeader viewer={viewer} />
      <main id="main" className="page-wrap">
        <Hero viewer={viewer} />
        <ReaderPreview />
        <Features />
        <MoreFeatures />
        <Faq sourceUrl={sourceUrl} />
        <ClosingCall viewer={viewer} />
      </main>
      <HomeFooter viewer={viewer} sourceUrl={sourceUrl} />
    </div>
  )
}
