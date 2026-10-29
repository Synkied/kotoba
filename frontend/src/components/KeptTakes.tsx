import { Download, Play, Square, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, type KeptTake } from '../lib/api'
import { playUrl, stopAudio } from '../lib/audio'
import { Furigana } from './Furigana'
import { fmtTime } from './SourcePanel'
import { Stamp } from './Stamp'
import { SentenceText } from './SentenceText'
import { useToast } from './ui'
import { Button, buttonClass } from './ds'

export function ago(at: string) {
  const when = new Date(at)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(when).setHours(0, 0, 0, 0)) / 864e5)
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : when.toLocaleDateString()
}

/** A take's file name: which sentence, its first words, the score and the day. */
export function takeName(s: { id: number; text: string }, overall?: number, at = new Date().toISOString()) {
  const words = s.text.replace(/[\\/:*?"<>|\s。、.,!?！？「」]+/g, '').slice(0, 16)
  const day = new Date(at).toLocaleDateString('sv')  // YYYY-MM-DD, in local time
  return ['kotoba', s.id, words, overall, day].filter((x) => x !== undefined && x !== '').join('-') + '.wav'
}

/** Every take you kept, one row each: hear it, download it, go to its sentence, or let it go
 *  (the score stays). `go` is what the sentence leads to: its page, or a place in a run. */
export function KeptTakeRows({ takes, furigana, go, onDropped }: {
  takes: KeptTake[]; furigana: boolean
  go: (t: KeptTake) => ReactNode
  onDropped: (t: KeptTake) => void
}) {
  const [on, setOn] = useState<number | null>(null)
  const [dropping, setDropping] = useState<number | null>(null)
  const toast = useToast()
  useEffect(() => () => { stopAudio() }, [])
  const play = async (t: KeptTake) => {
    if (on === t.id) { stopAudio(); return }
    setOn(t.id)
    try { await playUrl(t.audio) } catch (e) { toast({ text: (e as Error).message }) }
    finally { setOn((cur) => (cur === t.id ? null : cur)) }
  }
  const drop = async (t: KeptTake) => {
    if (on === t.id) stopAudio()
    setDropping(t.id)
    try { await api.dropTake(t.id); onDropped(t); toast({ text: 'Take let go. The score stays.' }) }
    catch (e) { toast({ text: 'The take was not let go: ' + (e as Error).message }) }
    finally { setDropping(null) }
  }
  return (
    <ul className="rows kept-rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {takes.map((t) => (
        <li key={t.id} className={'row' + (on === t.id ? ' now' : '')}>
          <Button variant="ghost" icon className="kept-play" onClick={() => play(t)} aria-pressed={on === t.id}
            aria-label={on === t.id ? 'Stop' : `Hear your take of “${t.sentence.text}”, scored ${t.overall}`}>
            {on === t.id ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <SentenceText><Furigana text={t.sentence.text} pairs={t.sentence.furigana} show={furigana} lookup={false} /></SentenceText>
            <span className="meta">
              <Link to={`/sources/${t.sentence.source}`}>{t.sentence.source_title || 'Untitled'}</Link>
              {t.sentence.start != null && <> · <span className="num">{fmtTime(t.sentence.start)}</span></>}
              {' · '}kept {ago(t.created_at)}
            </span>
          </div>
          <div className="acts">
            {go(t)}
            <a className={buttonClass({ variant: 'ghost', size: 'small', icon: true })} href={t.audio} download={takeName(t.sentence, t.overall, t.created_at)}
              aria-label={`Download your take from ${ago(t.created_at)}, scored ${t.overall}`} title="Download this take as a WAV file">
              <Download aria-hidden="true" />
            </a>
            <Button variant="ghost" size="small" icon disabled={dropping === t.id} onClick={() => drop(t)}
              aria-label="Let this take go" title="Let this take go. The score stays.">
              <Trash2 aria-hidden="true" />
            </Button>
            <Stamp s={t} />
          </div>
        </li>
      ))}
    </ul>
  )
}
