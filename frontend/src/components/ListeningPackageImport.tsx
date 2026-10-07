import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Upload, X } from 'lucide-react'
import { api, type ListeningLesson } from '../lib/api'
import { ErrorNotice, useAction } from './ui'

const audioFile = (file: File) => /\.(mp3|wav|m4a|flac|ogg|opus|aac|webm|aiff|aif)$/i.test(file.name)

export default function ListeningPackageImport({ onImported, onCancel, initialFiles = [] }: { onImported: (lesson: ListeningLesson) => void; onCancel?: () => void; initialFiles?: File[] }) {
  const [files, setFiles] = useState<File[]>(initialFiles)
  const [title, setTitle] = useState('')
  const [over, setOver] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const action = useAction()
  const pdfs = files.filter(file => /\.pdf$/i.test(file.name))
  const audio = files.filter(audioFile)
  const invalid = files.filter(file => !pdfs.includes(file) && !audio.includes(file))
  const valid = pdfs.length === 1 && audio.length > 0 && !invalid.length && files.reduce((sum, file) => sum + file.size, 0) <= 100 * 1024 * 1024
  const add = (chosen: FileList | File[]) => {
    if (action.busy) return
    action.clearError()
    const incoming = [...chosen].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    setFiles(previous => [...previous, ...incoming.filter(file => !previous.some(old => old.name === file.name && old.size === file.size && old.lastModified === file.lastModified))])
    if (picker.current) picker.current.value = ''
  }
  const move = (file: File, step: number) => {
    const index = files.indexOf(file), adjacent = audio[audio.indexOf(file) + step]
    if (!adjacent) return
    const next = [...files], other = files.indexOf(adjacent)
    ;[next[index], next[other]] = [next[other], next[index]]
    setFiles(next)
  }
  return <form className="listening-import sheet" onSubmit={event => {
    event.preventDefault()
    if (valid) action.run(async () => onImported(await api.importListeningPackage(files, title)))
  }}>
    <h2>Import a quiz package</h2>
    <p>Choose a lesson’s PDF and audio files together. They stay together as one package, with a quiz for each recording.</p>
    <label className="field"><span>Package name (optional)</span><input className="input" value={title} maxLength={200} disabled={action.busy} onChange={event => setTitle(event.target.value)} placeholder="Minna no Nihongo · Lesson 19" /></label>
    <label className={'drop' + (over ? ' over' : '') + (action.busy ? ' disabled' : '')}
      onDragOver={event => { event.preventDefault(); if (!action.busy) setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={event => { event.preventDefault(); setOver(false); add(event.dataTransfer.files) }}>
      <Upload aria-hidden="true" /><b>{files.length ? 'Add more files' : 'Choose PDF and audio files'}</b><span className="meta">Select several files, or drop them here</span>
      <input ref={picker} aria-label="Quiz package files" type="file" multiple accept=".pdf,.mp3,.wav,.m4a,.flac,.ogg,.opus,.aac,.webm,.aiff,.aif" disabled={action.busy} onChange={event => event.target.files && add(event.target.files)} />
    </label>
    {files.length > 0 && <>
      <ul className="listening-import-files">{[...pdfs, ...audio, ...invalid].map((file, index) => <li key={`${file.name}-${index}`}>
        <div><strong>{file.name}</strong><span className="meta">{pdfs.includes(file) ? 'Worksheet' : audio.includes(file) ? `Recording ${audio.indexOf(file) + 1}` : 'Unsupported file'} · {(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
        <div className="btn-row">{audio.includes(file) && <><button className="btn small icon" type="button" aria-label={`Move ${file.name} up`} disabled={action.busy || audio.indexOf(file) === 0} onClick={() => move(file, -1)}><ArrowUp aria-hidden="true" /></button><button className="btn small icon" type="button" aria-label={`Move ${file.name} down`} disabled={action.busy || audio.indexOf(file) === audio.length - 1} onClick={() => move(file, 1)}><ArrowDown aria-hidden="true" /></button></>}
          <button className="btn small icon" type="button" aria-label={`Remove ${file.name}`} disabled={action.busy} onClick={() => setFiles(previous => previous.filter(old => old !== file))}><X aria-hidden="true" /></button></div>
      </li>)}</ul>
      {!valid && <p role="status">Choose exactly one PDF and at least one audio file, with a total size under 100 MB. Remove unsupported files.</p>}
    </>}
    <p className="meta">Prepared questions are included for the supplied lesson 18 files. For another worksheet, add its questions after importing.</p>
    {action.error != null && <ErrorNotice error={action.error} />}
    <div className="btn-row"><button className="btn primary" type="submit" disabled={!valid || action.busy} aria-busy={action.busy}>{action.busy ? 'Importing package…' : 'Create quiz package'}</button>{onCancel && <button className="btn" type="button" disabled={action.busy} onClick={onCancel}>Cancel</button>}</div>
  </form>
}
