import { ChevronLeft, Play, Volume2, Pencil, Check, Archive, Inbox as InboxIcon, Scissors } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Sentence, type Source } from '../lib/api'
import { playClip, stopAudio } from '../lib/audio'
import { Balloon } from '../components/Balloon'
import { Furigana } from '../components/Furigana'
import { SourcePanel, fmtTime } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { DeckPicker } from '../components/DeckPicker'
import { ErrorNotice, Skeleton, clock, dayLabel, useAsync, usePref, useToast } from '../components/ui'
import { CopyButton } from './Library'

export default function SourcePage() {
  const id = Number(useParams().id)
  const { data: s, error, set } = useAsync(() => api.source(id), [id])
  const [furigana] = usePref('furigana', true)
  const [playing, setPlaying] = useState<number | null>(null)
  const [labels, setLabels] = useState<string | null>(null)
  const toast = useToast()
  if (error) return <ErrorNotice error={error} />
  if (!s) return <Skeleton rows={3} />

  const play = async (x: Sentence) => {
    if (playing === x.id) { stopAudio(); setPlaying(null); return }
    setPlaying(x.id)
    try { await playClip(s.media!, x.start!, x.end!) } finally { setPlaying((p) => (p === x.id ? null : p)) }
  }
  const status = async (st: Source['status']) => { set(await api.updateSource(s.id, { status: st })); toast({ text: st === 'kept' ? 'Moved to the library' : st === 'archived' ? 'Archived' : 'Back in the inbox' }) }
  const { date } = dayLabel(s.created_at)

  return (
    <>
      <header className="page-head">
        <Link className="btn icon ghost" to={s.status === 'inbox' ? '/inbox' : '/library'} aria-label="Back"><ChevronLeft aria-hidden="true" /></Link>
        <h1>{s.title || (s.kind === 'capture' ? 'Capture' : 'Source')} <span className="meta num">{s.sentences.length} sentences</span></h1>
        <span className="grow" />
        {s.status !== 'kept' && <button className="btn" onClick={() => status('kept')}><Check aria-hidden="true" />Keep</button>}
        {s.status === 'kept' && <button className="btn ghost" onClick={() => status('inbox')}><InboxIcon aria-hidden="true" />Back to inbox</button>}
        {s.status !== 'archived' && <button className="btn ghost" onClick={() => status('archived')}><Archive aria-hidden="true" />Archive</button>}
        {s.media && (s.kind === 'audio' || s.kind === 'video') && <Link className="btn" to={`/recordings/${s.id}`}><Scissors aria-hidden="true" />Clean up</Link>}
        {s.sentences.length > 0 && <DeckPicker sentenceIds={() => s.sentences.map((x) => x.id)} />}
        {s.sentences.length > 0 && <Link className="btn red" to={`/practice?source=${s.id}`}><Play aria-hidden="true" />Practise all</Link>}
      </header>

      <div className="source-layout">
        <div style={{ display: 'grid', gap: 'var(--s-4)', position: 'sticky', top: 'var(--s-4)' }}>
          <SourcePanel big kind={s.kind} image={s.image} start={s.sentences[0]?.start} end={s.sentences.at(-1)?.end} alt={s.text} />
          {s.media && <audio controls src={s.media} style={{ width: '100%' }} preload="none" />}
          <dl className="meta" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0 }}>
            <dt>Collected</dt><dd style={{ margin: 0 }}>{date}, {clock(s.created_at)}</dd>
            <dt>Status</dt><dd style={{ margin: 0 }}>{{ inbox: 'In the inbox', kept: 'In the library', archived: 'Archived' }[s.status]}</dd>
            {s.duration && <><dt>Length</dt><dd style={{ margin: 0 }} className="num">{fmtTime(s.duration)}</dd></>}
          </dl>
          <div style={{ display: 'grid', gap: 8 }}>
            {labels === null ? (
              <div className="chips" style={{ alignItems: 'center' }}>
                {s.category && <span className="plate">{s.category}</span>}
                {s.labels.map((l) => <span key={l} className="chip">{l}</span>)}
                <button className="btn small ghost" onClick={() => setLabels(s.labels.join(', '))}><Pencil aria-hidden="true" />{s.labels.length ? 'Edit labels' : 'Add labels'}</button>
              </div>
            ) : (
              <form className="edit-line" onSubmit={async (e) => { e.preventDefault(); set(await api.updateSource(s.id, { labels: labels.split(',').map((x) => x.trim()).filter(Boolean) })); setLabels(null) }}>
                <label style={{ flex: 1 }}><span className="sr">Labels, comma separated (up to 3)</span>
                  <input className="input" autoFocus value={labels} placeholder="minna no nihongo, lesson 18" onChange={(e) => setLabels(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLabels(null)} /></label>
                <button className="btn small primary">Save</button>
              </form>
            )}
          </div>
        </div>

        <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {s.sentences.map((x, k) => <SentenceRow key={x.id} x={x} first={k === 0} furigana={furigana} audio={!!s.media} playing={playing === x.id}
            onPlay={() => play(x)} onSaved={(nx) => set({ ...s, sentences: s.sentences.map((y) => (y.id === nx.id ? nx : y)) })} />)}
          {!s.sentences.length && <li className="empty"><h2>No sentences yet</h2><p>{s.job ? 'They appear once the audio is transcribed.' : 'This source has no text.'}</p></li>}
        </ol>
      </div>
    </>
  )
}

function SentenceRow({ x, first, furigana, audio, playing, onPlay, onSaved }: {
  x: Sentence; first: boolean; furigana: boolean; audio: boolean; playing: boolean; onPlay: () => void; onSaved: (x: Sentence) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <li className="row" style={{ gridTemplateColumns: audio ? 'auto minmax(0,1fr) auto' : 'minmax(0,1fr) auto' }}>
      {audio && (
        <div className="lead">
          <button className="btn small icon" onClick={onPlay} aria-label={playing ? 'Stop' : `Play ${fmtTime(x.start)}`} aria-pressed={playing}><Volume2 aria-hidden="true" /></button>
          <span className="tc num">{fmtTime(x.start)}</span>
        </div>
      )}
      {draft !== null ? (
        <form className="edit-line" onSubmit={async (e) => { e.preventDefault(); if (draft.trim()) onSaved(await api.updateSentence(x.id, { text: draft })); setDraft(null) }}>
          <label style={{ flex: 1 }}><span className="sr">Sentence text</span>
            <input className="input" lang="ja" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setDraft(null)} /></label>
          <button className="btn small primary">Save</button>
        </form>
      ) : (
        <Balloon tail={first ? 'left' : 'none'}>
          <Furigana text={x.text} pairs={x.furigana} show={furigana} />
          {x.roman && <span className="roman">{x.roman.split('\t')[0]}</span>}
        </Balloon>
      )}
      <div className="acts">
        <Stamps stamps={x.stamps} max={3} />
        <CopyButton text={x.text} />
        <button className="btn small icon ghost" aria-label="Fix the text" title="Fix the text" onClick={() => setDraft(x.text)}><Pencil aria-hidden="true" /></button>
      </div>
    </li>
  )
}
