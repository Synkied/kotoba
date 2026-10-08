import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { Languages, RefreshCw } from 'lucide-react'
import { api, ApiError, type Language, type Sentence } from '../lib/api'
import { usePref } from './ui'

/** Furigana, romaji and a translation: what helps you read a sentence. One row of
 *  pressed chips, always right under the text. */
export function useAids() {
  const [furigana, setFurigana] = usePref('furigana', true)
  const [roman, setRoman] = usePref('roman', false)
  const [translation, setTranslation] = usePref('translation', false)
  return { furigana, setFurigana, roman, setRoman, translation, setTranslation }
}
export type Aids = ReturnType<typeof useAids>

export function ReadingAids({ aids, roman = true, keys = false }: { aids: Aids; roman?: boolean; keys?: boolean }) {
  const lang = useLanguage()
  const chip = (on: boolean, set: (v: boolean) => void, label: React.ReactNode, key: string, title: string) =>
    <button type="button" className="chip" aria-pressed={on} onClick={() => set(!on)} title={keys ? `${title} (${key})` : title}>{label}</button>
  return (
    <div className="aids" role="group" aria-label="Reading aids">
      {chip(aids.furigana, aids.setFurigana, <span lang="ja">ふりがな</span>, 'F', 'Furigana over the kanji')}
      {roman && chip(aids.roman, aids.setRoman, 'romaji', 'R', 'The reading in Latin letters')}
      {chip(aids.translation, aids.setTranslation, lang?.name ?? 'Translation', 'T', 'Translation, chosen in Add-ons')}
    </div>
  )
}

// --- the language translations are in: one setting on the server ----------------------

let language: Language | null = null
let asked = false
const listeners = new Set<() => void>()
export function setLanguage(l: Language) { language = l; listeners.forEach((f) => f()) }
export function useLanguage() {
  const l = useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f) } }, () => language)
  useEffect(() => { if (!asked) { asked = true; api.language().then(setLanguage, () => { asked = false }) } }, [])
  return l
}

// --- a few translations at a time, in reading order: Ollama and llama-server answer several
// requests at once, and one that can't just queues them, so this never costs more than one by one

const PARALLEL = 3
const waiting: (() => Promise<void>)[] = []
let busy = 0
let down: string | null = null  // the translator failed; don't send the rest after it
let attempt = 0
const retryListeners = new Set<() => void>()
const pump = () => {
  while (busy < PARALLEL && waiting.length) {
    busy++
    waiting.shift()!().finally(() => { busy--; pump() })
  }
}
function request(id: number, signal: AbortSignal, force = false) {
  return new Promise<Sentence>((resolve, reject) => {
    const job = async () => {
      if (signal.aborted) return
      if (down) return reject(new Error(down))
      try { resolve(await api.translate(id, force)) } catch (e) {
        if (e instanceof ApiError && e.status === 503) down = e.message
        reject(e)
      }
    }
    waiting.push(job)
    signal.addEventListener('abort', () => { const i = waiting.indexOf(job); if (i >= 0) waiting.splice(i, 1) })
    pump()
  })
}
// --- what has been asked for: translating costs machine time or credits, so nothing goes without a click ----

const wanted = new Set<number>()
let asks = 0
const wantListeners = new Set<() => void>()
function want(ids: number[]) { ids.forEach((id) => wanted.add(id)); asks++; wantListeners.forEach((f) => f()) }
const useAsks = () => useSyncExternalStore((f) => { wantListeners.add(f); return () => { wantListeners.delete(f) } }, () => asks)

function retryAll() { down = null; attempt++; retryListeners.forEach((f) => f()) }
const useAttempt = () => useSyncExternalStore((f) => { retryListeners.add(f); return () => { retryListeners.delete(f) } }, () => attempt)

/** The sentence's translation. A missing one is asked for only once the reader clicks for it
 *  (or Translate all); auto is for places where showing it already was the click. */
export function Translation({ s, onTranslated, auto = false }: { s: Sentence; onTranslated: (s: Sentence) => void; auto?: boolean }) {
  const lang = useLanguage()
  const round = useAttempt()
  useAsks()
  const [error, setError] = useState<string | null>(null)
  const text = lang ? s.translations[lang.to] : undefined
  const asked = auto || wanted.has(s.id)
  // translating again replaces the one shown (a hand-written one too); it waits in the same queue
  const [redo, setRedo] = useState(0)
  useEffect(() => {
    if (!redo) return
    const stop = new AbortController()
    request(s.id, stop.signal, true).then((x) => { if (!stop.signal.aborted) { onTranslated(x); setRedo(0) } },
      (e) => { if (!stop.signal.aborted) { setError((e as Error).message); setRedo(0) } })
    return () => stop.abort()
  }, [redo]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!lang || text || !asked) return
    const stop = new AbortController()
    setError(null)
    request(s.id, stop.signal).then((x) => { if (!stop.signal.aborted) onTranslated(x) },
      (e) => { if (!stop.signal.aborted) setError((e as Error).message) })
    return () => stop.abort()
  }, [s.id, lang, text, round, asked]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!lang) return null
  if (text) return (
    <span className={'translation' + (redo ? ' pending' : '')} lang={lang.to} aria-busy={redo > 0}>
      {text}{' '}
      <button type="button" className="link again" disabled={redo > 0} onClick={(e) => { e.stopPropagation(); setError(null); setRedo((n) => n + 1) }}
        aria-label={redo ? 'Translating again' : `Translate again into ${lang.name}`} title={redo ? 'Translating again…' : 'Translate again'}>
        <RefreshCw aria-hidden="true" />
      </button>
      {error && <span className="again-error" lang="en" title={error}> Not translated again: {error.split('. ')[0]}.</span>}
    </span>
  )
  if (!asked) return (
    <span className="translation pending" lang="en">
      <button type="button" className="link" onClick={() => want([s.id])}>Translate into {lang.name}</button>
    </span>
  )
  if (error) return (
    <span className="translation failed" lang="en">
      <span title={error}>No translation: {error.split('. ')[0]}.</span>{' '}
      <button type="button" className="link" onClick={retryAll}>Retry</button> · <Link to="/addons">Set up</Link>
    </span>
  )
  return <span className="translation pending" lang="en">Translating…</span>
}

/** Asks for every missing translation at once, after saying what it costs: a cloud translator
 *  spends API credits, a local one keeps this computer busy for a while. */
export function TranslateAll({ sentences }: { sentences: Sentence[] }) {
  const lang = useLanguage()
  useAsks()
  if (!lang) return null
  const missing = sentences.filter((x) => !x.translations[lang.to] && !wanted.has(x.id))
  if (!missing.length) return null
  const n = missing.length, who = lang.translator ?? 'the translator', them = n === 1 ? 'It' : 'They'
  const ask = () => {
    const cost = lang.cloud
      ? `${them} will be sent to ${who}, an online service. Each sentence uses API credits on your account.`
      : `${them} will be translated on this computer or your network by ${who}, one after another. That keeps the processor or graphics card busy and can take a while.`
    if (window.confirm(`Translate ${n} ${n === 1 ? 'sentence' : 'sentences'} into ${lang.name}?\n\n${cost}`)) want(missing.map((x) => x.id))
  }
  return <button type="button" className="btn small ghost" onClick={ask} title={lang.cloud ? 'Uses API credits' : 'Runs on this computer'}><Languages aria-hidden="true" />Translate all <span className="num">({n})</span></button>
}

/** In practice the meaning stays folded until you ask: a hint, not a crib. */
export function MeaningHint({ s, open, onOpen, onTranslated }: { s: Sentence; open: boolean; onOpen: () => void; onTranslated: (s: Sentence) => void }) {
  const lang = useLanguage()
  if (open) return <p className="meaning open"><Translation s={s} onTranslated={onTranslated} auto /></p>
  return (
    <button type="button" className="meaning tone" aria-expanded={false} onClick={onOpen}>
      <span>Show the {lang?.name ?? 'translation'} <kbd className="kbd">T</kbd></span>
    </button>
  )
}
