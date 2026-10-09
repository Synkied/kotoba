import { api, type Lesson, type LessonFolder, type Material } from './api'

/** Names as people number them: Lesson 2 before Lesson 10. */
export const naturally = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export const subfolders = (folders: LessonFolder[], parent: number | null) =>
  folders.filter(f => f.parent === parent).sort((a, b) => a.position - b.position || a.id - b.id)

/** From the top down to this folder: the breadcrumb. */
export function folderPath(folders: LessonFolder[], id: number | null): LessonFolder[] {
  const byId = new Map(folders.map(f => [f.id, f]))
  const out: LessonFolder[] = []
  for (let at = id === null ? undefined : byId.get(id); at && out.length <= folders.length; at = at.parent === null ? undefined : byId.get(at.parent)) out.unshift(at)
  return out
}

/** The folder and every folder inside it, however deep. */
export function within(folders: LessonFolder[], id: number): Set<number> {
  const out = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const f of folders) if (f.parent !== null && out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grew = true }
  }
  return out
}

/** Every folder in tree order, with its full path: what a Move menu lists. */
export function folderOptions(folders: LessonFolder[]): { id: number; label: string }[] {
  const out: { id: number; label: string }[] = []
  const walk = (parent: number | null, path: string[]) => {
    for (const f of subfolders(folders, parent)) {
      out.push({ id: f.id, label: [...path, f.name].join(' › ') })
      walk(f.id, [...path, f.name])
    }
  }
  walk(null, [])
  return out
}

export const folderLabel = (folders: LessonFolder[], id: number | null) => folderPath(folders, id).map(f => f.name).join(' › ')

export const lessonsIn = (lessons: Lesson[], folder: number | null) =>
  lessons.filter(l => l.folder === folder).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))

export const materialsIn = (materials: Material[], folder: number | null) =>
  materials.filter(m => m.folder === folder).sort((a, b) => a.position - b.position || a.id - b.id)

export const fileSize = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`

/* ------------------------------------------------------------ importing a folder */

// what a lesson keeps, as the server allows it: no HTML or SVG, nothing a browser would run
const KEPT = /\.(pdf|wav|mp3|m4a|flac|ogg|opus|aac|mp4|mkv|webm|mov|png|jpe?g|webp|gif|txt|md)$/i
const MAX_FILES = 50

/** A folder as it was on disk: its files and the folders inside it. */
export type DiskFolder = { name: string; files: File[]; dirs: DiskFolder[] }

/** The folders picked with a folder input: each file knows its path from the folder chosen. */
export function fromPicked(list: FileList): DiskFolder[] {
  const root: DiskFolder = { name: '', files: [], dirs: [] }
  for (const file of list) {
    const parts = (file.webkitRelativePath || file.name).split('/')
    let at = root
    for (const name of parts.slice(0, -1)) {
      let next = at.dirs.find(d => d.name === name)
      if (!next) at.dirs.push(next = { name, files: [], dirs: [] })
      at = next
    }
    at.files.push(file)
  }
  return root.dirs
}

/** What was dropped on the page, folders read all the way down. Null when the browser
 *  can't read dropped folders; loose files come back as an unnamed folder. */
export async function fromDropped(items: DataTransferItemList): Promise<DiskFolder[] | null> {
  const entries = [...items].map(i => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return null
  const fileOf = (e: FileSystemFileEntry) => new Promise<File>((ok, fail) => e.file(ok, fail))
  const read = async (dir: FileSystemDirectoryEntry): Promise<DiskFolder> => {
    const reader = dir.createReader()
    const all: FileSystemEntry[] = []
    // a reader hands entries over in batches until it returns an empty one
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))
      if (!batch.length) break
      all.push(...batch)
    }
    return collect(dir.name, all)
  }
  const collect = async (name: string, list: FileSystemEntry[]): Promise<DiskFolder> => ({
    name,
    files: await Promise.all(list.filter(e => e.isFile).map(e => fileOf(e as FileSystemFileEntry))),
    dirs: await Promise.all(list.filter(e => e.isDirectory).map(e => read(e as FileSystemDirectoryEntry))),
  })
  const loose = await collect('', entries)
  return loose.files.length ? [{ ...loose, dirs: [] }, ...loose.dirs] : loose.dirs
}

/** How an import arrives: as files in folders, kept as they are (the default), or with
 *  each folder of files made into a lesson. */
export type ImportMode = 'files' | 'lessons'

/** What an import will make, counted before anything is sent. */
export type ImportPlan = { folders: number; lessons: number; files: number; skipped: string[] }

function tidy(d: DiskFolder, skipped: string[]): DiskFolder {
  const files = d.files.filter(f => {
    const ok = !f.name.startsWith('.') && KEPT.test(f.name) && f.size > 0
    if (!ok && !f.name.startsWith('.')) skipped.push(f.name)
    return ok
  }).sort((a, b) => naturally(a.name, b.name))
  const dirs = d.dirs.filter(x => !x.name.startsWith('.')).map(x => tidy(x, skipped))
    .filter(x => x.files.length || x.dirs.length).sort((a, b) => naturally(a.name, b.name))
  return { name: d.name, files, dirs }
}

const chunks = (files: File[], size = MAX_FILES) => Array.from({ length: Math.ceil(files.length / size) }, (_, i) => files.slice(i * size, (i + 1) * size))

/** Hidden files and what a folder can't keep are left out; the rest in name order. */
export function tidyImport(dropped: DiskFolder[]): { tree: DiskFolder[]; skipped: string[] } {
  const skipped: string[] = []
  const tree = dropped.map(d => tidy(d, skipped)).filter(d => d.files.length || d.dirs.length)
  return { tree, skipped }
}

/** As files, every folder stays a folder. As lessons, a folder that holds files becomes a
 *  lesson with them; one that also holds folders stays a folder, its loose files a lesson
 *  of the same name, first in it. Loose files dropped at the top go in the open folder. */
export function planImport(tree: DiskFolder[], skipped: string[], mode: ImportMode): ImportPlan {
  const plan: ImportPlan = { folders: 0, lessons: 0, files: 0, skipped }
  const count = (d: DiskFolder) => {
    if (d.name && (mode === 'files' || d.dirs.length)) plan.folders++
    if (mode === 'lessons') plan.lessons += chunks(d.files).length
    plan.files += d.files.length
    d.dirs.forEach(count)
  }
  tree.forEach(count)
  return plan
}

/** Make the folders, then send the files a few at a time; `onSent` hears each batch. Returns
 *  the top folder made when a single folder was imported, to open it afterwards. */
export async function runImport(tree: DiskFolder[], into: number | null, mode: ImportMode, onSent: (files: File[], where: string) => void): Promise<number | null> {
  const lesson = async (name: string, files: File[], folder: number | null) => {
    const parts = chunks(files)
    for (const [i, part] of parts.entries()) {
      const title = parts.length > 1 ? `${name || part[0].name.replace(/\.[^.]+$/, '')} · ${i + 1}` : name
      await api.createLesson(title, part, folder)
      onSent(part, title || part[0].name)
    }
  }
  // a dozen files a request: big recordings still go up in reasonable pieces
  const materials = async (name: string, files: File[], folder: number | null) => {
    for (const part of chunks(files, 12)) { await api.addMaterials(part, folder); onSent(part, name) }
  }
  const make = async (d: DiskFolder, parent: number | null): Promise<number | null> => {
    if (!d.name) { await (mode === 'files' ? materials('', d.files, parent) : lesson('', d.files, parent)); return null }
    if (mode === 'lessons' && !d.dirs.length) { await lesson(d.name, d.files, parent); return null }
    const folder = await api.createLessonFolder(d.name, parent)
    if (d.files.length) await (mode === 'files' ? materials(d.name, d.files, folder.id) : lesson(d.name, d.files, folder.id))
    for (const sub of d.dirs) await make(sub, folder.id)
    return folder.id
  }
  let top: number | null = null
  for (const d of tree) top = await make(d, into)
  return tree.length === 1 ? top : null
}
