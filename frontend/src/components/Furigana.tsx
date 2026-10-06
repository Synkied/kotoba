import { Fragment } from 'react'
import type { Unit } from '../lib/api'

/** Text with hiragana over the kanji, from [kanji, reading] pairs in reading order. */
export function Furigana({ text, pairs, show = true }: { text: string; pairs: [string, string][]; show?: boolean }) {
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
  return (
    <>
      {units.map((u, i) => (
        <span key={i} className={'unit ' + u.status} title={u.status === 'ok' ? undefined : u.status}><Furigana text={u.text} pairs={pairs} show={show} /></span>
      ))}
    </>
  )
}
