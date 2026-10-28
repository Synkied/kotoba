import { ArrowUp, Copy, ImagePlus, Inbox, LoaderCircle, Square, SquarePen, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import { Link } from 'react-router-dom'
import { api, type ChatMessage } from '../lib/api'
import { NoteMarkdown, plainText } from '../components/NoteMarkdown'
import { Lookup } from '../components/WordLookup'
import { ErrorNotice, PageHome, Skeleton, useAsync, usePref, useToast } from '../components/ui'
import { Button, Notice, Select, Textarea } from '../components/ds'

const MAX_IMAGES = 4
const MAX_CHARS = 8000
/** the longest side an image is sent at: what Claude reads at full detail, enough for small kana in a screenshot */
const LONG_EDGE = 1568
const STORE = 'kotoba.chat'

const JA = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/
/** Mostly Japanese: set as a sentence is (larger, phrase breaks), not as a note about one. */
const japanese = (text: string) => {
  const letters = text.replace(/[\s\p{P}\p{S}\d]/gu, '').length
  return letters > 0 && (text.match(new RegExp(JA, 'g'))?.length ?? 0) / letters > 0.5
}

/** An image as a JPEG data URL no larger than it needs to be: the conversation is stored in this browser. */
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

/** The conversation, kept in this browser. When images outgrow the storage, the words are kept without them. */
function useConversation() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') } catch { return [] }
  })
  const save = (next: ChatMessage[]) => {
    setMessages(next)
    try { localStorage.setItem(STORE, JSON.stringify(next)) } catch {
      const words = next.map(({ images, ...m }) => images?.length ? { ...m, lost: (m.lost ?? 0) + images.length } : m)
      try { localStorage.setItem(STORE, JSON.stringify(words)) } catch { /* private mode */ }
    }
  }
  return [messages, save] as const
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

/** Talk with one of the LLMs saved on the Add-ons page. The conversation is kept in this browser only. */
export default function ChatPage() {
  const options = useAsync(() => api.chatOptions(), [])
  const [messages, setMessages] = useConversation()
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
  }, [llm])
  useEffect(() => () => pending.current?.abort(), [])

  const ask = async (convo: ChatMessage[]) => {
    if (!llm) return
    const ctl = new AbortController()
    pending.current = ctl
    pinned.current = true
    setBusy(true)
    setStopped(false)
    setError(null)
    try {
      const r = await api.chat(llm.id, convo, ctl.signal)
      setMessages([...convo, { role: 'assistant', content: r.reply, name: r.name }])
    } catch (e) {
      if (!ctl.signal.aborted) setError(e)
    } finally {
      if (pending.current === ctl) { pending.current = null; setBusy(false) }
    }
  }

  const send = () => {
    const text = draft.trim()
    if ((!text && !attached.length) || busy || !llm) return
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

  const restart = () => {
    const before = messages
    pending.current?.abort()
    pending.current = null
    setBusy(false)
    setStopped(false)
    setError(null)
    setMessages([])
    setAttached([])
    setKept([])
    input.current?.focus()
    if (before.length) toast({ text: 'Started a new chat.', undo: () => setMessages(before) })
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

  const last = messages.at(-1)
  const full = attached.length >= MAX_IMAGES
  const lastReply = last?.role === 'assistant' ? last : null
  return <>
    <header className="page-head">
      <h1><PageHome to="/chat">Chat</PageHome></h1>
      <span className="grow" />
      {llms.length > 1 && <label className="chat-llm">
        <span className="meta">With</span>
        <Select value={llm?.id ?? ''} onChange={(e) => setChosen(e.target.value)} disabled={busy}>
          {llms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.model ? ` (${t.model})` : ''}</option>)}
        </Select>
      </label>}
      <Button onClick={restart} disabled={!messages.length && !draft && !attached.length && error == null}><SquarePen aria-hidden="true" />New chat</Button>
    </header>

    {options.error != null && <ErrorNotice error={options.error} action={<Button size="small" onClick={options.reload}>Try again</Button>} />}
    {!options.data && options.error == null && <Skeleton rows={3} />}
    {options.data && !llm && <Notice as="p"><span>Chatting needs an LLM. <Link to="/addons#translations">Add one on the Add-ons page</Link>: a local model, or Claude with an API key.</span></Notice>}

    {llm && <div className="chat" onDragOver={onDrag} onDragEnter={onDrag} onDragLeave={onDrag} onDrop={onDrop}>
      {/* what a screen reader hears: that an answer is coming, then that it came, not the whole log again */}
      <p className="chat-status" role="status">{busy ? `${llm.name} is answering` : lastReply ? `${lastReply.name} answered` : ''}</p>
      {/* the conversation scrolls on its own; the composer under it never moves */}
      <div className="chat-scroll" ref={scroller} tabIndex={-1}
        onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        <ol className="chat-log" aria-label="Conversation">
          {!messages.length && <li className="chat-intro meta">
            Write in Japanese and the answer comes back in Japanese, with a note on anything to say better.
            Or ask about a word or a grammar point in your own language, or share a screenshot to read together.
            Tap any Japanese to look a word up. {llm.cloud ? `What you write goes to ${llm.name}'s server.` : 'Everything stays on your machine.'}
          </li>}
          {messages.map((m, i) => m.role === 'user'
            ? <li key={i} className="chat-turn chat-you">
              {m.images && m.images.length > 0 && <div className="chat-images">
                {m.images.map((src, j) => <img key={j} src={src} alt={`Image ${j + 1} you shared`} />)}
              </div>}
              {!!m.lost && <p className="meta">{m.lost === 1 ? 'An image' : `${m.lost} images`} not kept in this browser</p>}
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

      <form className="chat-compose" data-dropping={dropping || undefined} onSubmit={(e) => { e.preventDefault(); send() }}>
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
        <Button type="button" variant="ghost" icon onClick={() => picker.current?.click()} disabled={busy || full}
          aria-label="Add images" title={full ? `${MAX_IMAGES} images at most` : 'Add images (or paste or drop them here)'}>
          <ImagePlus aria-hidden="true" />
        </Button>
        <input ref={picker} type="file" accept="image/*" multiple hidden
          onChange={(e) => { attach(e.target.files ?? []); e.target.value = '' }} />
        <Textarea ref={input} value={draft} rows={1} maxLength={MAX_CHARS} autoFocus
          aria-label="Message" placeholder={dropping ? 'Drop the images to add them' : 'Write a message'}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
        {busy
          ? <Button variant="primary" icon type="button" onClick={stop} aria-label="Stop the answer" title="Stop"><Square aria-hidden="true" /></Button>
          : <Button variant="primary" icon type="submit" disabled={!draft.trim() && !attached.length} aria-label="Send" title="Send (Enter)">
            <ArrowUp aria-hidden="true" />
          </Button>}
        <p className="chat-hint meta">
          {draft.length > MAX_CHARS - 1000
            ? <span className="num">{draft.length.toLocaleString()} of {MAX_CHARS.toLocaleString()} characters</span>
            : <span className="chat-keys">Enter to send, Shift+Enter for a new line. Paste or drop images to add them.</span>}
        </p>
      </form>
    </div>}
  </>
}
