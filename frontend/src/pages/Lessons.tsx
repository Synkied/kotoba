import { Archive, ArrowDown, ArrowDownUp, ArrowUp, AudioLines, BookPlus, Check, ChevronDown, ChevronRight, Ellipsis, Folder, FolderInput, GripVertical, NotebookPen, Pencil, Pin, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type FileKind, type Lesson, type LessonFolder, type Material, type Note } from '../lib/api'
import { fileSize, folderLabel, folderOptions, folderPath, fromDropped, fromPicked, lessonsIn, materialsIn, planImport, runImport, subfolders, tidyImport, within, type DiskFolder, type ImportMode } from '../lib/lessonTree'
import { useStats } from '../App'
import { ErrorNotice, SearchBox, Skeleton, dayLabel, useAction, useAsync, useToast } from '../components/ui'
import { Button, ButtonRow, Checkbox, EmptyState, Field, Input, Select, Sheet } from '../components/ds'
import { plainText } from '../components/NoteMarkdown'
import { KindCounts, KindTile } from '../components/Kind'
import { fileDye, fileIcon, type Dye } from '../lib/dyes'
import { Menu, MenuItem, MenuRule } from '../components/Menu'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What a lesson holds, each part with its kind's dye: PDF, 4 recordings, 2 sources. */
export function lessonParts(l: Lesson): { dye: Dye; text: string }[] {
  const count = (kind: string) => l.files.filter(f => f.kind === kind).length
  const parts: [Dye, number | string][] = [
    ['doc', count('pdf') && (count('pdf') === 1 ? 'PDF' : `${count('pdf')} PDFs`)],
    ['media', count('audio') && plural(count('audio'), 'recording')],
    ['media', count('video') && plural(count('video'), 'video')],
    ['doc', count('image') && plural(count('image'), 'image')],
    ['doc', count('text') && plural(count('text'), 'text file')],
    ['source', l.sources.length && plural(l.sources.length, 'source')],
    ['note', l.linked_notes.length && plural(l.linked_notes.length, 'note')],
  ]
  return parts.filter(([, text]) => text).map(([dye, text]) => ({ dye, text: String(text) }))
}

/** What a lesson holds, as dyed counts; a lesson with nothing yet says so. */
export function LessonContents({ l }: { l: Lesson }) {
  const parts = lessonParts(l)
  return parts.length ? <KindCounts parts={parts} /> : <span className="meta">Nothing attached yet</span>
}

/** Done or not, pinned or not, with an Undo: the list pages and the lesson page share it. */
export function useLessonActions(onChange: (l: Lesson) => void) {
  const action = useAction()
  const toast = useToast()
  const { refresh } = useStats()
  const update = (l: Lesson, data: { done?: boolean; pinned?: boolean }, text: string, undo: { done?: boolean; pinned?: boolean }) =>
    action.run(async () => {
      onChange(await api.updateLesson(l.id, data))
      refresh()
      toast({ text, undo: async () => { onChange(await api.updateLesson(l.id, undo)); refresh() } })
    })
  return {
    ...action,
    done: (l: Lesson) => update(l, { done: true }, l.pinned ? `“${l.title}” is done. It stays pinned.` : `“${l.title}” is done and in the archive`, { done: false }),
    again: (l: Lesson) => update(l, { done: false }, `“${l.title}” is back in your lessons`, { done: true }),
    pin: (l: Lesson) => update(l, { pinned: !l.pinned }, l.pinned ? `Unpinned “${l.title}”` : `Pinned “${l.title}”`, { pinned: l.pinned }),
  }
}

/** What's being dragged on the shelf: one of its folders, lessons or files. */
type Dragged = { kind: 'lesson' | 'folder' | 'material'; id: number }
const DRAG_TYPE = 'application/x-kotoba-lesson'

const kindName: Record<FileKind, string> = { pdf: 'PDF', audio: 'Recording', video: 'Video', image: 'Image', text: 'Text' }
const pending = (m: Material) => m.job === 'waiting' || m.job === 'running'

export default function LessonsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const archive = params.get('view') === 'archive'
  const [q, setQ] = useState('')
  // a new lesson: files to upload with it, and folder files picked to go in it
  const [creating, setCreating] = useState<{ files: File[]; materials: number[] } | null>(null)
  const { stats, refresh } = useStats()
  const toast = useToast()
  const { data, error, loading, reload, set } = useAsync(() => api.lessons(archive ? { state: 'done', q } : {}), [archive, q])
  const tree = useAsync(() => api.lessonFolders(), [])
  const files = useAsync(() => api.materials(), [])
  const noteList = useAsync(() => api.notes(), [])
  const folders = useMemo(() => tree.data ?? [], [tree.data])
  const materials = useMemo(() => files.data ?? [], [files.data])
  const notes = noteList.data ?? []
  // ?folder=id opens a folder; one that's gone (deleted elsewhere) falls back to the top
  const asked = Number(params.get('folder')) || null
  const open = asked !== null && folders.some(f => f.id === asked) ? asked : null
  const actions = useLessonActions((changed) => set((prev) => {
    // a lesson done here leaves the list (unless pinned); one taken out of the archive leaves it
    const stays = archive ? changed.done_at !== null : changed.done_at === null || changed.pinned
    const known = prev?.some(l => l.id === changed.id)
    if (!stays) return (prev ?? []).filter(l => l.id !== changed.id)
    return known ? prev!.map(l => l.id === changed.id ? changed : l) : [changed, ...(prev ?? [])]
  }))
  // a transcript on its way: look again now and then until it's there
  const transcribing = materials.some(pending)
  const setFiles = files.set
  useEffect(() => {
    if (!transcribing) return
    const t = setInterval(() => api.materials().then(setFiles, () => { /* the next look may work */ }), 5000)
    return () => clearInterval(t)
  }, [transcribing, setFiles])
  const lessons = data ?? []
  const days = useMemo(() => {
    const out: { key: string; items: Lesson[] }[] = []
    if (archive) for (const l of data ?? []) {
      const key = new Date(l.done_at!).toDateString()
      if (out.at(-1)?.key !== key) out.push({ key, items: [] })
      out.at(-1)!.items.push(l)
    }
    return out
  }, [archive, data])
  const show = (view: 'archive' | null) => { setQ(''); setParams(view ? { view } : {}, { replace: true }) }
  const reloadAll = () => { reload(); tree.reload(); files.reload(); noteList.reload() }
  const here = folderPath(folders, open).at(-1)
  const newFolder = useAction()
  const addFolder = () => {
    const name = window.prompt(here ? `New folder in “${here.name}”` : 'New folder', '')?.trim()
    if (name) newFolder.run(async () => { await api.createLessonFolder(name, open); tree.reload() })
  }
  const newNote = useAction()
  const addNote = () => newNote.run(async () => {
    const note = await api.createNote({ title: 'Untitled', body: '', folder: archive ? null : open })
    navigate(`/notes?note=${note.id}`)
  })

  // files dropped or chosen go straight into the open folder, as they are
  const upload = useAction()
  const addFiles = (list: File[]) => upload.run(async () => {
    const made = await api.addMaterials(list, open)
    files.set(prev => [...(prev ?? []), ...made])
    toast({ text: `Added ${made.length === 1 ? `“${made[0].name}”` : `${made.length} files`} to ${here ? `“${here.name}”` : 'the top level'}` })
  })
  // a folder picked or dropped is checked over before anything is sent
  const [incoming, setIncoming] = useState<{ tree: DiskFolder[]; skipped: string[] } | null>(null)
  const [over, setOver] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const take = (dropped: DiskFolder[]) => {
    if (dropped.length === 1 && !dropped[0].name && !dropped[0].dirs.length) {
      const { tree: kept, skipped } = tidyImport(dropped)
      if (kept.length && !skipped.length) return addFiles(kept[0].files)
    }
    setIncoming(tidyImport(dropped))
  }
  const dropOnPage = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setOver(false)
    const dropped = await fromDropped(e.dataTransfer.items)
    if (dropped) take(dropped)
  }
  const empty = !lessons.length && !folders.length && !materials.length && !notes.length

  return (
    <div className={'lessons-page' + (over ? ' over' : '')}
      onDragOver={e => { if (!archive && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={e => { if (!archive) void dropOnPage(e) }}>
      <header className="page-head">
        <h1><Link to="/library" className="page-home" aria-current={!archive && open === null ? 'page' : undefined}>Library</Link> <span className="meta num">{stats ? `${stats.lessons} to study` : ''}</span></h1>
        <span className="grow" />
        <div className="tabs" role="group" aria-label="Show">
          <button type="button" aria-pressed={!archive} onClick={() => show(null)}>Current</button>
          <button type="button" aria-pressed={archive} onClick={() => show('archive')}><Archive aria-hidden="true" />Archive</button>
        </div>
        {!archive && <>
          <input ref={filePicker} type="file" multiple hidden accept="application/pdf,.pdf,audio/*,video/*,image/*,.txt,.md" onChange={e => { if (e.target.files?.length) addFiles([...e.target.files]); e.target.value = '' }} />
          <input ref={picker} type="file" hidden {...{ webkitdirectory: '' }} onChange={e => { if (e.target.files?.length) take(fromPicked(e.target.files)); e.target.value = '' }} />
          {/* everything that adds to the open folder, in one place */}
          <Menu label={here ? `Add to “${here.name}”` : 'Add to the library'} content={<><Plus aria-hidden="true" />{upload.busy ? 'Adding…' : newNote.busy ? 'Creating…' : 'Add'}<ChevronDown aria-hidden="true" /></>}>
            <MenuItem disabled={newFolder.busy} onClick={addFolder}><KindTile dye="folder" size="small" />New folder</MenuItem>
            <MenuItem disabled={newNote.busy} onClick={addNote}><KindTile dye="note" size="small" />New note</MenuItem>
            <MenuRule />
            <MenuItem disabled={upload.busy} onClick={() => filePicker.current?.click()}><Upload aria-hidden="true" />Add files<span className="meta">kept as they are</span></MenuItem>
            <MenuItem onClick={() => picker.current?.click()}><FolderInput aria-hidden="true" />Import a folder<span className="meta">with what it holds</span></MenuItem>
          </Menu>
        </>}
        {!creating && <Button variant="primary" onClick={() => setCreating({ files: [], materials: [] })}><Plus aria-hidden="true" />New lesson</Button>}
      </header>

      {incoming && <ImportSheet {...incoming} into={archive ? null : open} folders={folders}
        onCancel={() => setIncoming(null)}
        onDone={(top) => { setIncoming(null); reloadAll(); refresh(); if (top) setParams({ folder: String(top) }, { replace: true }) }} />}
      {creating && <NewLesson key={creating.materials.join() + creating.files.length} initialFiles={creating.files} initialMaterials={creating.materials}
        folder={archive ? null : open} folders={folders} materials={materials} onCancel={() => setCreating(null)} />}
      {(actions.error ?? upload.error ?? newNote.error ?? newFolder.error) != null && <ErrorNotice error={actions.error ?? upload.error ?? newNote.error ?? newFolder.error} />}
      {archive && <div className="lessons-search"><SearchBox value={q} onChange={setQ} placeholder="Search done lessons by title, notes, folder or file" /></div>}

      {error ? <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} /> :
        tree.error ?? files.error ?? noteList.error ? <ErrorNotice error={tree.error ?? files.error ?? noteList.error} action={<Button size="small" onClick={reloadAll}>Try again</Button>} /> :
        (loading && !data) || !tree.data || !files.data || !noteList.data ? <Skeleton /> :
        archive ? (
          !lessons.length ? (
            <EmptyState>
              <h2>{q ? 'Nothing matches' : 'The archive is empty'}</h2>
              <p>{q ? 'Try another word from the title, the notes, the folder or a file name.' : 'When you finish a lesson, choose “Mark done”. It leaves your current lessons and waits here, with its files and notes, for whenever you want to look back.'}</p>
            </EmptyState>
          ) : days.map(day => {
            const { date, rel } = dayLabel(day.items[0].done_at!)
            return (
              <section className="day" key={day.key} aria-label={`Done ${date}`}>
                <div className="day-head"><span className="date">{date}</span>{rel && <span className="meta">{rel}</span>}</div>
                <ul className="source-cards">{day.items.map(l => <LessonCard key={l.id} l={l} actions={actions} where={folderLabel(folders, l.folder)} />)}</ul>
              </section>
            )
          })
        ) : empty ? (
          !creating && <EmptyState>
            <h2>Your library is empty</h2>
            <p>Keep your material here the way you sort it: folders as deep as you like, holding files, lessons, and Markdown notes. Already have it all sorted on your computer? Import the folder, or drop it here.</p>
            <ButtonRow>
              <Button variant="primary" onClick={() => picker.current?.click()}><FolderInput aria-hidden="true" />Import folder</Button>
              <Button onClick={() => filePicker.current?.click()}><Upload aria-hidden="true" />Add files</Button>
              <Button onClick={() => setCreating({ files: [], materials: [] })}><Plus aria-hidden="true" />New lesson</Button>
              <Button onClick={addNote}><NotebookPen aria-hidden="true" />New note</Button>
              {stats?.lessons === 0 && <Button onClick={() => show('archive')}><Archive aria-hidden="true" />Open the archive</Button>}
            </ButtonRow>
          </EmptyState>
        ) : <Shelf lessons={lessons} folders={folders} materials={materials} notes={notes} open={open} actions={actions} onChanged={reloadAll}
              onMaterials={changed => files.set(prev => (prev ?? []).map(m => changed.find(c => c.id === m.id) ?? m))}
              onNewLesson={ids => setCreating({ files: [], materials: ids })}
              go={(id) => setParams(id === null ? {} : { folder: String(id) }, { replace: false })} />}
      {over && <div className="lessons-drop-hint" aria-hidden="true"><FolderInput /><b>Drop to add {here ? `to “${here.name}”` : 'here'}</b><span>Files are kept as they are; a folder keeps its folders</span></div>}
    </div>
  )
}

/** One folder open: the way back up, then what it holds, in your order: its folders, its
 *  lessons and its files. Drag one onto another of its kind to put it before; onto a folder
 *  or a step of the path to move it there; a file onto a lesson to add it to the lesson.
 *  Arrange does the same with buttons. */
function Shelf({ lessons, folders, materials, notes, open, actions, onChanged, onMaterials, onNewLesson, go }: {
  lessons: Lesson[]; folders: LessonFolder[]; materials: Material[]; notes: Note[]; open: number | null; actions: ReturnType<typeof useLessonActions>
  onChanged: () => void; onMaterials: (changed: Material[]) => void; onNewLesson: (materials: number[]) => void; go: (id: number | null) => void
}) {
  const edit = useAction()
  const toast = useToast()
  const [arranging, setArranging] = useState(false)
  const [dragged, setDragged] = useState<Dragged | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const path = folderPath(folders, open)
  const here = path.at(-1)
  const top = open === null
  const options = folderOptions(folders)
  // at the top, whatever's pinned has its own row, wherever it's kept; inside a folder it stays in its place
  const pinned = top ? lessons.filter(l => l.pinned) : []
  const pinnedFolders = top ? options.map(o => folders.find(f => f.id === o.id)!).filter(f => f.pinned) : []
  const pinnedFiles = top ? materials.filter(m => m.pinned) : []
  const shelves = subfolders(folders, open).filter(f => !top || !f.pinned)
  const listed = lessonsIn(lessons, open).filter(l => !top || !l.pinned)
  const kept = materialsIn(materials, open).filter(m => !top || !m.pinned)
  const listedNotes = notes.filter(n => n.folder === open).sort((a, b) => a.position - b.position || a.id - b.id)
  const selected = kept.filter(m => picked.has(m.id))
  const counts = (f: LessonFolder) => {
    const inside = within(folders, f.id)
    const isIn = (x: { folder: number | null }) => x.folder !== null && inside.has(x.folder)
    return { lessons: lessons.filter(isIn).length, files: materials.filter(isIn).length, notes: notes.filter(isIn).length, folders: subfolders(folders, f.id).length }
  }
  // the selection belongs to the open folder
  const [seen, setSeen] = useState(open)
  if (seen !== open) { setSeen(open); setPicked(new Set()) }

  const change = (fn: () => Promise<unknown>) => edit.run(async () => { await fn(); onChanged() })
  const moveLesson = (l: Lesson, to: number | null) => to !== l.folder && change(() => api.updateLesson(l.id, { folder: to }))
  const moveNote = (n: Note, to: number | null) => to !== n.folder && change(() => api.updateNote(n.id, { folder: to }))
  const moveFolder = (f: LessonFolder, to: number | null) => to !== f.parent && (to === null || !within(folders, f.id).has(to)) && change(() => api.updateLessonFolder(f.id, { parent: to }))
  const moveFiles = (ids: number[], to: number | null) => change(async () => {
    for (const id of ids) await api.updateMaterial(id, { folder: to })
    setPicked(new Set())
  })
  const reorder = <T extends { id: number }>(kind: 'lessons' | 'folders' | 'materials', list: T[], id: number, before: number | null) => {
    const ids = list.map(x => x.id).filter(x => x !== id)
    ids.splice(before === null ? ids.length : ids.indexOf(before), 0, id)
    return change(() => api.arrangeLessons(open, { [kind]: ids }))
  }
  const step = <T extends { id: number }>(kind: 'lessons' | 'folders' | 'materials', list: T[], i: number, by: -1 | 1) =>
    reorder(kind, list, list[i].id, by === -1 ? list[i - 1].id : list[i + 2]?.id ?? null)
  const into = (to: number | null) => {
    if (!dragged) return
    if (dragged.kind === 'lesson') moveLesson(lessons.find(l => l.id === dragged.id)!, to)
    else if (dragged.kind === 'folder') moveFolder(folders.find(f => f.id === dragged.id)!, to)
    // dragging a picked file takes the whole selection along
    else moveFiles(picked.has(dragged.id) ? [...picked] : [dragged.id], to)
  }
  const linkInto = (l: Lesson, id: number) => {
    const ids = picked.has(id) ? selected.map(m => m.id) : [id]
    edit.run(async () => {
      await api.linkLessonMaterials(l.id, ids)
      onChanged()
      toast({ text: `Added ${ids.length === 1 ? `“${kept.find(m => m.id === ids[0])?.name}”` : `${ids.length} files`} to “${l.title}”` })
    })
  }

  // drag and drop: what each card, row or step of the path does with what's dropped on it
  const draggable = (d: Dragged) => ({
    draggable: !edit.busy,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(DRAG_TYPE, ''); e.dataTransfer.effectAllowed = 'move'; setDragged(d) },
    onDragEnd: () => { setDragged(null); setTarget(null) },
  })
  const dropTarget = (key: string, accepts: boolean, onDrop: () => void) => !dragged || !accepts ? {} : {
    'data-drop': target === key || undefined,
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes(DRAG_TYPE)) return; e.preventDefault(); e.stopPropagation(); setTarget(key) },
    onDragLeave: () => setTarget(t => t === key ? null : t),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setTarget(null); setDragged(null); onDrop() },
  }
  const intoFolder = (f: LessonFolder | null) => dropTarget(`f${f?.id ?? 'top'}`,
    !!dragged && (dragged.kind !== 'folder' || (dragged.id !== f?.id && (f === null || !within(folders, dragged.id).has(f.id)))),
    () => into(f?.id ?? null))
  const onLesson = (l: Lesson) => dragged?.kind === 'lesson' && dragged.id !== l.id ? dropTarget(`l${l.id}`, true, () => reorder('lessons', listed, dragged.id, l.id))
    : dragged?.kind === 'material' ? dropTarget(`l${l.id}`, true, () => linkInto(l, dragged.id)) : {}
  const dragging = (kind: Dragged['kind'], id: number) => dragged?.kind === kind && (dragged.id === id || (kind === 'material' && picked.has(dragged.id) && picked.has(id))) || undefined

  const rename = (f: LessonFolder) => {
    const name = window.prompt(`Rename the folder “${f.name}”`, f.name)?.trim()
    if (name && name !== f.name) change(() => api.updateLessonFolder(f.id, { name }))
  }
  const remove = (f: LessonFolder) => {
    const n = counts(f)
    const parent = path.at(-2)?.name ?? 'the top level'
    const held = [n.folders && `${n.folders === 1 ? 'one folder' : `${n.folders} folders`}`, n.lessons && `${n.lessons === 1 ? 'one lesson' : `${n.lessons} lessons`}`,
      n.files && `${n.files === 1 ? 'one file' : `${n.files} files`}`,
      n.notes && `${n.notes === 1 ? 'one note' : `${n.notes} notes`}`].filter(Boolean).join(', ')
    if (!window.confirm(`Delete the folder “${f.name}”?${held ? ` What it holds (${held}) moves up to ${parent}. Nothing else is deleted.` : ''}`)) return
    edit.run(async () => { await api.deleteLessonFolder(f.id); go(f.parent); onChanged(); toast({ text: `Deleted the folder “${f.name}”` }) })
  }
  const renameFile = (m: Material) => {
    const name = window.prompt(`Rename “${m.name}”`, m.name)?.trim()
    if (name && name !== m.name) edit.run(async () => onMaterials([await api.updateMaterial(m.id, { name })]))
  }
  const deleteFiles = (list: Material[]) => {
    const used = list.filter(m => m.lessons.length).length
    if (!window.confirm(`Delete ${list.length === 1 ? `“${list[0].name}”` : `these ${list.length} files`}?${used ? ` ${used === list.length && list.length === 1 ? 'It’s' : `${used === 1 ? 'One is' : `${used} are`}`} also taken out of the lessons ${used === 1 ? 'it’s' : 'they’re'} in.` : ''} Transcripts stay in Sources. This can’t be undone.`)) return
    change(async () => { for (const m of list) await api.deleteMaterial(m.id); setPicked(new Set()) })
  }
  const recordings = selected.filter(m => (m.kind === 'audio' || m.kind === 'video') && (m.job === null || m.job === 'failed'))
  const transcribe = (list: Material[]) => edit.run(async () => {
    onMaterials(await api.transcribeMaterials(list.map(m => m.id)))
    setPicked(new Set())
    toast({ text: list.length === 1 ? `“${list[0].name}” is queued for transcribing` : `${list.length} recordings are queued for transcribing` })
  })
  const pinFolder = (f: LessonFolder) => edit.run(async () => {
    await api.updateLessonFolder(f.id, { pinned: !f.pinned })
    onChanged()
    toast({ text: f.pinned ? `Unpinned “${f.name}”` : `Pinned “${f.name}” to the top of the library`,
      undo: async () => { await api.updateLessonFolder(f.id, { pinned: f.pinned }); onChanged() } })
  })
  const pinFiles = (list: Material[], pinned: boolean) => edit.run(async () => {
    const set = (to: (m: Material) => boolean) => Promise.all(list.map(m => api.updateMaterial(m.id, { pinned: to(m) })))
    onMaterials(await set(() => pinned))
    setPicked(new Set())
    const what = list.length === 1 ? `“${list[0].name}”` : `${list.length} files`
    toast({ text: pinned ? `Pinned ${what} to the top of the library` : `Unpinned ${what}`, undo: async () => onMaterials(await set(m => m.pinned)) })
  })
  const toggle = (id: number) => setPicked(prev => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next })

  const busy = edit.busy || actions.busy
  const hint = dragged
    ? dragged.kind === 'lesson' ? 'Drop on a lesson to put it before, or on a folder or the path to move it'
    : dragged.kind === 'folder' ? 'Drop on a folder or a step of the path to move it there'
    : 'Drop on a file to put it before, on a lesson to add it there, or on a folder to move it'
    : null
  const canArrange = shelves.length + listed.length + kept.length > 1 || options.length > 0
  return <>
    {/* where you are: the way back up, the open folder named large with what you can do to it,
        and how to move things, all on one line */}
    <div className="lesson-where" data-top={top || undefined}>
      {here && <nav className="lesson-path" aria-label="Folder">
        <ol>
          <li><button type="button" className="link" onClick={() => go(null)} {...intoFolder(null)}>Library</button></li>
          {path.map(f => <li key={f.id}><ChevronRight aria-hidden="true" />
            <button type="button" className="link" aria-current={f.id === open ? 'location' : undefined} onClick={() => go(f.id)} {...intoFolder(f)}>
              {f.id === open && <KindTile dye="folder" size="small" icon={here.pinned ? Pin : undefined} />}{f.name}</button></li>)}
        </ol>
      </nav>}
      {here && <Menu label={`Folder “${here.name}”`} variant="ghost" size="small" icon align="start" content={<Ellipsis aria-hidden="true" />}>
        <MenuItem disabled={busy} onClick={() => pinFolder(here)}><Pin aria-hidden="true" />{here.pinned ? 'Unpin from the top' : 'Pin to the top of the library'}</MenuItem>
        <MenuItem disabled={busy} onClick={() => rename(here)}><Pencil aria-hidden="true" />Rename folder</MenuItem>
        <MenuRule />
        <MenuItem disabled={busy} onClick={() => remove(here)}><Trash2 aria-hidden="true" />Delete folder</MenuItem>
      </Menu>}
      <span className="grow" />
      <p className="meta lesson-drag-hint" role="status">{hint ?? (!arranging && shelves.length + listed.length + kept.length > 1
        ? <><GripVertical aria-hidden="true" className="inline-icon" />Drag to reorder, or onto a folder to move</> : arranging ? 'Move with the arrows, or pick a folder' : '')}</p>
      {canArrange && <Button size="small" variant={arranging ? 'primary' : undefined} aria-pressed={arranging} onClick={() => setArranging(!arranging)}
        title="Move and reorder with buttons, instead of dragging">{arranging ? <><Check aria-hidden="true" />Done arranging</> : <><ArrowDownUp aria-hidden="true" />Arrange</>}</Button>}
    </div>
    {edit.error != null && <ErrorNotice error={edit.error} />}

    {pinned.length + pinnedFolders.length + pinnedFiles.length > 0 && (
      <section className="day pinned-shelf" aria-labelledby="pinned-head">
        <div className="day-head"><span className="date" id="pinned-head"><Pin aria-hidden="true" className="inline-icon" />Pinned</span><span className="meta">Always here, wherever they’re kept</span></div>
        {pinnedFolders.length > 0 && <ul className="source-cards folder-cards">{pinnedFolders.map(f => (
          <FolderCard key={f.id} f={f} n={counts(f)} where={folderLabel(folders, f.parent)} busy={busy} onPin={() => pinFolder(f)} drag={intoFolder(f)} />
        ))}</ul>}
        {pinned.length > 0 && <ul className="source-cards">{pinned.map(l => <LessonCard key={l.id} l={l} actions={actions} where={folderLabel(folders, l.folder)} />)}</ul>}
        {pinnedFiles.length > 0 && <ul className="material-list">{pinnedFiles.map(m => (
          <MaterialRow key={m.id} m={m} where={folderLabel(folders, m.folder)} busy={busy} onPin={() => pinFiles([m], false)} />
        ))}</ul>}
      </section>
    )}

    {shelves.length > 0 && (
      <section className="day" aria-labelledby="folders-head">
        <div className="day-head"><span className="date" id="folders-head" data-dye="folder">Folders</span><span className="meta num">{shelves.length}</span></div>
        <ul className="source-cards folder-cards">{shelves.map((f, i) => (
          <FolderCard key={f.id} f={f} n={counts(f)} busy={busy} onPin={() => pinFolder(f)}
            drag={{ ...draggable({ kind: 'folder', id: f.id }), ...intoFolder(f), 'data-dragging': dragging('folder', f.id) }}
            arrange={arranging ? <Arrange label={f.name} busy={busy} first={i === 0} last={i === shelves.length - 1}
              onUp={() => step('folders', shelves, i, -1)} onDown={() => step('folders', shelves, i, 1)}
              folder={f.parent} options={options.filter(o => !within(folders, f.id).has(o.id))} onMove={to => moveFolder(f, to)} /> : undefined} />
        ))}</ul>
      </section>
    )}

    {(listed.length > 0 || (!here && !shelves.length && !kept.length && !listedNotes.length)) && <section className="day" aria-labelledby="todo-head">
      <div className="day-head"><span className="date" id="todo-head" data-dye="lesson">{here ? 'Lessons' : 'To study'}</span><span className="meta num">{listed.length || ''}</span></div>
      {listed.length ? <ul className="source-cards">{listed.map((l, i) => (
        <LessonCard key={l.id} l={l} actions={actions}
          drag={{ ...draggable({ kind: 'lesson', id: l.id }), ...onLesson(l), 'data-dragging': dragging('lesson', l.id) }}
          arrange={arranging ? <Arrange label={l.title} busy={busy} first={i === 0} last={i === listed.length - 1}
            onUp={() => step('lessons', listed, i, -1)} onDown={() => step('lessons', listed, i, 1)}
            folder={l.folder} options={options} onMove={to => moveLesson(l, to)} /> : undefined} />
      ))}</ul>
        : <p className="meta">All caught up. New material goes here; finished lessons are in the archive.</p>}
    </section>}

    {listedNotes.length > 0 && (
      <section className="day" aria-labelledby="notes-head">
        <div className="day-head"><span className="date" id="notes-head" data-dye="note">Notes</span><span className="meta num">{listedNotes.length}</span></div>
        <ul className="material-list">{listedNotes.map(note => <NoteRow key={note.id} note={note} options={options} busy={busy} onMove={arranging ? to => moveNote(note, to) : undefined} />)}</ul>
      </section>
    )}

    {kept.length > 0 && (
      <section className="day" aria-labelledby="files-head">
        <div className="day-head"><span className="date" id="files-head" data-dye="doc">Files</span><span className="meta num">{kept.length}</span>
          <span className="grow" />
          <label className="meta material-all"><Checkbox type="checkbox" checked={selected.length === kept.length}
            ref={el => { if (el) el.indeterminate = selected.length > 0 && selected.length < kept.length }}
            onChange={() => setPicked(selected.length === kept.length ? new Set() : new Set(kept.map(m => m.id)))} />Select all</label></div>
        <ul className="material-list">{kept.map((m, i) => (
          <MaterialRow key={m.id} m={m} picked={picked.has(m.id)} onPick={() => toggle(m.id)} busy={busy} onPin={() => pinFiles([m], !m.pinned)}
            drag={{ ...draggable({ kind: 'material', id: m.id }), ...(dragged?.kind === 'material' && !dragging('material', m.id) && !picked.has(m.id)
              ? dropTarget(`m${m.id}`, true, () => reorder('materials', kept, dragged.id, m.id)) : {}), 'data-dragging': dragging('material', m.id) }}
            arrange={arranging ? <Arrange label={m.name} busy={busy} first={i === 0} last={i === kept.length - 1} className="material-arrange"
              onUp={() => step('materials', kept, i, -1)} onDown={() => step('materials', kept, i, 1)}
              folder={m.folder} options={options} onMove={to => moveFiles([m.id], to)} /> : undefined} />
        ))}</ul>
      </section>
    )}

    {!shelves.length && !listed.length && !listedNotes.length && !kept.length && here && (
      <EmptyState className="lesson-folder-empty">
        <h2>“{here.name}” is empty</h2>
        <p>Add files, make a lesson or a note, or drag a lesson, a file or a folder onto its name in the path above.</p>
      </EmptyState>
    )}

    {selected.length > 0 && (
      <div className="toolbar active selection-dock" role="toolbar" aria-label="Selected files">
        <span className="num" style={{ fontWeight: 700 }}>{selected.length === 1 ? '1 file' : `${selected.length} files`}</span>
        <Button size="small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }} disabled={busy} onClick={() => onNewLesson(selected.map(m => m.id))}>
          <BookPlus aria-hidden="true" />Make a lesson</Button>
        {recordings.length > 0 && <Button variant="ghost" size="small" disabled={busy} onClick={() => transcribe(recordings)}>
          <AudioLines aria-hidden="true" />Transcribe{recordings.length > 1 ? ` ${recordings.length}` : ''}</Button>}
        <label className="selection-move"><span className="sr">Move the selected files to</span>
          <Select className="chip-select" disabled={busy} value="" onChange={e => e.target.value && moveFiles(selected.map(m => m.id), e.target.value === 'top' ? null : Number(e.target.value))}>
            <option value="">Move to…</option>
            {open !== null && <option value="top">Top level</option>}
            {options.filter(o => o.id !== open).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select></label>
        <Button variant="ghost" size="small" disabled={busy} onClick={() => pinFiles(selected, true)}><Pin aria-hidden="true" />Pin</Button>
        {selected.length === 1 && <Button variant="ghost" size="small" disabled={busy} onClick={() => renameFile(selected[0])}><Pencil aria-hidden="true" />Rename</Button>}
        <Button variant="ghost" size="small" disabled={busy} onClick={() => deleteFiles(selected)}><Trash2 aria-hidden="true" />Delete</Button>
        <span className="grow" />
        <Button variant="ghost" size="small" disabled={busy} onClick={() => setPicked(new Set())}>Clear</Button>
      </div>
    )}
  </>
}

type DragProps = React.HTMLAttributes<HTMLLIElement> & { 'data-drop'?: boolean; 'data-dragging'?: boolean }

/** Pin or unpin a folder or a file: pinned, it shows at the top of the library too. */
function PinButton({ name, pinned, busy, onPin }: { name: string; pinned: boolean; busy: boolean; onPin: () => void }) {
  return (
    <Button variant="ghost" size="small" icon className="card-pin" aria-pressed={pinned} disabled={busy} onClick={onPin}
      aria-label={`Pin ${name} to the top of the library`} title={pinned ? 'Pinned to the top of the library' : 'Pin to the top of the library'}>
      <Pin aria-hidden="true" />
    </Button>
  )
}

/** A folder on the shelf: open it, drop things on it, pin it. */
function FolderCard({ f, n, where, busy, onPin, drag, arrange }: {
  f: LessonFolder; n: { folders: number; lessons: number; files: number; notes: number }
  /** the folder it's in, when the list doesn't already say */
  where?: string
  busy: boolean; onPin: () => void; drag: DragProps; arrange?: ReactNode
}) {
  return (
    <li className="source-card folder-card" data-dye="folder" {...drag}>
      <KindTile dye="folder" />
      <div className="source-card-body">
        <h3><Link to={`/library?folder=${f.id}`} className="source-card-link">{f.name}</Link></h3>
        <p className="meta num">{[n.folders && `${n.folders} folder${n.folders === 1 ? '' : 's'}`, n.lessons && `${n.lessons} to study`, n.files && `${n.files} file${n.files === 1 ? '' : 's'}`, n.notes && `${n.notes} note${n.notes === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || 'Empty'}</p>
        {where && <p className="meta source-card-meta"><Folder aria-hidden="true" />{where}</p>}
      </div>
      <PinButton name={f.name} pinned={f.pinned} busy={busy} onPin={onPin} />
      {arrange}
    </li>
  )
}

function NoteRow({ note, options, busy, onMove }: {
  note: Note; options: { id: number; label: string }[]; busy: boolean
  /** while arranging: move it to another folder */
  onMove?: (to: number | null) => void
}) {
  const excerpt = plainText(note.body).split('\n').find(Boolean) || 'Empty note'
  return <li className="material-row library-note-row">
    <KindTile dye="note" />
    <div className="material-main">
      <Link className="material-name" to={`/notes?note=${note.id}`}>{note.title}</Link>
      <span className="meta">{excerpt}{note.sources.length > 0 && ` · ${note.sources.length} linked source${note.sources.length === 1 ? '' : 's'}`}</span>
    </div>
    {onMove && <label className="library-note-move"><span className="sr">Folder for {note.title}</span>
      <Select className="chip-select" disabled={busy} value={note.folder ?? ''} onChange={e => onMove(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Top level</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
    </label>}
  </li>
}

/** A file kept as it is: open it, see which lessons use it and where its transcript stands.
 *  In the pinned row it can't be picked or dragged, and says which folder it's in. */
function MaterialRow({ m, picked = false, onPick, busy, onPin, where, drag, arrange }: {
  m: Material; picked?: boolean; onPick?: () => void; busy: boolean; onPin: () => void; where?: string; arrange?: ReactNode
  drag?: DragProps
}) {
  return (
    <li className="material-row" data-selected={picked || undefined} {...drag}>
      {onPick && <Checkbox type="checkbox" checked={picked} onChange={onPick} aria-label={`Select ${m.name}`} />}
      <KindTile dye={fileDye(m.kind)} icon={fileIcon[m.kind]} />
      <div className="material-main">
        {m.source !== null
          ? <Link className="material-name" to={`/sources/${m.source}`} lang="ja">{m.name}</Link>
          : <a className="material-name" href={m.url} target="_blank" rel="noreferrer" lang="ja">{m.name}</a>}
        <span className="meta num">{kindName[m.kind]} · {fileSize(m.size)}{m.source !== null && m.job === '' && ' · transcribed'}
          {where && <span> · <Folder aria-hidden="true" className="inline-icon" />{where}</span>}
          {m.lessons.map(l => <span key={l.id}> · in <Link to={`/lessons/${l.id}`}>{l.title}</Link></span>)}</span>
      </div>
      {m.source !== null && m.job && <Link className={'lesson-file-job' + (m.job === 'failed' ? ' failed' : '')} to={`/sources/${m.source}`}
        title={m.job === 'failed' ? m.job_error || undefined : undefined}>
        {m.job === 'waiting' ? 'Waiting to transcribe' : m.job === 'running' ? 'Transcribing…' : 'Transcribing failed'}</Link>}
      <PinButton name={m.name} pinned={m.pinned} busy={busy} onPin={onPin} />
      {arrange}
    </li>
  )
}

/** Arrange, without dragging: one step up or down, or off to another folder. */
function Arrange({ label, busy, first, last, onUp, onDown, folder, options, onMove, className = 'source-card-foot lesson-arrange' }: {
  label: string; busy: boolean; first: boolean; last: boolean; onUp: () => void; onDown: () => void
  folder: number | null; options: { id: number; label: string }[]; onMove: (to: number | null) => void; className?: string
}) {
  return (
    <div className={className}>
      <Button variant="ghost" size="small" icon disabled={busy || first} onClick={onUp} aria-label={`Move ${label} up`} title="Move up"><ArrowUp aria-hidden="true" /></Button>
      <Button variant="ghost" size="small" icon disabled={busy || last} onClick={onDown} aria-label={`Move ${label} down`} title="Move down"><ArrowDown aria-hidden="true" /></Button>
      <label className="grow"><span className="sr">Folder for {label}</span>
        <Select className="chip-select" disabled={busy} value={folder ?? ''} onChange={e => onMove(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Top level</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select></label>
    </div>
  )
}

/** A folder from the computer, counted out before anything is sent. By default it comes in
 *  as it is, folders and files; making lessons of it is a choice. */
function ImportSheet({ tree, skipped, into, folders, onCancel, onDone }: {
  tree: DiskFolder[]; skipped: string[]; into: number | null; folders: LessonFolder[]
  onCancel: () => void; onDone: (top: number | null) => void
}) {
  const action = useAction()
  const toast = useToast()
  const [mode, setMode] = useState<ImportMode>('files')
  const [sent, setSent] = useState(0)
  const [current, setCurrent] = useState('')
  const plan = planImport(tree, skipped, mode)
  const where = folderLabel(folders, into) || 'the library'
  const names = tree.map(d => d.name).filter(Boolean)
  const counted = (n: number, one: string, many = `${one}s`) => `${n === 1 ? 'one' : n} ${n === 1 ? one : many}`
  const start = () => action.run(async () => {
    let n = 0, at = ''
    try {
      const top = await runImport(tree, into, mode, (part, title) => { n += part.length; at = title; setSent(n); setCurrent(title) })
      toast({ text: `Imported ${[plan.folders && counted(plan.folders, 'folder'), mode === 'lessons' ? counted(plan.lessons, 'lesson') : counted(plan.files, 'file')].filter(Boolean).join(' and ')}` })
      onDone(top)
    } catch (e) {
      // what was sent stays: say how far it got, so it isn't imported twice
      throw new Error(`${e instanceof Error ? e.message : String(e)} The import stopped${at ? ` after “${at}”` : ' at the start'}; ${n ? `the ${counted(n, 'file')} sent before ${n === 1 ? 'is' : 'are'} in place` : 'nothing was added'}.`)
    }
  })
  return (
    <Sheet className="new-lesson" aria-labelledby="import-head">
      <h2 id="import-head"><FolderInput aria-hidden="true" />Import {names.length === 1 ? `“${names[0]}”` : 'folders'}</h2>
      {plan.files ? <>
        <div className="tabs" role="group" aria-label="Bring it in">
          <button type="button" aria-pressed={mode === 'files'} disabled={action.busy} onClick={() => setMode('files')}>As files, the way it is</button>
          <button type="button" aria-pressed={mode === 'lessons'} disabled={action.busy} onClick={() => setMode('lessons')}>One lesson per folder</button>
        </div>
        <p>Into <b>{where}</b>: {[plan.folders && counted(plan.folders, 'folder'), mode === 'lessons' && counted(plan.lessons, 'lesson'), counted(plan.files, 'file')].filter(Boolean).join(', ')}.{' '}
          {mode === 'files'
            ? 'Every folder stays a folder and every file is kept as it is. Make lessons later from the files you pick.'
            : 'Each folder that holds files becomes a lesson with them; folders of folders stay folders.'}
          {' '}Recordings aren’t transcribed until you ask.</p>
        {skipped.length > 0 && <p className="meta">Left out, because folders keep PDFs, audio, video, images and text files: {skipped.slice(0, 6).join(', ')}{skipped.length > 6 ? ` and ${skipped.length - 6} more` : ''}.</p>}
        {action.busy && <div role="status"><span className="meter" aria-hidden="true"><i style={{ width: `${(100 * sent) / plan.files}%` }} /></span>
          <p className="meta num">{sent} of {plan.files} files{current && <> · <span lang="ja">{current}</span></>}</p></div>}
        {action.error != null && <ErrorNotice error={action.error} />}
        <ButtonRow>
          <Button variant="primary" disabled={action.busy || action.error != null} aria-busy={action.busy} onClick={start}>{action.busy ? 'Importing…' : 'Import'}</Button>
          <Button type="button" variant="ghost" disabled={action.busy} onClick={action.error != null ? () => onDone(null) : onCancel}>{action.error != null ? 'Close' : 'Cancel'}</Button>
        </ButtonRow>
      </> : <>
        <p>Nothing here a folder can keep: PDFs, audio, video, images and text files.{skipped.length > 0 && ` Found ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}.`}</p>
        <ButtonRow><Button onClick={onCancel}>Close</Button></ButtonRow>
      </>}
    </Sheet>
  )
}

function LessonCard({ l, actions, where, arrange, drag }: {
  l: Lesson; actions: ReturnType<typeof useLessonActions>
  /** the folder it's in, when the list doesn't already say */
  where?: string
  /** buttons to move it, in place of Pin and Done */
  arrange?: ReactNode
  drag?: React.HTMLAttributes<HTMLLIElement> & { 'data-drop'?: boolean; 'data-dragging'?: boolean }
}) {
  const note = l.linked_notes.map(n => plainText(n.excerpt)).find(Boolean)
  const when = l.done_at ? `Done ${new Date(l.done_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : `Added ${new Date(l.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
  return (
    <li className="source-card lesson-card" data-dye="lesson" data-done={l.done_at ? true : undefined} {...drag}>
      <div className="lesson-card-head">
        <KindTile dye="lesson" />
        <h3><Link to={`/lessons/${l.id}`} className="source-card-link">{l.title}</Link></h3>
      </div>
      <div className="source-card-body">
        <LessonContents l={l} />
        {where && <p className="meta source-card-meta"><Folder aria-hidden="true" />{where}</p>}
        {note && <p className="source-card-line">{note}</p>}
      </div>
      {arrange ?? <div className="source-card-foot">
        <span className="meta num">{when}</span>
        <span className="grow" />
        <Button variant="ghost" size="small" icon className="card-pin" aria-pressed={l.pinned} disabled={actions.busy} onClick={() => actions.pin(l)}
          aria-label={`Pin ${l.title} to the top of the library`} title={l.pinned ? 'Pinned to the top of the library' : 'Pin to the top of the library'}><Pin aria-hidden="true" /></Button>
        {l.done_at
          ? <Button variant="ghost" size="small" disabled={actions.busy} onClick={() => actions.again(l)}><RotateCcw aria-hidden="true" />Study again</Button>
          : <Button variant="ghost" size="small" disabled={actions.busy} onClick={() => actions.done(l)} title="Finished with it: it moves to the archive"><Check aria-hidden="true" />Mark done</Button>}
      </div>}
    </li>
  )
}

/** A title, then what goes in the lesson: files already in the open folder, picked, and new
 *  ones dropped or chosen. The title defaults to the first file's name. */
export function NewLesson({ onCancel, initialFiles = [], initialMaterials = [], folder = null, folders = [], materials = [] }: {
  onCancel?: () => void; initialFiles?: File[]; initialMaterials?: number[]
  folder?: number | null; folders?: LessonFolder[]; materials?: Material[]
}) {
  const [title, setTitle] = useState('')
  const [files, setFiles] = useState<File[]>(initialFiles)
  // folder files in the order they were picked: that's their order in the lesson
  const [chosen, setChosen] = useState<number[]>(initialMaterials)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const action = useAction()
  const nav = useNavigate()
  const { refresh } = useStats()
  const here = materialsIn(materials, folder)
  // picked elsewhere (a selection moved since) still counts, and shows
  const offered = [...here, ...materials.filter(m => chosen.includes(m.id) && m.folder !== folder)]
  const add = (list: FileList | null) => { if (list) setFiles(prev => [...prev, ...[...list].filter(f => !prev.some(p => p.name === f.name && p.size === f.size))]); if (input.current) input.current.value = '' }
  const toggle = (id: number) => setChosen(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const create = (e: React.FormEvent) => {
    e.preventDefault()
    action.run(async () => {
      const lesson = await api.createLesson(title.trim(), files, folder, chosen)
      refresh()
      nav(`/lessons/${lesson.id}`)
    })
  }
  const first = files[0]?.name ?? materials.find(m => m.id === chosen[0])?.name
  const named = title.trim() || first?.replace(/\.[^.]+$/, '')
  return (
    <Sheet as="form" className="new-lesson" onSubmit={create}>
      <h2><KindTile dye="lesson" size="small" />New lesson{folder !== null && <span className="meta"> in {folderLabel(folders, folder)}</span>}</h2>
      <Field><span>Title</span>
        <Input autoFocus maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder={first ? first.replace(/\.[^.]+$/, '') : 'Minna no Nihongo, lesson 19'} /></Field>
      {offered.length > 0 && (
        <fieldset className="lesson-pick">
          <legend>Files from {folder !== null ? 'this folder' : 'the top level'} <span className="meta num">{chosen.length ? `${chosen.length} picked` : 'none picked yet'}</span></legend>
          <p className="meta">They stay where they are; the lesson links to them.</p>
          <ul className="material-list">{offered.map(m => {
            return (
              <li key={m.id} className="material-row" data-selected={chosen.includes(m.id) || undefined}>
                <Checkbox type="checkbox" id={`pick-${m.id}`} checked={chosen.includes(m.id)} disabled={action.busy} onChange={() => toggle(m.id)} />
                <KindTile dye={fileDye(m.kind)} icon={fileIcon[m.kind]} size="small" />
                <label className="material-main" htmlFor={`pick-${m.id}`}><span className="material-name" lang="ja">{m.name}</span>
                  <span className="meta num">{kindName[m.kind]} · {fileSize(m.size)}</span></label>
              </li>
            )
          })}</ul>
        </fieldset>
      )}
      <label className={'drop' + (over ? ' over' : '') + (action.busy ? ' disabled' : '')}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}>
        <Upload aria-hidden="true" />
        <b>{offered.length ? 'Or drop new files for it here' : 'Drop the lesson’s files here'}</b>
        <span className="meta" style={{ color: 'inherit' }}>PDFs, recordings, videos, pictures · or click to choose</span>
        <input ref={input} type="file" multiple disabled={action.busy} accept="application/pdf,.pdf,audio/*,video/*,image/*,.txt,.md" onChange={e => add(e.target.files)} />
      </label>
      {files.length > 0 && <ul className="lesson-files-pending">{files.map((f, i) => (
        <li key={f.name + i}><span>{f.name}</span><span className="meta num">{fileSize(f.size)}</span>
          <Button type="button" variant="ghost" size="small" icon aria-label={`Remove ${f.name}`} disabled={action.busy} onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}><X aria-hidden="true" /></Button></li>
      ))}</ul>}
      {action.error != null && <ErrorNotice error={action.error} />}
      <ButtonRow>
        <Button variant="primary" disabled={!named || action.busy} aria-busy={action.busy}>{action.busy ? 'Creating…' : 'Create lesson'}</Button>
        {onCancel && <Button type="button" variant="ghost" disabled={action.busy} onClick={onCancel}>Cancel</Button>}
      </ButtonRow>
    </Sheet>
  )
}
