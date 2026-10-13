import { Check, Square, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api, type Sentence, type WordIndex, type WordRow } from '../lib/api'
import { playClip, speak, stopAudio } from '../lib/audio'
import { usePref } from './ui'
import { Button, Notice, Plate } from './ds'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The views of Words: every word in your sentences, and the sentences you're one word away from. */
export function WordsTabs() {
  return (
    <nav className="tabs sources-tabs" aria-label="Words views">
      <NavLink to="/words" end>Words</NavLink>
      <NavLink to="/words/next">Next sentences</NavLink>
    </nav>
  )
}

/** Known (yours to say) in ink, practised hollow; a word you keep missing gets the red plate. */
export function WordPlates({ w }: { w: Pick<WordRow, 'status' | 'trouble' | 'tries' | 'misses'> }) {
  return <>
    {w.status === 'known' && <Plate>known</Plate>}
    {w.status === 'practised' && <Plate tone="hollow" title="You've said a sentence with it well">practised</Plate>}
    {w.trouble && <Plate tone="accent" title="Missed or unclear in your latest attempts">missed {w.misses} of {w.tries}</Plate>}
  </>
}

/** Mark a word known, or not. */
export function KnownButton({ w, onChange, small }: { w: Pick<WordRow, 'id' | 'lemma' | 'status'>; onChange: (known: boolean) => void; small?: boolean }) {
  const [busy, setBusy] = useState(false)
  const known = w.status === 'known'
  return (
    <Button size={small ? 'small' : undefined} variant={known ? undefined : 'ghost'} aria-pressed={known} disabled={busy}
      title={known ? `You know ${w.lemma}. Press to undo.` : `Mark ${w.lemma} as a word you know`}
      onClick={async () => {
        setBusy(true)
        try { await api.markWord(w.id, !known); onChange(!known) } finally { setBusy(false) }
      }}>
      <Check aria-hidden="true" />{known ? 'Known' : 'I know this'}
    </Button>
  )
}

export function IndexNotice({ state, onChange }: { state: WordIndex | undefined; onChange: () => void }) {
  const [asked, setAsked] = useState<string | null>(null)
  if (!state) return null
  const downloading = state.dictionary === 'downloading' || asked === 'downloading'
  return <>
    {state.pending > 0 && <Notice as="p" role="status">Finding the words in {plural(state.pending, 'sentence')}… This page updates as it goes.</Notice>}
    {state.dictionary !== 'ready' && <p className="meta index-dict">
      {downloading ? 'The dictionary is downloading. Your words are found again with it once it’s in.' : <>
        Without the dictionary, words are only roughly found and have no meanings.{' '}
        <Button size="small" onClick={async () => {
          try { setAsked((await api.fetchDictionary()).state); onChange() } catch { setAsked('error') }
        }}>Get the dictionary</Button> (once, about 12 MB)
        {asked === 'error' && ' Couldn’t start the download. Check the connection and try again.'}
      </>}
    </p>}
  </>
}

/** Hear a sentence: its own seconds of native audio when it has them, else your chosen voice. */
export function ListenSentence({ s }: { s: Sentence }) {
  const [playing, setPlaying] = useState(false)
  const [voice] = usePref<string>('voice', 'browser')
  useEffect(() => () => { if (playing) stopAudio() }, [playing])
  const label = playing ? 'Stop' : s.has_audio ? 'Listen to the native audio' : 'Listen in your voice'
  return (
    <Button variant="ghost" size="small" icon aria-pressed={playing} aria-label={label} title={label}
      onClick={async () => {
        if (playing) { stopAudio(); setPlaying(false); return }
        setPlaying(true)
        try {
          if (s.has_audio) await playClip(`/api/sources/${s.source}/media`, s.start!, s.end!)
          else await speak(s.text, voice, 1, undefined, s.id)
        } catch { /* stopped, or nothing to play */ } finally { setPlaying(false) }
      }}>
      {playing ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </Button>
  )
}
