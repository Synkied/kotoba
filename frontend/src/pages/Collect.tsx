import { ClipboardPaste, Upload, ScanText } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { CopyButton } from './Library'
import { useStats } from '../App'
import { useToast } from '../components/ui'

export default function CollectPage() {
  const nav = useNavigate()
  const toast = useToast()
  const { refresh } = useStats()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const paste = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await api.collectText(text, title); setText(''); setTitle(''); refresh(); toast({ text: 'Added to the inbox' }) }
    catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  const upload = async (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length) return
    setErr(null); setBusy(true)
    // a subtitle file dropped together with its audio/video becomes one timed source
    const subs = list.filter((f) => /\.(srt|vtt|ass|ssa)$/i.test(f.name))
    const media = list.filter((f) => /\.(wav|mp3|m4a|flac|ogg|opus|aac|mp4|mkv|webm|mov)$/i.test(f.name))
    const rest = list.filter((f) => !subs.includes(f) && !media.includes(f))
    try {
      for (const sub of subs) {
        const stem = sub.name.replace(/\.[^.]+$/, '')
        const pair = media.find((m) => m.name.replace(/\.[^.]+$/, '') === stem) ?? (subs.length === 1 && media.length === 1 ? media[0] : null)
        if (pair) media.splice(media.indexOf(pair), 1)
        await api.collectFile(sub, pair)
      }
      for (const f of [...media, ...rest]) await api.collectFile(f)
      refresh()
      toast({ text: `${list.length} file${list.length > 1 ? 's' : ''} added to the inbox` })
      nav('/inbox')
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  const server = window.location.origin

  return (
    <>
      <header className="page-head"><h1>Collect</h1></header>
      {err && <div className="notice error" role="alert" style={{ marginBottom: 'var(--s-4)' }}>{err}</div>}
      <div className="collect">
        <form className="sheet" onSubmit={paste}>
          <h2><ClipboardPaste aria-hidden="true" />Paste text</h2>
          <p>Lyrics, a dialogue, a page of your textbook. Each line or sentence becomes one balloon.</p>
          <label className="field"><span>Title (optional)</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Minna no Nihongo, lesson 19 dialogue" /></label>
          <label className="field"><span>Japanese text</span>
            <textarea className="textarea" lang="ja" value={text} onChange={(e) => setText(e.target.value)} placeholder={'どちらが先ですか。\nケーキを食べてから、コーヒーを飲みます。'} /></label>
          <div><button className="btn primary" disabled={!text.trim() || busy} aria-busy={busy}>Add to inbox</button></div>
        </form>

        <section className="sheet">
          <h2><Upload aria-hidden="true" />Upload files</h2>
          <p>Audio or video is transcribed by Whisper on your desktop into timed sentences you can shadow. Drop a subtitle file (.srt, .vtt, .ass) with its video to skip transcription. Images go in as captures.</p>
          <label className={'drop' + (over ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}>
            <Upload aria-hidden="true" />
            <b>{busy ? 'Uploading…' : 'Drop files here'}</b>
            <span className="meta" style={{ color: 'inherit' }}>or click to choose</span>
            <input ref={file} type="file" multiple accept="audio/*,video/*,image/*,.srt,.vtt,.ass,.ssa" onChange={(e) => e.target.files && upload(e.target.files)} />
          </label>
        </section>

        <section className="sheet">
          <h2><ScanText aria-hidden="true" />Screen captures</h2>
          <p>With the screen-ocr add-on, press <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">Alt</kbd>+<kbd className="kbd">O</kbd> and drag over any text on screen: a game, a video, a manga page. The capture lands in your inbox with its screenshot.</p>
          <p>Point screen-ocr at this hub:</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code className="code">screen-ocr --server {server}</code>
            <CopyButton text={`screen-ocr --server ${server}`} />
          </div>
        </section>
      </div>
    </>
  )
}
