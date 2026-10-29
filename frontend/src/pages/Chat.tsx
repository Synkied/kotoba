import { Archive, ArchiveRestore, ArrowUp, ChevronLeft, Copy, Ellipsis, History, ImagePlus, Inbox, LoaderCircle, Pencil, Pin, PinOff, Search, Square, SquarePen, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type ChatMessage, type Conversation } from '../lib/api'
import { Menu, MenuItem, MenuRule } from '../components/Menu'
import { NoteMarkdown, plainText } from '../components/NoteMarkdown'
import { Lookup } from '../components/WordLookup'
import { ErrorNotice, PageHome, Skeleton, useAsync, usePref, useToast } from '../components/ui'
import { Button, Notice, Select, Textarea } from '../components/ds'

const MAX_IMAGES = 4
const MAX_CHARS = 8000
/** the longest side an image is sent at: what Claude reads at full detail, enough for small kana in a screenshot */
const LONG_EDGE = 1568
/** where the one conversation was kept before chats were kept by kotoba */
const STORE = 'kotoba.chat'
/** below this width the history and the chat take turns on the page */
const NARROW = '(max-width: 1000px)'

const JA = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/
/** Mostly Japanese: set as a sentence is (larger, phrase breaks), not as a note about one. */
const japanese = (text: string) => {
  const letters = text.replace(/[\s\p{P}\p{S}\d]/gu, '').length
  return letters > 0 && (text.match(new RegExp(JA, 'g'))?.length ?? 0) / letters > 0.5
}

/** An image as a JPEG data URL no larger than it needs to be: it goes, and is kept, with every message. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'  // JPEG has no transparency: under it, white rather than black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** A conversation from before chats were kept, still in this browser: it joins the history once. */
async function bringOver() {
  let old: ChatMessage[] = []
  try { old = JSON.parse(localStorage.getItem(STORE) ?? '[]') } catch { /* unreadable: nothing to bring */ }
  if (!Array.isArray(old) || !old.length) return
  try { localStorage.removeItem(STORE) } catch { /* private mode */ }
  try {
    await api.createConversation(old.map(({ role, content, name, images }) => ({ role, content, name, images })))
  } catch {
    try { localStorage.setItem(STORE, JSON.stringify(old)) } catch { /* private mode */ }
  }
}

/** Where a chat sits in the history: pinned, else by the day of its latest turn, then by month. */
function groupOf(chat: Conversation) {
  if (chat.pinned) return 'Pinned'
  const d = new Date(chat.updated_at)
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Previous 7 days'
  if (days < 30) return 'Previous 30 days'
  return d.toLocaleDateString(undefined, { month: 'long', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}
function grouped(chats: Conversation[]) {
  const groups: { name: string; chats: Conversation[] }[] = []
  for (const c of chats) {
    const name = groupOf(c)
    const g = groups.at(-1)?.name === name ? groups.at(-1)! : (groups.push({ name, chats: [] }), groups.at(-1)!)
    g.chats.push(c)
  }
  return groups
}

/** Ways into a first message: each fills the field to change before sending; the last opens the image picker. */
const STARTERS = [
  { ja: '自己紹介を練習する', en: 'Introduce yourself and get corrected', prompt: '自己紹介を練習したいです。私が書くので、不自然なところを直してください。' },
  { ja: '「は」と「が」の違い', en: 'Ask about a grammar point', prompt: 'Explain the difference between は and が, with a few short examples.' },
  { ja: '居酒屋で注文してみる', en: 'Role-play: you order, it plays the staff', prompt: '居酒屋の店員になってください。私がお客さんとして注文します。' },
  { ja: '画面の日本語を読む', en: 'Share a screenshot of a game or an app', prompt: null },
] as const

/** One chat in the history: open it, or from its menu rename, pin, archive or delete it. */
function HistoryItem({ chat, current, onOpen, onRename, onPin, onArchive, onDelete }: {
  chat: Conversation; current: boolean
  onOpen: () => void; onRename: (title: string) => void; onPin: () => void; onArchive: () => void; onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(chat.title)
  const leaving = useRef(false)  // Enter or Escape ended it: the blur that follows changes nothing
  const done = (save: boolean) => {
    if (leaving.current) return
    leaving.current = true
    setRenaming(false)
    const next = title.trim()
    if (save && next && next !== chat.title) onRename(next)
    else setTitle(chat.title)
  }
  return <li className="chat-item">
    {renaming
      ? <input className="chat-rename" aria-label="Name of the chat" value={title} maxLength={200} autoFocus
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setTitle(e.target.value)} onBlur={() => done(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); done(true) }
          else if (e.key === 'Escape') { e.preventDefault(); done(false) }
        }} />
      : <button type="button" className="chat-open" aria-current={current ? 'page' : undefined} onClick={onOpen}
        title={new Date(chat.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}>
        {chat.title || 'Untitled chat'}
      </button>}
    <Menu label={`More for “${chat.title || 'Untitled chat'}”`} content={<Ellipsis aria-hidden="true" />} variant="ghost" size="small" icon className="chat-item-menu">
      <MenuItem onClick={() => { setTitle(chat.title); leaving.current = false; setRenaming(true) }}><Pencil aria-hidden="true" />Rename</MenuItem>
      {!chat.archived && <MenuItem onClick={onPin}>{chat.pinned
        ? <><PinOff aria-hidden="true" />Unpin</>
        : <><Pin aria-hidden="true" />Pin to the top</>}</MenuItem>}
      <MenuItem onClick={onArchive}>{chat.archived
        ? <><ArchiveRestore aria-hidden="true" />Bring back</>
        : <><Archive aria-hidden="true" />Archive</>}</MenuItem>
      <MenuRule />
      <MenuItem onClick={onDelete}><Trash2 aria-hidden="true" />Delete</MenuItem>
    </Menu>
  </li>
}

/** A block of a reply or of what you wrote: any Japanese in it can be tapped or selected to look it up,
 *  as in every sentence in kotoba, and a mostly Japanese one is set as a sentence. */
function Readable({ as: Tag, children }: { as: 'p' | 'li'; children?: ReactNode }) {
  const ref = useRef<HTMLParagraphElement & HTMLLIElement>(null)
  const [text, setText] = useState('')
  // the words as they show, once drawn: what a tap's offset counts in
  useLayoutEffect(() => setText(ref.current?.textContent ?? ''), [children])
  const ja = japanese(text)
  return <Tag ref={ref} lang={ja ? 'ja' : undefined} className={ja ? 'chat-ja' : undefined}>
    {JA.test(text) ? <Lookup text={text}>{children}</Lookup> : children}
  </Tag>
}
const REPLY: Components = {
  p: ({ children }) => <Readable as="p">{children}</Readable>,
  li: ({ children }) => <Readable as="li">{children}</Readable>,
}

/** The Japanese lines of a reply, without the notes about them: what Keep puts in the inbox. */
const japaneseLines = (markdown: string) => plainText(markdown).split('\n').map((l) => l.trim()).filter(japanese).join('\n')

/** Talk with one of the LLMs saved on the Add-ons page. Every chat is kept, to go back to from the history. */
export default function ChatPage() {
  const options = useAsync(() => api.chatOptions(), [])
  const [params, setParams] = useSearchParams()
  const openId = Number(params.get('c')) || null
  const [showArchived, setShowArchived] = useState(false)
  const history = useAsync(() => (showArchived ? api.conversations(true) : bringOver().then(() => api.conversations())), [showArchived])
  const [current, setCurrent] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<unknown>(null)
  const [sideOpen, setSideOpen] = usePref('chat.side', true)
  const [phone, setPhone] = useState<'list' | 'chat'>('chat')
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = usePref('chat-llm', '')
  const [draft, setDraft] = useState('')
  const [attached, setAttached] = useState<string[]>([])
  const [dropping, setDropping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [kept, setKept] = useState<number[]>([])
  const toast = useToast()
  const pending = useRef<AbortController | null>(null)
  const adopted = useRef<number | null>(null)  // a chat made here on its first message: already on the page
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)  // following the end of the conversation: unless you scrolled up to read

  const llms = options.data?.llms ?? []
  // the one picked here, else the translator in use, else the first
  const llm = llms.find((t) => t.id === chosen) ?? llms.find((t) => t.id === options.data?.active) ?? llms[0]

  const toEnd = () => { const el = scroller.current; if (el && pinned.current) el.scrollTop = el.scrollHeight }
  useEffect(toEnd, [messages.length, busy, error, stopped, llm])
  // the composer growing (a long draft, images waiting) shrinks the conversation: keep its end in view
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const watch = new ResizeObserver(toEnd)
    watch.observe(el)
    return () => watch.disconnect()
  }, [llm, messages.length > 0 || opening || openError != null])  // a new chat has no conversation to watch yet
  useEffect(() => () => pending.current?.abort(), [])

  // the chat named in the address: open it, or start a new one without it
  useEffect(() => {
    if (openId !== null && openId === adopted.current) return
    adopted.current = null
    pending.current?.abort()
    pending.current = null
    setBusy(false); setStopped(false); setError(null); setOpenError(null); setKept([]); setAttached([])
    pinned.current = true
    if (openId === null) { setCurrent(null); setMessages([]); setOpening(false); return }
    let live = true
    setOpening(true)
    api.conversation(openId).then((c) => { if (live) { setCurrent(c); setMessages(c.messages ?? []) } },
      (e) => { if (live) { setCurrent(null); setMessages([]); setOpenError(e) } })
      .finally(() => { if (live) setOpening(false) })
    return () => { live = false }
  }, [openId])

  /** the history with a chat as it now is: first when it just had a turn, else where it was */
  const place = (c: Conversation, latest = false) => history.set((list) => {
    if (!list) return list
    const rest = list.filter((x) => x.id !== c.id)
    if (c.archived !== showArchived) return rest
    if (latest) { const at = c.pinned ? 0 : rest.findIndex((x) => !x.pinned); return at < 0 ? [...rest, c] : [...rest.slice(0, at), c, ...rest.slice(at)] }
    return list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [c, ...rest]
  })

  const ask = async (convo: ChatMessage[]) => {
    if (!llm) return
    const ctl = new AbortController()
    pending.current = ctl
    pinned.current = true
    setBusy(true)
    setStopped(false)
    setError(null)
    try {
      let id = current?.id
      if (!id) {
        const made = await api.createConversation()
        if (ctl.signal.aborted) return
        id = adopted.current = made.id
        setCurrent(made)
        setParams({ c: String(id) })
      }
      const r = await api.chat(llm.id, id, convo, ctl.signal)
      if (ctl.signal.aborted) return
      setMessages([...convo, { role: 'assistant', content: r.reply, name: r.name }])
      if (r.conversation) {
        setCurrent(r.conversation)
        if (showArchived) setShowArchived(false)  // carrying on brought it back among the chats
        else place(r.conversation, true)
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(e)
    } finally {
      if (pending.current === ctl) { pending.current = null; setBusy(false) }
    }
  }

  const send = () => {
    const text = draft.trim()
    if ((!text && !attached.length) || busy || !llm || opening || openError != null) return
    const convo: ChatMessage[] = [...messages, { role: 'user', content: text, ...(attached.length ? { images: attached } : {}) }]
    setMessages(convo)
    setDraft('')
    setAttached([])
    ask(convo)
  }

  // the answer stops coming; what you wrote stays, to ask again or to change
  const stop = () => {
    pending.current?.abort()
    pending.current = null
    setBusy(false)
    setStopped(true)
  }

  const attach = async (files: Iterable<File>) => {
    const images = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_IMAGES - attached.length)
    if (!images.length) return
    try {
      const urls = await Promise.all(images.map(shrink))
      setAttached((prev) => [...prev, ...urls].slice(0, MAX_IMAGES))
      setError(null)
    } catch {
      setError(new Error('kotoba couldn’t open that image. Try a PNG, JPEG or WebP.'))
    }
    input.current?.focus()
  }

  const narrow = () => matchMedia(NARROW).matches
  const open = (id: number | null) => {
    setPhone('chat')
    if (id !== openId) setParams(id ? { c: String(id) } : {})
    if (id === null) input.current?.focus()
  }
  const toggleHistory = () => (narrow() ? setPhone(phone === 'list' ? 'chat' : 'list') : setSideOpen(!sideOpen))

  const rename = async (c: Conversation, title: string) => {
    try {
      const next = await api.updateConversation(c.id, { title })
      place(next)
      if (current?.id === c.id) setCurrent(next)
    } catch (e) {
      toast({ text: `Couldn’t rename it: ${(e as Error).message}` })
    }
  }
  const pin = async (c: Conversation) => {
    try {
      const next = await api.updateConversation(c.id, { pinned: !c.pinned })
      history.set((list) => list && [...list.map((x) => (x.id === c.id ? next : x))]
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)))
      if (current?.id === c.id) setCurrent(next)
    } catch (e) {
      toast({ text: `Couldn’t ${c.pinned ? 'unpin' : 'pin'} it: ${(e as Error).message}` })
    }
  }
  const archive = async (c: Conversation, archived = !c.archived) => {
    try {
      const next = await api.updateConversation(c.id, { archived })
      place(next)
      if (current?.id === c.id) setCurrent(next)
      if (archived) toast({ text: 'Archived. Find it under Archived chats.', undo: () => { void archive(next, false) } })
      else if (showArchived) toast({ text: 'Back among the chats.' })
    } catch (e) {
      toast({ text: `Couldn’t ${archived ? 'archive' : 'bring back'} it: ${(e as Error).message}` })
    }
  }
  const remove = async (c: Conversation) => {
    if (!window.confirm(`Delete “${c.title || 'Untitled chat'}”? This cannot be undone.`)) return
    try {
      await api.deleteConversation(c.id)
      history.set((list) => list?.filter((x) => x.id !== c.id) ?? list)
      if (current?.id === c.id) open(null)
      toast({ text: 'Deleted.' })
    } catch (e) {
      toast({ text: `Couldn’t delete it: ${(e as Error).message}` })
    }
  }

  const copy = (text: string) => navigator.clipboard.writeText(text).then(
    () => toast({ text: 'Copied.' }), () => toast({ text: 'The browser didn’t allow copying. Select the text instead.' }))
  const keep = async (i: number) => {
    try {
      await api.collectText(japaneseLines(messages[i].content), '', ['chat'])
      setKept((prev) => [...prev, i])
      toast({ text: 'Kept in the Inbox, labelled chat.' })
    } catch (e) {
      toast({ text: `Couldn’t keep it: ${(e as Error).message}` })
    }
  }

  // Enter sends, Shift+Enter breaks the line; never while an IME is still choosing kanji. On a touch
  // keyboard Enter is the only way to break a line, so there the send button sends.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault()
      send()
    }
  }
  // a pasted screenshot is attached; pasted text goes in as usual
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    attach(files)
  }
  const onDrag = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDropping(e.type !== 'dragleave')
  }
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    setDropping(false)
    attach(e.dataTransfer.files)
  }

  const chats = history.data ?? []
  const needle = query.trim().toLowerCase()
  const found = needle ? chats.filter((c) => (c.title || 'Untitled chat').toLowerCase().includes(needle)) : chats
  const empty = !messages.length && !opening && openError == null
  const startWith = (prompt: string | null) => {
    if (prompt === null) { picker.current?.click(); return }
    setDraft(prompt)
    input.current?.focus()
  }
  const last = messages.at(-1)
  const full = attached.length >= MAX_IMAGES
  const lastReply = last?.role === 'assistant' ? last : null
  return <>
    <header className="page-head">
      <h1><PageHome to="/chat">Chat</PageHome>{current?.title && <span className="meta chat-title">{current.title}</span>}</h1>
      <span className="grow" />
      {llms.length > 1 && <label className="chat-llm">
        <span className="meta">With</span>
        <Select value={llm?.id ?? ''} onChange={(e) => setChosen(e.target.value)} disabled={busy}>
          {llms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.model ? ` (${t.model})` : ''}</option>)}
        </Select>
      </label>}
      <Button onClick={toggleHistory} className="chat-history-toggle"><History aria-hidden="true" />History</Button>
      <Button onClick={() => open(null)} className="chat-new-head" disabled={!current && !messages.length && !draft && !attached.length && error == null}><SquarePen aria-hidden="true" />New chat</Button>
    </header>

    {options.error != null && <ErrorNotice error={options.error} action={<Button size="small" onClick={options.reload}>Try again</Button>} />}
    {!options.data && options.error == null && <Skeleton rows={3} />}
    {options.data && !llm && <Notice as="p"><span>Chatting needs an LLM. <Link to="/addons#translations">Add one on the Add-ons page</Link>: a local model, or Claude with an API key.</span></Notice>}

    {llm && <div className="chat-page" data-side={sideOpen ? 'open' : 'closed'} data-phone={phone}>
      <nav className="chat-side" aria-label="Chat history">
        <div className="chat-side-top">
          <Button className="chat-new" onClick={() => open(null)}><SquarePen aria-hidden="true" />New chat</Button>
          <Button variant="ghost" className="chat-side-back" onClick={() => setPhone('chat')}>Back to the chat</Button>
          <label className="chat-find">
            <Search aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a chat by its name"
              placeholder={showArchived ? 'Find an archived chat' : 'Find a chat'} onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }} />
          </label>
        </div>
        {showArchived && <div className="chat-side-sub">
          <Button variant="ghost" size="small" onClick={() => setShowArchived(false)}><ChevronLeft aria-hidden="true" />Archived chats</Button>
        </div>}
        <div className="chat-groups">
          {history.error != null && <ErrorNotice error={history.error} action={<Button size="small" onClick={history.reload}>Try again</Button>} />}
          {history.loading && !history.data && <Skeleton rows={4} />}
          {history.data && !chats.length && <p className="chat-side-empty meta">
            {showArchived ? 'No archived chats. Archive one from its ⋯ menu to keep it out of the way.' : 'Each chat is kept here, latest first, to go back to and carry on.'}
          </p>}
          {chats.length > 0 && !found.length && <p className="chat-side-empty meta">No chat is named like “{query.trim()}”.</p>}
          {grouped(found).map((g) => <section key={g.name} className="chat-group" aria-label={g.name}>
            <h3>{g.name}</h3>
            <ul className="chat-items">
              {g.chats.map((c) => <HistoryItem key={c.id} chat={c} current={c.id === current?.id} onOpen={() => open(c.id)}
                onRename={(t) => { void rename(c, t) }} onPin={() => { void pin(c) }} onArchive={() => { void archive(c) }} onDelete={() => { void remove(c) }} />)}
            </ul>
          </section>)}
        </div>
        {!showArchived && <button type="button" className="chat-side-foot" onClick={() => { setShowArchived(true); setQuery('') }}><Archive aria-hidden="true" />Archived chats</button>}
      </nav>

      <div className="chat" data-empty={empty || undefined} onDragOver={onDrag} onDragEnter={onDrag} onDragLeave={onDrag} onDrop={onDrop}>
        {/* what a screen reader hears: that an answer is coming, then that it came, not the whole log again */}
        <p className="chat-status" role="status">{busy ? `${llm.name} is answering` : lastReply ? `${lastReply.name} answered` : ''}</p>
        {/* the conversation scrolls on its own in one centred column; the composer under it never moves.
            A new chat has nothing to scroll: a greeting, the composer and ways to begin sit in the middle instead */}
        {empty
          ? <div className="chat-welcome">
            <h2 lang="ja">何を話しましょうか。</h2>
            <p className="meta">
              Write in Japanese and the answer comes back in Japanese, with a note on anything to say better. Ask in your own language
              about a word or a grammar point, share a screenshot to read together, and tap any Japanese to look a word up.
              {' '}{llm.cloud ? `What you write goes to ${llm.name}'s server.` : 'Everything stays on your machine.'}
            </p>
          </div>
          : <div className="chat-scroll" ref={scroller} tabIndex={-1}
            onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
            <div className="chat-column">
              <ol className="chat-log" aria-label="Conversation">
                {opening && <li><Skeleton rows={3} /></li>}
                {openError != null && <li><ErrorNotice error={openError} action={<Button size="small" onClick={() => open(null)}>Start a new chat</Button>} /></li>}
                {messages.map((m, i) => m.role === 'user'
                  ? <li key={i} className="chat-turn chat-you">
                    {m.images && m.images.length > 0 && <div className="chat-images">
                      {m.images.map((src, j) => <img key={j} src={src} alt={`Image ${j + 1} you shared`} />)}
                    </div>}
                    {m.content && <Readable as="p">{m.content}</Readable>}
                  </li>
                  : <li key={i} className="chat-turn chat-them">
                    <span className="chat-who meta">{m.name}</span>
                    <NoteMarkdown body={m.content} components={REPLY} />
                    <div className="chat-tools">
                      <Button variant="ghost" size="small" onClick={() => copy(m.content)}><Copy aria-hidden="true" />Copy</Button>
                      {japaneseLines(m.content) && (kept.includes(i)
                        ? <span className="meta">In the Inbox</span>
                        : <Button variant="ghost" size="small" onClick={() => keep(i)} title="Its Japanese lines go to the Inbox, to keep as sentences and practise">
                          <Inbox aria-hidden="true" />Keep the Japanese</Button>)}
                    </div>
                  </li>)}
                {busy && <li className="chat-turn chat-them">
                  <span className="chat-who meta"><LoaderCircle className="loading-spinner" aria-hidden="true" />Answering</span>
                </li>}
              </ol>
              {stopped && !busy && last?.role === 'user' && <Notice as="div" className="chat-stopped">
                <span>Stopped before an answer came.</span>
                <Button size="small" onClick={() => ask(messages)}>Ask again</Button>
              </Notice>}
              {error != null && !busy && <ErrorNotice error={error}
                action={last?.role === 'user' && <Button size="small" onClick={() => ask(messages)}>Try again</Button>} />}
            </div>
          </div>}

        <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); send() }}>
          {/* one framed box, as a message is: the images waiting, the words, then add images and send along its foot */}
          <div className="chat-box" data-dropping={dropping || undefined}>
            {attached.length > 0 && <div className="chat-attached">
              <ul aria-label="Images to send">
                {attached.map((src, i) => <li key={i}>
                  <img src={src} alt={`Image ${i + 1} to send`} />
                  <button type="button" className="chat-unattach" aria-label={`Remove image ${i + 1}`} title="Remove"
                    onClick={() => setAttached((prev) => prev.filter((_, j) => j !== i))}><X aria-hidden="true" /></button>
                </li>)}
              </ul>
              <span className="meta num">{attached.length} of {MAX_IMAGES} images</span>
            </div>}
            <Textarea ref={input} value={draft} rows={1} maxLength={MAX_CHARS} autoFocus
              aria-label="Message" placeholder={dropping ? 'Drop the images to add them' : empty ? 'Write your first message' : 'Write a message'}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
            <div className="chat-box-foot">
              <Button type="button" variant="ghost" icon onClick={() => picker.current?.click()} disabled={busy || full || opening}
                aria-label="Add images" title={full ? `${MAX_IMAGES} images at most` : 'Add images (or paste or drop them here)'}>
                <ImagePlus aria-hidden="true" />
              </Button>
              <input ref={picker} type="file" accept="image/*" multiple hidden
                onChange={(e) => { attach(e.target.files ?? []); e.target.value = '' }} />
              <span className="chat-hint meta">
                {draft.length > MAX_CHARS - 1000
                  ? <span className="num">{draft.length.toLocaleString()} of {MAX_CHARS.toLocaleString()} characters</span>
                  : <span className="chat-keys">Enter to send, Shift+Enter for a new line</span>}
              </span>
              {busy
                ? <Button variant="primary" icon type="button" onClick={stop} aria-label="Stop the answer" title="Stop"><Square aria-hidden="true" /></Button>
                : <Button variant="primary" icon type="submit" disabled={(!draft.trim() && !attached.length) || opening || openError != null} aria-label="Send" title="Send (Enter)">
                  <ArrowUp aria-hidden="true" />
                </Button>}
            </div>
          </div>
        </form>

        {empty && <ul className="chat-starters" aria-label="Ways to begin">
          {STARTERS.map((t) => <li key={t.ja}>
            <button type="button" onClick={() => startWith(t.prompt)}>
              <span lang="ja">{t.ja}</span>
              <span className="meta">{t.en}</span>
            </button>
          </li>)}
        </ul>}
      </div>
    </div>}
  </>
}
