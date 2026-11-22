import { useMemo, type ReactNode } from 'react'
import { Frame } from 'lucide-react'
import { useVideoEditor, layoutOf, useInspectorTime } from '../store'
import { baseAnimAt, type AnimBase, type VideoClip } from '../sequenceModel'
import { AnimSliderRow, Heading } from './InspectorUi'

/** Keyframed camera (zoom/pan) on the selected base-track clip. */
export function CameraControls({ clip }: { clip: VideoClip }): ReactNode {
  const currentTime = useInspectorTime()
  const clips = useVideoEditor((s) => s.sequence)
  const durations = useVideoEditor((s) => s.durations)
  const setClipAnim = useVideoEditor((s) => s.setClipAnim)
  const commitClipAnim = useVideoEditor((s) => s.commitClipAnim)
  const toggleClipKeyframe = useVideoEditor((s) => s.toggleClipKeyframe)

  const layout = useMemo(() => layoutOf(clips, durations), [clips, durations])
  const entry = layout.entries.find((e) => e.clip.id === clip.id)
  const at = entry ? Math.max(0, Math.min(entry.out, currentTime - entry.globalStart)) : 0
  const anim = baseAnimAt(clip, at)
  const keyAt = (prop: keyof AnimBase): boolean => (clip.keyframes?.[prop].some((k) => Math.abs(k.t - at) < 0.05) ?? false)

  return (
    <section aria-label="Camera controls">
      <Heading icon={<Frame size={11} />}>Camera</Heading>
      <AnimSliderRow
        label="Zoom"
        prop="scale"
        value={anim.scale}
        hasKey={keyAt('scale')}
        onLive={(v) => setClipAnim({ scale: Math.max(1, v) })}
        onCommit={commitClipAnim}
        onReset={() => {
          setClipAnim({ scale: 1 })
          commitClipAnim()
        }}
        onToggleKey={() => toggleClipKeyframe('scale')}
      />
      <AnimSliderRow
        label="Pan X"
        prop="x"
        value={anim.x}
        hasKey={keyAt('x')}
        onLive={(v) => setClipAnim({ x: v })}
        onCommit={commitClipAnim}
        onReset={() => {
          setClipAnim({ x: 0.5 })
          commitClipAnim()
        }}
        onToggleKey={() => toggleClipKeyframe('x')}
      />
      <AnimSliderRow
        label="Pan Y"
        prop="y"
        value={anim.y}
        hasKey={keyAt('y')}
        onLive={(v) => setClipAnim({ y: v })}
        onCommit={commitClipAnim}
        onReset={() => {
          setClipAnim({ y: 0.5 })
          commitClipAnim()
        }}
        onToggleKey={() => toggleClipKeyframe('y')}
      />
      <p className="mt-1 text-[10px] text-lo" aria-hidden>
        Add two diamonds at different times for a smooth zoom/pan auto-curve.
      </p>
    </section>
  )
}
