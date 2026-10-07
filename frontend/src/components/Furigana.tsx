import { Fragment } from 'react'
import type { Unit } from '../lib/api'
import { Lookup } from './WordLookup'

/** Text with hiragana over the kanji, from [kanji, reading] pairs in reading order.
 *  Tapping a word looks it up, unless `lookup` is off (say, inside a button). */
export function Furigana({ text, pairs, show = true, lookup = true }: { text: string; pairs: [string, string][]; show?: boolean; lookup?: boolean }) {
  if (lookup) return <Lookup text={text}><Furigana text={text} pairs={pairs} show={show} lookup={false} /></Lookup>
  if (!show || !pairs.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let at = 0
  pairs.forEach(([kanji, reading], i) => {
    const j = text.indexOf(kanji, at)
    if (j < 0) return
    if (j > at) out.push(<Fragment key={'t' + i}>{text.slice(at, j)}</Fragment>)
    out.push(<ruby key={'r' + i}>{kanji}<rp>(</rp><rt>{reading}</rt><rp>)</rp></ruby>)
    at = j + kanji.length
  })
  if (at < text.length) out.push(<Fragment key="end">{text.slice(at)}</Fragment>)
  return <>{out}</>
}

/** Scored sentence: missed words underlined in red, unclear ones dashed. */
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
  return <Lookup text={text}>{units.map((u, i) => {
    const start = offsets[i], end = offsets[i + 1]
    const readings = spans.filter(p => p.start >= start && p.end <= end).map(p => p.pair)
    return <span key={i} className={'unit ' + u.status} title={u.status === 'ok' ? undefined : u.status}><Furigana text={u.text} pairs={readings} show={show} lookup={false} /></span>
  })}</Lookup>
}
