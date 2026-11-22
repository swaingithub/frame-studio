import { Blend, Circle, Columns2, Droplets, Move, RotateCw, Square, Sun, ZoomIn, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import type { VideoTransition } from '../sequenceModel'

/** Family glyph shown on the clip's transition badge. */
export function TransitionIcon({ type }: { type: VideoTransition }): ReactNode {
  if (type === 'dissolve') return <Blend size={8} />
  if (type === 'fadeBlack') return <Square size={8} />
  if (type === 'fadeWhite') return <Sun size={8} />
  if (type === 'circle') return <Circle size={8} />
  if (type === 'zoom' || type === 'zoomBlur') return <ZoomIn size={8} />
  if (type === 'blur') return <Droplets size={8} />
  if (type === 'spin') return <RotateCw size={8} />
  if (type === 'flash') return <Zap size={8} />
  if (type === 'barnDoor') return <Columns2 size={8} />
  return <Move size={8} />
}
