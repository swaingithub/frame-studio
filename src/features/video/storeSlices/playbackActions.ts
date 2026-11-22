import type { VideoActions } from '../store'
import type { EditorSet } from '../storeHelpers'

/** Playback/inspector state: playhead, time, play/pause, timing, palette. */
export function playbackActions(
  set: EditorSet,
): Pick<VideoActions, 'setPlaying' | 'setTime' | 'setHistogram' | 'setBypass' | 'setExporting' | 'setProMode'> {
  return {
    setPlaying: (v) => set({ playing: v }),
    setTime: (t) => set({ currentTime: Math.max(0, t) }),
    setHistogram: (h) => set({ histogram: h }),
    setBypass: (v) => set({ bypass: v }),
    setExporting: (v) => set({ exporting: v }),
    setProMode: (v) => {
      set({ proMode: v })
      if (typeof localStorage !== 'undefined') localStorage.setItem('frame-studio:proMode', v ? '1' : '0')
    },
  }
}
