import { AudioLines, Clapperboard, Captions, Type } from 'lucide-react'
import type { SourceKind } from '../lib/api'

export const fmtTime = (t: number | null | undefined) => {
  if (t == null) return '–'
  const m = Math.floor(t / 60), s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

const KIND_LABEL: Record<SourceKind, string> = { capture: 'Capture', audio: 'Audio', video: 'Video', subtitle: 'Subs', text: 'Text' }
const KIND_ICON = { audio: AudioLines, video: Clapperboard, subtitle: Captions, text: Type, capture: Type }

/** The panel a sentence came from: the screenshot, or the span of native audio. */
export function SourcePanel({ kind, image, start, end, big, alt = '' }: {
  kind: SourceKind; image?: string | null; start?: number | null; end?: number | null; big?: boolean; alt?: string
}) {
  const cls = 'panel ' + (big ? 'big' : 'thumb')
  if (image) {
    return <figure className={cls} style={{ margin: 0 }}><img src={image} alt={alt} loading="lazy" /><span className="kind">{KIND_LABEL[kind]}</span></figure>
  }
  const Icon = KIND_ICON[kind]
  if (start != null) {
    return (
      <div className={cls + ' clip'}>
        <span className="kind">{KIND_LABEL[kind]}</span>
        <Icon aria-hidden="true" style={{ justifySelf: 'center', width: 22, height: 22 }} />
        <span className="time">{fmtTime(start)}</span>
        <span className="meta num">{end != null ? `${(end - start).toFixed(1)} s` : ''}</span>
      </div>
    )
  }
  return <div className={cls + ' text'}><span className="kind">{KIND_LABEL[kind]}</span><Icon aria-hidden="true" /></div>
}
