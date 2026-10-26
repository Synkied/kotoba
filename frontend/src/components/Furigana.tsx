import { Fragment } from 'react'
import type { Unit } from '../lib/api'
import { Lookup } from './WordLookup'

/** Text with hiragana over the kanji, from [kanji, reading] pairs in reading order.
 *  Tapping a word looks it up, unless `lookup` is off (say, inside a button). */
export function Furigana({ text, pairs, show = true, lookup = true, marks, markClass = 'word-mark', markTitle }: {
  text: string; pairs: [string, string][]; show?: boolean; lookup?: boolean
  /** [start, end) stretches of text to mark, such as a word wherever it stands */
  marks?: [number, number][]
  /** how the marks look (word-mark: the word looked for) and what they say on hover */
  markClass?: string; markTitle?: string
}) {
  if (lookup) return <Lookup text={text} pairs={pairs}><Furigana text={text} pairs={pairs} show={show} lookup={false} marks={marks} markClass={markClass} markTitle={markTitle} /></Lookup>
  if ((!show || !pairs.length) && !marks?.length) return <>{text}</>
  const pieces = cut(text, show ? pairs : [], marks ?? [])
  const node = (p: Piece) => p.ruby == null ? <Fragment key={p.start}>{text.slice(p.start, p.end)}</Fragment>
    : <ruby key={p.start}>{text.slice(p.start, p.end)}<rp>(</rp><rt>{p.ruby}</rt><rp>)</rp></ruby>
  if (!marks?.length) return <>{pieces.map(node)}</>
  const out: React.ReactNode[] = []
  for (let i = 0; i < pieces.length;) {
    const m = marks.find(([a, b]) => pieces[i].start >= a && pieces[i].end <= b)
    if (!m) { out.push(node(pieces[i++])); continue }
    const inside: Piece[] = []
    while (i < pieces.length && pieces[i].end <= m[1]) inside.push(pieces[i++])
    out.push(<mark key={'m' + m[0]} className={markClass} title={markTitle}>{inside.map(node)}</mark>)
  }
  return <>{out}</>
}

type Piece = { start: number; end: number; ruby?: string }

/** The text in pieces, each plain or a kanji run with its reading, cut where a mark starts or ends. */
function cut(text: string, pairs: [string, string][], marks: [number, number][]): Piece[] {
  const cuts = new Set(marks.flat())
  const pieces: Piece[] = []
  const plain = (start: number, end: number) => {
    let a = start
    for (let i = start + 1; i < end; i++) if (cuts.has(i)) { pieces.push({ start: a, end: i }); a = i }
    if (end > a) pieces.push({ start: a, end })
  }
  let at = 0
  for (const [kanji, reading] of pairs) {
    const j = text.indexOf(kanji, at)
    if (j < 0) continue
    plain(at, j)
    pieces.push({ start: j, end: j + kanji.length, ruby: reading })
    at = j + kanji.length
  }
  plain(at, text.length)
  return pieces
}

/** Scored sentence: missed words underlined in burgundy, unclear ones dashed. */
export function Units({ units, pairs = [], show = false }: { units: Unit[]; pairs?: [string, string][]; show?: boolean }) {
  const text = units.map(u => u.text).join('')
  let at = 0
  const spans = pairs.flatMap(([surface, reading]) => {
    const start = text.indexOf(surface, at)
    if (start < 0) return []
    at = start + surface.length
    return [{ start, end: at, pair: [surface, reading] as [string, string] }]
  })
  const offsets = units.reduce<number[]>((out, u) => [...out, out[out.length - 1] + u.text.length], [0])
  return <Lookup text={text} pairs={pairs}>{units.map((u, i) => {
    const start = offsets[i], end = offsets[i + 1]
    const readings = spans.filter(p => p.start >= start && p.end <= end).map(p => p.pair)
    return <span key={i} className={'unit ' + u.status} title={u.status === 'ok' ? undefined : u.status}><Furigana text={u.text} pairs={readings} show={show} lookup={false} /></span>
  })}</Lookup>
}
