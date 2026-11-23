import type { Hue } from '~/shared/content/hues'

export interface HueClasses {
  dot: string
  fill: string
  tint: string
  ink: string
}

export const HUE_CLASSES: Record<Hue, HueClasses> = {
  violet: {
    dot: 'bg-hue-violet',
    fill: 'bg-hue-violet text-on-hue',
    tint: 'bg-hue-violet/15 border-hue-violet/30',
    ink: 'text-hue-violet-ink',
  },
  coral: {
    dot: 'bg-hue-coral',
    fill: 'bg-hue-coral text-on-hue',
    tint: 'bg-hue-coral/15 border-hue-coral/30',
    ink: 'text-hue-coral-ink',
  },
  cyan: {
    dot: 'bg-hue-cyan',
    fill: 'bg-hue-cyan text-on-hue',
    tint: 'bg-hue-cyan/15 border-hue-cyan/30',
    ink: 'text-hue-cyan-ink',
  },
  lime: {
    dot: 'bg-hue-lime',
    fill: 'bg-hue-lime text-on-hue',
    tint: 'bg-hue-lime/15 border-hue-lime/30',
    ink: 'text-hue-lime-ink',
  },
  amber: {
    dot: 'bg-hue-amber',
    fill: 'bg-hue-amber text-on-hue',
    tint: 'bg-hue-amber/15 border-hue-amber/30',
    ink: 'text-hue-amber-ink',
  },
  pink: {
    dot: 'bg-hue-pink',
    fill: 'bg-hue-pink text-on-hue',
    tint: 'bg-hue-pink/15 border-hue-pink/30',
    ink: 'text-hue-pink-ink',
  },
}
