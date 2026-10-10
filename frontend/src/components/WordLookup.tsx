import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { MessageSquareText, RefreshCw, Square, Volume2, X } from 'lucide-react'
import { api, type DictionaryStatus, type Explanation as Explained, type Word } from '../lib/api'
import { speak, stopAudio } from '../lib/audio'
import { Furigana } from './Furigana'
import { useLanguage } from './ReadingAids'
import { usePref } from './ui'

/** Text nodes of the sentence itself, leaving out the furigana in <rt> and <rp>. */
function textNodes(root: Node): Text[] {
  const out: Text[] = []
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement?.closest('rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text)
  return out
}

function hits(node: Text, i: number, x: number, y: number) {
  if (i < 0 || i >= node.length) return false
  const r = document.createRange()
  r.setStart(node, i); r.setEnd(node, i + 1)
  return [...r.getClientRects()].some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)
}

/** The sentence offset of the character under the pointer; a tap on furigana counts as its kanji. */
function offsetAt(root: HTMLElement, x: number, y: number): number | null {
  let node: Node, i: number
  const pos = document.caretPositionFromPoint?.(x, y)
  if (pos) { node = pos.offsetNode; i = pos.offset } else {
    const r = document.caretRangeFromPoint?.(x, y)
    if (!r) return null
    node = r.startContainer; i = r.startOffset
  }
  if (!root.contains(node)) return null
  const rt = (node instanceof Element ? node : node.parentElement)?.closest('rt, rp')
  if (rt) {
    const base = rt.closest('ruby')?.firstChild
    if (!(base instanceof Text)) return null
    node = base; i = 0
  } else if (node instanceof Text) {
    // the caret lands between characters: take the one actually under the pointer
    if (!hits(node, i, x, y)) { if (hits(node, i - 1, x, y)) i -= 1; else return null }
  } else return null
  let at = 0
  for (const t of textNodes(root)) {
    if (t === node) return at + i
    at += t.length
  }
  return null
}

function rangeOf(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange()
  let at = 0, began = false
  for (const t of textNodes(root)) {
    if (!began && start < at + t.length) { range.setStart(t, start - at); began = true }
    if (began && end <= at + t.length) { range.setEnd(t, end - at); return range }
    at += t.length
  }
  return null
}

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void }
const highlights = (): Highlights | undefined => (CSS as unknown as { highlights?: Highlights }).highlights
const Highlight = (globalThis as unknown as { Highlight?: new (r: Range) => unknown }).Highlight

/** The sentence offset of a selection boundary; one inside furigana counts as the edge of its kanji. */
function boundary(root: HTMLElement, node: Node, off: number, side: 'start' | 'end'): number {
  const rt = (node instanceof Element ? node : node.parentElement)?.closest('rt, rp')
  const ruby = rt?.closest('ruby')
  if (ruby) { node = ruby; off = side === 'start' ? 0 : ruby.childNodes.length }
  const point = document.createRange()
  point.setStart(node, off)
  let at = 0
  for (const t of textNodes(root)) {
    if (t === node) return at + off
    if (point.comparePoint(t, t.length) > 0) break // this text ends past the boundary
    at += t.length
  }
  return at
}

/** Each lookup's text and furigana, so a selection in it can be read the way it shows. */
const roots = new WeakMap<HTMLElement, { text: string; pairs: [string, string][] }>()

type Open = { text: string; pairs: [string, string][]; at: number; end?: number; root: HTMLElement; x: number; y: number }

/** Japanese text you can tap: the word under your finger opens with its meaning,
 *  its readings in kana and romaji, and a voice to hear it. `pairs` are the furigana
 *  the text shows, so the word's readings agree with them. */
export function Lookup({ text, pairs = [], children }: { text: string; pairs?: [string, string][]; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState<Open | null>(null)
  useEffect(() => { if (ref.current) roots.set(ref.current, { text, pairs }) })
  return <span ref={ref} className="lookup" onClick={(e) => {
    if (!window.getSelection()?.isCollapsed || !ref.current) return // let people select text
    const at = offsetAt(ref.current, e.clientX, e.clientY)
    if (at == null || /\s/.test(text[at] ?? ' ')) return
    setOpen({ text, pairs, at, root: ref.current, x: e.clientX, y: e.clientY })
  }}>
    {children}
    {open && <WordPopover key={open.at} {...open} onClose={() => setOpen(null)} />}
  </span>
}

type Picked = Omit<Open, 'x' | 'y'> & { end: number; rect: DOMRect }

/** The selection, when it lies in one lookup's text and holds more than spaces. */
function picked(): Picked | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const common = range.commonAncestorContainer
  const el = common instanceof Element ? common : common.parentElement
  let root = el?.closest<HTMLElement>('.lookup') ?? null
  if (!root) {
    const inside = [...el?.querySelectorAll<HTMLElement>('.lookup') ?? []].filter((r) => range.intersectsNode(r))
    if (inside.length !== 1) return null
    root = inside[0]
  }
  const known = roots.get(root)
  if (!known) return null
  const { text, pairs } = known
  const at = root.contains(range.startContainer) ? boundary(root, range.startContainer, range.startOffset, 'start') : 0
  const end = Math.min(text.length, root.contains(range.endContainer) ? boundary(root, range.endContainer, range.endOffset, 'end') : text.length)
  if (end <= at || !text.slice(at, end).trim()) return null
  const rects = [...range.getClientRects()].filter((r) => r.width > 0)
  return { text, pairs, at, end, root, rect: rects[rects.length - 1] ?? range.getBoundingClientRect() }
}

/** Select any stretch of a sentence and an Explain button comes up beside it: the stretch
 *  opens with its reading, its meanings when it's a dictionary word, and what the translator
 *  says it means there. Mounted once for the whole app. */
export function SelectionLookup() {
  const [offer, setOffer] = useState<Picked | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  useEffect(() => {
    let down = false, timer = 0
    const check = () => { window.clearTimeout(timer); setOffer(down ? null : picked()) }
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(check, 200) } // touch handles move without pointer events
    const press = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.select-explain')) down = true }
    const lift = () => { if (down) { down = false; window.setTimeout(check) } }
    document.addEventListener('selectionchange', later)
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('pointerup', lift, true)
    window.addEventListener('scroll', later, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', later)
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('pointerup', lift, true)
      window.removeEventListener('scroll', later, true)
    }
  }, [])
  const explain = () => {
    if (!offer) return
    const { rect, ...rest } = offer
    setOpen({ ...rest, x: rect.right, y: rect.bottom })
    setOffer(null)
    window.getSelection()?.removeAllRanges() // the popover marks the stretch itself
  }
  const gap = 8, w = 120
  return <>
    {offer && !open && createPortal(
      <button type="button" className="btn small select-explain" lang="en"
        style={{ left: Math.min(Math.max(16, offer.rect.right - w / 2), window.innerWidth - w - 16), top: Math.min(offer.rect.bottom + gap, window.innerHeight - 56) }}
        onPointerDown={(e) => e.preventDefault()} onClick={explain} title="Its reading, meaning and what it means here">
        <MessageSquareText aria-hidden="true" />Explain
      </button>, document.body)}
    {open && <WordPopover key={`${open.at}-${open.end}`} {...open} onClose={() => setOpen(null)} />}
  </>
}

function WordPopover({ text, pairs, at, end, root, x, y, onClose }: Open & { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [word, setWord] = useState<Word | null | undefined>(undefined)
  const [dict, setDict] = useState<DictionaryStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | 'sheet' | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [voice] = usePref<string>('voice', 'browser')

  // fetch, and keep asking while the dictionary downloads the first time
  useEffect(() => {
    const ctl = new AbortController()
    let timer = 0
    const load = () => api.lookup(text, at, pairs, ctl.signal, end).then((r) => {
      setWord(r.word); setDict(r.dictionary); setError(null)
      if (r.dictionary.state === 'downloading') timer = window.setTimeout(load, 2500)
    }, (e) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    load()
    return () => { ctl.abort(); window.clearTimeout(timer) }
  }, [text, at, end])

  // highlight the word, and sit just below it (above it when there is no room)
  const span = word ? rangeOf(root, word.start, word.end) : null
  useLayoutEffect(() => {
    const hl = highlights()
    if (span && hl && Highlight) hl.set('lookup', new Highlight(span))
    const place = () => {
      const el = box.current
      if (!el) return
      if (window.matchMedia('(max-width: 760px)').matches) { setPos((p) => (p === 'sheet' ? p : 'sheet')); return } // a sheet above the tab bar
      const r = span?.getBoundingClientRect() ?? new DOMRect(x, y, 0, 0)
      const w = el.offsetWidth, h = el.offsetHeight, gap = 8, edge = 16
      const left = Math.min(Math.max(edge, r.left + r.width / 2 - w / 2), window.innerWidth - w - edge)
      const below = r.bottom + gap
      const top = below + h > window.innerHeight - edge && r.top - gap - h > edge ? r.top - gap - h : below
      setPos((p) => (p && p !== 'sheet' && p.left === left && p.top === top ? p : { left, top }))
    }
    place()
    return () => hl?.delete('lookup')
  })

  const close = useCallback(() => { stopAudio(); onClose() }, [onClose])
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && (end != null || !root.contains(e.target as Node))) close() }
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) close() }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', close)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [close, root, end])

  const listen = async (what: string) => {
    if (playing === what) { stopAudio(); setPlaying(null); return }
    setPlaying(what)
    try { await speak(what, voice) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPlaying((p) => (p === what ? null : p)) }
  }
  const listenButton = (say: string, label: string) => (
    <button type="button" className="btn small icon" onClick={() => listen(say)} aria-pressed={playing === say}
      aria-label={playing === say ? 'Stop' : label} title={playing === say ? 'Stop' : label}>
      {playing === say ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </button>
  )

  return createPortal(
    <div ref={box} className="word-pop" role="dialog" aria-label={word ? `${word.surface}: meaning and readings` : 'Word lookup'}
      tabIndex={-1} lang="en" style={pos === 'sheet' ? undefined : pos ?? { visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn small icon ghost word-pop-close" onClick={close} aria-label="Close"><X aria-hidden="true" /></button>
      {error ? <p className="meta">{error}</p> : word === undefined ? <p className="meta">Looking it up…</p> : word === null ? <p className="meta">{end != null ? 'Nothing to explain here.' : 'No word here.'}</p> : <>
        {/* the word stays in view; only its meanings scroll */}
        <div className="word-pop-top">
        <div className="word-head">
          <span className="word-surface" lang="ja"><Furigana text={word.surface} pairs={word.furigana} lookup={false} /></span>
          {listenButton(word.reading || word.surface, `Listen to ${word.surface}`)}
        </div>
        <p className="word-reading"><span lang="ja">{word.reading}</span> <span className="word-romaji">{word.romaji}</span></p>
        {word.lemma && <p className="word-lemma meta">
          <span>Dictionary form</span> <b lang="ja">{word.lemma}</b> <span lang="ja">{word.lemma_reading}</span> <span className="word-romaji">{word.lemma_romaji}</span>
          {word.lemma_reading && listenButton(word.lemma_reading, `Listen to ${word.lemma}`)}
        </p>}
        </div>
        <div className="word-pop-body">
        {end != null && <Explanation text={word.surface} context={text} auto />}
        {end != null && !word.entries.length ? null : word.entries.length ? word.entries.map((e, n) => <section key={e.id} className="word-entry">
          {n > 0 && <h3 lang="ja">{e.kanji[0]?.text ?? e.kana[0]?.text}{e.kanji.length > 0 && <span className="meta"> {e.kana[0]?.text}</span>}</h3>}
          <ol>{e.senses.map((s, i) => <li key={i}>
            {/* the part of speech once, until it changes */}
            {(s.misc.length > 0 || (s.pos.length > 0 && s.pos.join() !== e.senses[i - 1]?.pos.join())) &&
              <span className="word-pos">{[...(s.pos.join() !== e.senses[i - 1]?.pos.join() ? s.pos : []), ...s.misc].join(' · ')}</span>}
            <span>{s.gloss.join('; ')}</span>{s.info.length > 0 && <span className="meta"> ({s.info.join('; ')})</span>}
          </li>)}</ol>
        </section>) : <p className="meta">{
          dict?.state === 'downloading' ? 'Downloading the dictionary (once, about 12 MB)…' :
            dict?.state === 'error' ? dict.error : 'Not in the dictionary.'
        }</p>}
        {end == null && <Explanation text={word.surface} context={text} />}
        </div>
      </>}
    </div>, document.body)
}

/** What the translator in use says the stretch means in its sentence. Asking costs machine
 *  time or credits, so a tapped word asks only on a click; a selection's Explain was the click. */
function Explanation({ text, context, auto = false }: { text: string; context: string; auto?: boolean }) {
  const lang = useLanguage()
  const [asked, setAsked] = useState(auto ? 1 : 0)
  const [force, setForce] = useState(false)
  const [res, setRes] = useState<Explained | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!asked) return
    const ctl = new AbortController()
    setError(null)
    api.explain(text, context, force, ctl.signal).then((r) => { setRes(r); setForce(false) },
      (e) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    return () => ctl.abort()
  }, [asked, text, context]) // eslint-disable-line react-hooks/exhaustive-deps
  const who = lang?.translator ?? 'the translator'
  const busy = asked > 0 && !error && (!res || force)
  if (!asked) return (
    <p className="word-explain"><button type="button" className="btn small ghost" onClick={() => setAsked(1)}
      title={lang?.cloud ? `Asks ${who}, an online service: uses API credits` : `Asks ${who} on this computer or your network`}>
      <MessageSquareText aria-hidden="true" />Explain in this sentence
    </button></p>
  )
  return (
    <section className="word-explain" aria-live="polite" aria-busy={busy}>
      <h3 className="meta">In this sentence{lang && <span> · {lang.name}</span>}</h3>
      {error ? <p className="meta">
        <span title={error}>No explanation: {error.split('. ')[0]}.</span>{' '}
        <button type="button" className="link" onClick={() => setAsked((n) => n + 1)}>Retry</button> · <Link to="/addons">Set up</Link>
      </p> : !res ? <p className="meta">Asking {who}…</p> : <div className={force ? 'pending' : undefined} lang={res.to}>
        <p className="explain-translation">{res.translation}{' '}
          <button type="button" className="link again" disabled={force} onClick={() => { setForce(true); setAsked((n) => n + 1) }}
            aria-label="Explain again" title={force ? 'Asking again…' : 'Ask again'}><RefreshCw aria-hidden="true" /></button>
        </p>
        {res.notes.length > 0 && <ul className="explain-notes">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </div>}
    </section>
  )
}
