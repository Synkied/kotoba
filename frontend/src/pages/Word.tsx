import { ChevronLeft, Play, Square, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type WordDetail, type WordSentence } from '../lib/api'
import { speak, stopAudio } from '../lib/audio'
import { Furigana } from '../components/Furigana'
import { SentenceText } from '../components/SentenceText'
import { fmtTime } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { Entries } from '../components/WordLookup'
import { IndexNotice, KnownButton, ListenSentence, WordPlates } from '../components/WordBits'
import { useIndexWait } from '../lib/wordIndex'
import { ErrorNotice, Skeleton, useAsync, usePref } from '../components/ui'
import { Button, ButtonLink, Chip, EmptyState } from '../components/ds'
import { useBackTo } from '../lib/trail'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function WordPage() {
  const id = Number(useParams().id)
  return <Detail key={id} id={id} />
}

/** One word across everything you've collected: what it means, every sentence it's in (heard
 *  from each source's own speaker), the forms it takes (よくない under 良い), and how saying it has gone. */
function Detail({ id }: { id: number }) {
  const { data: w, error, reload, set } = useAsync(() => api.word(id), [id])
  useIndexWait(w, reload)
  const backTo = useBackTo(`word:${id}`, (p) => p.startsWith('/sentences/') || p.startsWith('/practice'))
  const [furigana] = usePref('furigana', true)
  if (error) return <ErrorNotice error={error} action={<ButtonLink size="small" to="/words">All words</ButtonLink>} />
  if (!w) return <Skeleton rows={4} />
  const ids = w.sentence_list.map((s) => s.id)
  const ok = w.results.filter(Boolean).length
  return (
    <div className="word-page">
      <header className="page-head">
        <ButtonLink variant="ghost" icon to={backTo ?? '/words'} aria-label="Back"><ChevronLeft aria-hidden="true" /></ButtonLink>
        <h1 className="word-page-title" lang="ja">{w.lemma}</h1>
        <span className="grow" />
        <KnownButton w={w} onChange={(known) => set((d: WordDetail) => ({ ...d, status: known ? 'known' : d.status === 'known' ? 'new' : d.status, known_at: known ? new Date().toISOString() : null }))} />
        {ids.length > 0 && <ButtonLink variant="primary" to={'/practice?ids=' + ids.join(',')}><Play aria-hidden="true" />Practise {ids.length === 1 ? 'it' : `all ${ids.length}`}</ButtonLink>}
      </header>
      <IndexNotice state={w} onChange={reload} />

      <div className="word-page-layout">
        <section className="word-page-main" aria-label="Sentences">
          <p className="word-page-reading">
            {w.reading && <span lang="ja">{w.reading}</span>} {w.romaji && <span className="word-romaji">{w.romaji}</span>}
            {w.reading && <Say text={w.reading} label={`Listen to ${w.lemma}`} />}
          </p>
          <p className="meta word-page-stats">
            <span className="num">In {plural(w.sentences ?? 0, 'sentence')}{(w.sources ?? 0) > 0 && ` from ${plural(w.sources ?? 0, 'source')}`}</span>
            {w.tries > 0 && <span className="num"> · said right {ok} of {w.tries} recent times</span>}
            {' '}<WordPlates w={w} />
          </p>
          {w.forms.length > 1 && <div className="word-page-forms">
            <span className="meta">Seen as</span>
            <span className="chips" lang="ja">{w.forms.map((f) => <Chip key={f}>{f}</Chip>)}</span>
            <p className="meta">Its conjugations (negative, past…) and other ways of writing or saying it are all filed under <span lang="ja">{w.lemma}</span>.</p>
          </div>}
          {w.sentence_list.length === 0 ? <EmptyState>
            <h2>Not in any sentence you keep</h2>
            <p>It was in sentences that have since gone or been archived. It stays here because you marked it known.</p>
          </EmptyState> : <BySource sentences={w.sentence_list} furigana={furigana} />}
          {w.more > 0 && <p className="meta">And {plural(w.more, 'more sentence')}.</p>}
        </section>

        <aside className="word-page-aside">
          <section className="sentence-section"><h2>Meaning</h2>
            {w.entries.length ? <div className="word-page-entries"><Entries entries={w.entries} /></div>
              : <p className="meta">{w.dictionary === 'ready' ? 'Not in the dictionary.' : 'Meanings come with the dictionary.'}</p>}
          </section>
          {w.kanji.length > 0 && <section className="sentence-section"><h2>Its kanji</h2>
            <ul className="word-kanji">{w.kanji.map((k) => <li key={k.char}>
              <Link to={`/words?q=${encodeURIComponent(k.char)}`} lang="ja" className="word-kanji-char">{k.char}</Link>
              <span className="meta num">{k.words > 1 ? `in ${plural(k.words, 'word')} you’ve met` : 'only in this word so far'}</span>
            </li>)}</ul>
          </section>}
          {w.results.length > 0 && <section className="sentence-section"><h2>Saying it</h2>
            <p className="word-results" aria-label={`Said right ${ok} of ${w.results.length} times, newest first`}>
              {w.results.map((r, i) => <i key={i} className={r ? 'ok' : 'miss'} title={r ? 'Said right' : 'Missed or unclear'} />)}
            </p>
            <p className="meta">Your latest scored attempts at sentences with it, newest first.</p>
          </section>}
        </aside>
      </div>
    </div>
  )
}

/** The sentences grouped under the source they came from, newest source first. */
function BySource({ sentences, furigana }: { sentences: WordSentence[]; furigana: boolean }) {
  const groups: { source: number; title: string; items: WordSentence[] }[] = []
  for (const s of sentences) {
    const g = groups.at(-1)
    if (g?.source === s.source) g.items.push(s)
    else groups.push({ source: s.source, title: s.source_title, items: [s] })
  }
  return <>{groups.map((g) => <section key={g.source} className="word-source" aria-label={g.title || 'Untitled'}>
    <h3 className="day-head"><Link to={`/sources/${g.source}`}>{g.title || 'Untitled'}</Link><span className="meta num">{g.items.length}</span></h3>
    <ul className="rows">{g.items.map((s) => <li key={s.id} className="row">
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <SentenceText><Furigana text={s.text} pairs={s.furigana} show={furigana} marks={s.spans} /></SentenceText>
        {s.start != null && <span className="meta num">{fmtTime(s.start)}</span>}
      </div>
      <div className="acts">
        <ListenSentence s={s} />
        <ButtonLink variant="ghost" size="small" to={`/sentences/${s.id}`}>Details</ButtonLink>
        <span className="record"><Stamps stamps={s.stamps} max={3} /></span>
      </div>
    </li>)}</ul>
  </section>)}</>
}

function Say({ text, label }: { text: string; label: string }) {
  const [voice] = usePref<string>('voice', 'browser')
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => { if (playing) stopAudio() }, [playing])
  return (
    <Button size="small" icon aria-pressed={playing} aria-label={playing ? 'Stop' : label} title={playing ? 'Stop' : label}
      onClick={async () => {
        if (playing) { stopAudio(); setPlaying(false); return }
        setPlaying(true)
        try { await speak(text, voice) } catch { /* nothing to play */ } finally { setPlaying(false) }
      }}>
      {playing ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </Button>
  )
}
