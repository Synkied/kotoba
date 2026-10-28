import { ArrowUp, ImagePlus, LoaderCircle, SquarePen, X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type ChatMessage } from '../lib/api'
import { NoteMarkdown } from '../components/NoteMarkdown'
import { ErrorNotice, PageHome, Skeleton, useAsync, usePref } from '../components/ui'
import { Button, Notice, Select, Textarea } from '../components/ds'

const MAX_IMAGES = 4
/** the longest side an image is sent at: what Claude reads at full detail, enough for small kana in a screenshot */
const LONG_EDGE = 1568
const STORE = 'kotoba.chat'

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

/** Talk with one of the LLMs saved on the Add-ons page. The conversation is kept in this browser only. */
export default function ChatPage() {
  const options = useAsync(() => api.chatOptions(), [])
  const [messages, setMessages] = useConversation()
  const [chosen, setChosen] = usePref('chat-llm', '')
  const [draft, setDraft] = useState('')
  const [attached, setAttached] = useState<string[]>([])
  const [dropping, setDropping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const pending = useRef<AbortController | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)

  const llms = options.data?.llms ?? []
  // the one picked here, else the translator in use, else the first
  const llm = llms.find((t) => t.id === chosen) ?? llms.find((t) => t.id === options.data?.active) ?? llms[0]

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length, busy, error, llm])
  useEffect(() => () => pending.current?.abort(), [])

  const ask = async (convo: ChatMessage[]) => {
    if (!llm) return
    const ctl = new AbortController()
    pending.current = ctl
    setBusy(true)
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
    pending.current?.abort()
    pending.current = null
    setBusy(false)
    setError(null)
    setMessages([])
    setAttached([])
    input.current?.focus()
  }

  // Enter sends, Shift+Enter breaks the line; never while an IME is still choosing kanji
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
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
      {/* the conversation scrolls on its own; the composer under it never moves */}
      <div className="chat-scroll">
        <div className="chat-column">
          <ol className="chat-log" aria-label="Conversation" aria-live="polite">
            {!messages.length && <li className="chat-intro meta">
              Write in Japanese and the answer comes back in Japanese, with a note on anything to say better.
              Or ask about a word or a grammar point in your own language, or share a screenshot to read together.
              {' '}{llm.cloud ? `What you write goes to ${llm.name}'s server.` : 'Everything stays on your machine.'}
            </li>}
            {messages.map((m, i) => m.role === 'user'
              ? <li key={i} className="chat-turn chat-you">
                {m.images && m.images.length > 0 && <div className="chat-images">
                  {m.images.map((src, j) => <img key={j} src={src} alt={`Image ${j + 1} you shared`} />)}
                </div>}
                {!!m.lost && <p className="meta">{m.lost === 1 ? 'An image' : `${m.lost} images`} not kept in this browser</p>}
                {m.content && <p>{m.content}</p>}
              </li>
              : <li key={i} className="chat-turn chat-them">
                <span className="chat-who meta">{m.name}</span>
                <NoteMarkdown body={m.content} />
              </li>)}
            {busy && <li className="chat-turn chat-them">
              <span className="chat-who meta"><LoaderCircle className="loading-spinner" aria-hidden="true" />{llm.name} is writing</span>
            </li>}
          </ol>
          {error != null && !busy && <ErrorNotice error={error}
            action={last?.role === 'user' && <Button size="small" onClick={() => ask(messages)}>Try again</Button>} />}
          <div ref={end} />
        </div>
      </div>

      <form className="chat-compose" data-dropping={dropping || undefined} onSubmit={(e) => { e.preventDefault(); send() }}>
        {attached.length > 0 && <ul className="chat-attached" aria-label="Images to send">
          {attached.map((src, i) => <li key={i}>
            <img src={src} alt={`Image ${i + 1} to send`} />
            <Button type="button" variant="primary" size="small" icon aria-label={`Remove image ${i + 1}`} title="Remove"
              onClick={() => setAttached((prev) => prev.filter((_, j) => j !== i))}><X aria-hidden="true" /></Button>
          </li>)}
        </ul>}
        <Button type="button" variant="ghost" icon onClick={() => picker.current?.click()} disabled={busy || full}
          aria-label="Add images" title={full ? `${MAX_IMAGES} images at most` : 'Add images (or paste or drop them here)'}>
          <ImagePlus aria-hidden="true" />
        </Button>
        <input ref={picker} type="file" accept="image/*" multiple hidden
          onChange={(e) => { attach(e.target.files ?? []); e.target.value = '' }} />
        <Textarea ref={input} value={draft} rows={1} maxLength={8000} autoFocus
          aria-label="Message" placeholder={dropping ? 'Drop the images to add them' : 'Write a message'}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
        <Button variant="primary" icon type="submit" disabled={busy || (!draft.trim() && !attached.length)} aria-label="Send" title="Send (Enter)">
          <ArrowUp aria-hidden="true" />
        </Button>
        <p className="chat-hint meta">Enter to send, Shift+Enter for a new line. Paste or drop images to add them. Kept in this browser only.</p>
      </form>
    </div>}
  </>
}
