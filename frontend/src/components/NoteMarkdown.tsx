import { AudioLines, BookAudio, Captions, FileText, Film, Play, ScanText } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type Ref } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type SourceKind } from '../lib/api'

/** A source a note can point at with @. */
export type Mentionable = { id: number; title: string; kind: SourceKind }

export const kindIcon: Record<SourceKind, typeof FileText> = { capture: ScanText, audio: AudioLines, video: Film, subtitle: Captions, text: FileText, story: BookAudio }
const SOURCE_HREF = /^\/sources\/(\d+)$/
/** A moment in one of a lesson's recordings, left by quoting a transcript line: [0:12](#at=f3:12). */
const TIME_HREF = /^#at=([\w-]+):(\d+(?:\.\d+)?)$/

/** The line quoted from a recording, as Markdown: its time code plays it again on the lesson page. */
export function quoteToken(m: { track: string; name: string; t: number; text: string }, clock: string, named: boolean) {
  const title = named ? ` "${m.name.replace(/["\\]/g, '')}"` : ''
  const said = m.text.replace(/\s+/g, ' ').replace(/([\\`*_[\]<>])/g, '\\$1').trim()
  return `> [${clock}](#at=${m.track}:${Math.round(m.t * 10) / 10}${title})${said ? ' ' + said : ''}`
}

/** The compact reference a mention leaves in the Markdown: [@会話](/sources/12). */
export function mentionToken(s: Mentionable) {
  const label = s.title.replace(/[[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48) || `${s.kind} source`
  return `[@${label}](/sources/${s.id})`
}

const linkTo = (onTime?: (track: string, t: number) => void): Components['a'] => function NoteLink({ href = '', children, node: _node, ...props }) {
    const time = TIME_HREF.exec(href)
    if (time) return onTime
      ? <button type="button" className="note-time num" onClick={() => onTime(time[1], Number(time[2]))} title={props.title ? `Play ${props.title} from here` : 'Play from here'}><Play aria-hidden="true" />{children}</button>
      : <span className="note-time num" title="Plays on the lesson page">{children}</span>
    const text = typeof children === 'string' ? children : Array.isArray(children) && typeof children[0] === 'string' ? children[0] : ''
    if (SOURCE_HREF.test(href) && text.startsWith('@')) return <Link className="note-mention" to={href} lang="ja">{children}</Link>
    if (href.startsWith('/')) return <Link to={href} {...props}>{children}</Link>
    return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
  }

/** A line of a note as plain words, for lists: mentions keep their @, links their text. */
export function plainText(markdown: string) {
  return markdown.replace(/!?\[((?:[^\]\\]|\\.)*)\]\([^)]*\)/g, '$1').replace(/\\([[\]\\])/g, '$1').replace(/^\s*(?:#+|>|[-*+](?: \[[ xX]\])?|\d+\.)\s+/gm, '').replace(/[*_`~]/g, '').trim()
}

/** A note's Markdown as a page: GitHub tables and checklists, @mentions as source chips,
 *  and quoted time codes that play the recording again when the page can (`onTime`). */
export function NoteMarkdown({ body, empty, className = '', onTime, components: more }: {
  body: string; empty?: string; className?: string; onTime?: (track: string, t: number) => void
  /** elements drawn the caller's way (chat sets Japanese paragraphs for lookup); keep it stable */
  components?: Components
}) {
  const components = useMemo<Components>(() => ({ ...more, a: linkTo(onTime) }), [onTime, more])
  return <article className={'note-markdown ' + className}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{body || (empty ? `*${empty}*` : '')}</ReactMarkdown>
  </article>
}

/** Where the caret sits inside a textarea, measured on an invisible copy of it. */
export function caretPoint(el: HTMLTextAreaElement, at: number) {
  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  for (const p of ['font', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize'] as const)
    mirror.style[p] = style[p] as string
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', width: `${el.clientWidth}px`, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
  mirror.textContent = el.value.slice(0, at)
  const mark = document.createElement('span')
  mark.textContent = '​'
  mirror.append(mark)
  document.body.append(mirror)
  const point = { top: mark.offsetTop + parseFloat(style.lineHeight || '24') - el.scrollTop, left: Math.min(mark.offsetLeft, el.clientWidth - 16) }
  mirror.remove()
  return point
}

type Props = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  /** every edit, typed or a mention picked */
  onValueChange: (next: string) => void
  /** offered first: the lesson's or the note's own sources */
  near?: Mentionable[]
  ref?: Ref<HTMLTextAreaElement>
}

/** A Markdown textarea where typing @ finds a source and leaves a link to it. */
export function MentionTextarea({ value, onValueChange, near = [], ref, onKeyDown, className = '', ...props }: Props) {
  const own = useRef<HTMLTextAreaElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  // the @ being typed: where it starts and what follows it
  const [mention, setMention] = useState<{ start: number; q: string; top: number; left: number } | null>(null)
  const [found, setFound] = useState<Mentionable[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const q = mention?.q ?? null

  useEffect(() => {
    if (q === null) return
    let live = true
    const t = window.setTimeout(() => {
      api.sources({ q, limit: 8 }).then(page => {
        if (!live) return
        setFailed(false)
        setFound(page.results.map(s => ({ id: s.id, kind: s.kind, title: s.title || s.text.trim().slice(0, 60) || `${s.kind} source` })))
      }, () => { if (live) { setFailed(true); setFound([]) } })
    }, 150)
    return () => { live = false; window.clearTimeout(t) }
  }, [q])

  const needle = (q ?? '').toLocaleLowerCase()
  const first = near.filter(s => s.title.toLocaleLowerCase().includes(needle))
  const options = [...first, ...(found ?? []).filter(s => !first.some(n => n.id === s.id))].slice(0, 8)
  const open = mention !== null

  const look = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart
    if (caret !== el.selectionEnd) return mention && setMention(null)
    const typed = /(?:^|[\s(（「])@([^\s@[\]()]{0,40})$/.exec(el.value.slice(0, caret))
    if (!typed) return mention && setMention(null)
    const start = caret - typed[1].length - 1
    if (mention?.start === start) {
      if (mention.q !== typed[1]) { setActive(0); setMention({ ...mention, q: typed[1] }) }
      return
    }
    setActive(0); setFound(null)
    setMention({ start, q: typed[1], ...caretPoint(el, start) })
  }
  const pick = (s: Mentionable) => {
    const el = own.current
    if (!el || !mention) return
    const end = mention.start + 1 + mention.q.length
    const token = mentionToken(s) + ' '
    onValueChange(value.slice(0, mention.start) + token + value.slice(end))
    setMention(null)
    const at = mention.start + token.length
    window.setTimeout(() => { el.focus(); el.setSelectionRange(at, at) }, 0)
  }

  return <div className="mention-field">
    <textarea {...props} className={className} value={value}
      ref={el => { own.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el }}
      role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      onChange={e => { onValueChange(e.target.value); look(e.target) }}
      onSelect={e => open && look(e.currentTarget)}
      onBlur={e => { if (!menu.current?.contains(e.relatedTarget)) setMention(null); props.onBlur?.(e) }}
      onKeyDown={e => {
        if (open) {
          if (e.key === 'Escape') { e.preventDefault(); return setMention(null) }
          if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            return setActive(i => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
          }
          if (options[active] && e.key === 'Enter') { e.preventDefault(); return pick(options[active]) }
        }
        onKeyDown?.(e)
      }} />
    {open && <div ref={menu} className="mention-menu" style={{ top: mention.top, left: `min(${mention.left}px, 100% - min(22rem, 100%))` }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setMention(null) }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setMention(null); own.current?.focus() } }}>
      <ul id={listId} role="listbox" aria-label="Sources to mention">
        {options.map((s, i) => {
          const Icon = kindIcon[s.kind]
          return <li key={s.id} role="presentation"><button type="button" id={`${listId}-${i}`} role="option" aria-selected={i === active}
            onClick={() => pick(s)} onMouseEnter={() => setActive(i)}>
            <Icon aria-hidden="true" /><span lang="ja">{s.title}</span>{near.some(n => n.id === s.id) && <small>linked</small>}
          </button></li>
        })}
      </ul>
      {!options.length && <p className="meta">{failed ? 'Couldn’t search sources. Keep typing to try again.' : found === null ? 'Finding sources…' : q ? `No source matches “${q}”.` : 'No sources yet.'}</p>}
      {options.length > 0 && <p className="mention-keys meta">↑↓ choose · Enter link · Esc close</p>}
    </div>}
  </div>
}
