import { type ReactNode } from 'react'
import { Volume2 } from 'lucide-react'
import { AdjustSlider } from '../../../ui/adjustSlider'
import { useVideoEditor } from '../store'
import type { VideoEditDoc } from '../model'
import { Heading } from './InspectorUi'

export function AudioControls({ doc }: { doc: VideoEditDoc }): ReactNode {
  const setVolume = useVideoEditor((s) => s.setVolume)
  const commitVolume = useVideoEditor((s) => s.commitVolume)
  return (
    <section>
      <Heading icon={<Volume2 size={11} />}>Audio</Heading>
      <AdjustSlider
        param={{ label: 'Volume', min: 0, max: 150, def: 100 }}
        value={doc.volume}
        onLive={setVolume}
        onCommit={() => commitVolume()}
        onReset={() => {
          setVolume(100)
          commitVolume()
        }}
      />
    </section>
  )
}
