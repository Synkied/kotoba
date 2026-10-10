export type Stamp = { id: number; created_at: string; overall: number; accuracy: number; clarity: number; fluency: number; model: string }
export type Sentence = {
  id: number; source: number; source_kind: SourceKind; source_title: string; position: number
  text: string; roman: string; furigana: [string, string][]; start: number | null; end: number | null
  note: string; translations: Record<string, string>; reading_overrides: [string, string][]; has_audio: boolean; image: string | null; due: string | null; reps: number; lapses: number
  best: number | null; last: number | null; stamps: Stamp[]; decks: { id: number; name: string }[]; created_at: string
}
export type SourceKind = 'capture' | 'audio' | 'video' | 'subtitle' | 'text'
export type Source = {
  id: number; kind: SourceKind; status: 'inbox' | 'kept' | 'archived'; title: string; text: string
  category: string; labels: string[]; image: string | null; media: string | null; duration: number | null
  job: '' | 'waiting' | 'running' | 'failed'; job_error: string; created_at: string; sentences: Sentence[]
  /** the lessons it's studied in */
  lessons: { id: number; title: string; done: boolean }[]
}
export type Deck = { id: number; name: string; description: string; folder: string; created_at: string; size: number; due: number; practised: number; average: number | null }
export type Stats = { inbox: number; due: number; sentences: number; decks: number; lessons: number; attempts_today: number; waiting: number }
export type Facets = { categories: { name: string; count: number }[]; labels: { name: string; count: number }[] }
export type Unit = { text: string; status: 'ok' | 'unclear' | 'missed' | 'partial'; conf: number | null }
export type Score = {
  said: string; overall: number; accuracy: number; clarity: number; fluency: number; units: Unit[]
  missed: string[]; unclear: string[]; extra: string[]; fillers: string[]; error?: string
}
export type EngineState = 'missing' | 'idle' | 'loading' | 'ready' | 'error'
export type EngineStatus = { state: EngineState; error: string | null; loaded: string[] | null; key: string[]; readings: boolean }
export type Job = {
  id: number; kind: 'transcribe' | 'render'; source: number; title: string
  state: 'queued' | 'running' | 'done' | 'error'; log: string[]; progress: number | null; error: string | null
  result: Record<string, unknown> | null
}
export type Recording = {
  id: number; title: string; kind: SourceKind; status: Source['status']; labels: string[]; duration: number | null
  created_at: string; job: Source['job']; transcribed: boolean; script: boolean; edited: boolean; rendered: boolean; sentences: number
}
export type TranscriptionQueue = {
  items: { source: number; title: string; state: 'queued' | 'running'; progress: number | null }[]
  can_transcribe: boolean
}
export type Cut = { start: number; end: number; reason: string; on: boolean }
/** one transcript character: [char, start, end, automatic cut reason] */
export type TChar = [string, number, number, string | null]
export type ScriptRow = { text: string; status: 'ok' | 'partial' | 'missing'; coverage: number; takes: number; start: number | null; end: number | null }
export type CleanupSettings = {
  cue_back?: number; repeat_threshold?: number; utt_gap?: number; max_pause?: number; pad?: number; lead?: number
  script_match?: number; no_fillers?: boolean; no_repeats?: boolean; no_script?: boolean; no_pauses?: boolean
  cues?: string[]; fillers?: string[]; model?: string; device?: string; compute_type?: string
}
export type Cleanup = {
  source: number; title: string; kind: SourceKind; media: string; duration: number | null
  transcribed: boolean; model: string | null; settings: CleanupSettings
  defaults: Required<Omit<CleanupSettings, 'fillers'>> & { fillers: string[]; default_fillers: string[] }
  script: string; utts: TChar[][]; report: ScriptRow[] | null; cuts: Cut[]; edited: boolean
  clean: string | null; rendered_at: string | null; job: Job | null; can_transcribe: boolean
}
export type Addons = {
  whisper: EngineStatus; ffmpeg: boolean
  voices: { count: number; kokoro: 'missing' | 'available' | 'loading' | 'ready' | 'error'; kokoro_error: string | null; voicevox: boolean; voicevox_url: string }
  queue: { waiting: number; failed: number; jobs: Job[] }
  screen_ocr: { last_capture: string | null }
  dictionary: DictionaryStatus
}
/** translator and cloud come with the quick read: who does the work, and whether it costs credits */
export type Language = { to: string; name: string; translator?: string; cloud?: boolean }
export type TranslatorKind = 'ollama' | 'llamacpp' | 'anthropic' | 'openai'
export type Translator = {
  id: string; kind: TranslatorKind; name: string; url: string; model: string
  key_set: boolean; key_hint: string; cloud: boolean; builtin: boolean
}
/** What the form sends: an empty key keeps the saved one. */
export type TranslatorDraft = { id?: string; kind: TranslatorKind; name: string; url: string; model: string; key: string }
export type TranslatorCheck = { url: string; model: string; cloud: boolean; ready: boolean; error: string | null; models: string[] }
export type TranslationStatus = Language & TranslatorCheck & {
  languages: { code: string; name: string }[]; translated: number; sentences: number
  active: string; translators: Translator[]; defaults: Record<TranslatorKind, string>
}
export type DictionaryStatus = { state: 'missing' | 'downloading' | 'ready' | 'error'; error: string | null; lang: string; version?: string }
export type DictEntry = {
  id: number
  kanji: { text: string; common: boolean; tags: string[] }[]
  kana: { text: string; common: boolean; tags: string[]; kanji: string[] }[]
  senses: { pos: string[]; misc: string[]; info: string[]; kanji: string[]; kana: string[]; gloss: string[] }[]
}
/** The word around a tapped character: as written, as read in this sentence, and in the dictionary. */
export type Word = {
  surface: string; start: number; end: number; reading: string; romaji: string; furigana: [string, string][]
  lemma: string | null; lemma_reading: string | null; lemma_romaji: string | null; entries: DictEntry[]
}
/** What a selected stretch means in its sentence, from the translator in use. */
export type Explanation = { translation: string; notes: string[]; to: string; name: string; translator: string; cloud: boolean }
export type Page<T> = { count: number; results: T[] }

/** source/job: the library source transcribed from this recording, and how that's going */
/** A shelf for lessons; parent null is the top. The page builds the tree from the flat list. */
export type LessonFolder = { id: number; name: string; parent: number | null; position: number; pinned: boolean }
export type FileKind = 'pdf' | 'audio' | 'video' | 'image' | 'text'
/** a file in a lesson; `material` when it's a folder file linked in rather than uploaded with it */
/** A file kept in a folder as it is, in no lesson or in some: `lessons` are the ones it's linked into. */
export type Material = {
  id: number; name: string; kind: FileKind; folder: number | null; position: number; pinned: boolean; size: number; created_at: string; url: string
  source: number | null; job: Source['job'] | null; job_error: string; lessons: { id: number; title: string }[]
}
export type LessonFile = { id: number; name: string; kind: FileKind; url: string; material: number | null; source: number | null; job: Source['job'] | null; job_error: string }
export type LessonSource = { id: number; title: string; kind: SourceKind; status: Source['status']; sentences: number; job: Source['job']; media: string | null }
export type Lesson = {
  id: number; title: string; notes: string; folder: number | null; position: number; pinned: boolean; done_at: string | null; created_at: string
  files: LessonFile[]; sources: LessonSource[]; can_transcribe: boolean
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try { r = await fetch('/api/' + path, init) }
  catch { throw new ApiError('Couldn’t reach kotoba. Check your connection and try again.', 0) }
  if (r.status === 204) return undefined as T
  const ctype = r.headers.get('Content-Type') || ''
  const body = ctype.includes('json') ? await r.json() : await r.text()
  if (!r.ok) {
    const msg = typeof body === 'object' && body !== null ? body.error || body.detail || Object.entries(body).map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(' ') : String(value)}`).join(' · ') : ''
    throw new ApiError(r.status >= 500 ? 'Kotoba couldn’t finish that request. Try again in a moment.' : msg || 'The request couldn’t be completed. Check your input and try again.', r.status)
  }
  return body as T
}
const json = (method: string, data: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
const qs = (p: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const out = s.toString()
  return out ? '?' + out : ''
}

export async function allSentences(params: { deck?: number; source?: number } = {}): Promise<Page<Sentence>> {
  const results: Sentence[] = []
  let page: Page<Sentence>
  do {
    page = await api.sentences({ ...params, limit: 200, offset: results.length })
    results.push(...page.results)
  } while (page.results.length && results.length < page.count)
  return { count: page.count, results }
}

export const api = {
  lessons: (p: { state?: 'done'; q?: string } = {}) => req<Lesson[]>('lessons' + qs(p)),
  lesson: (id: number) => req<Lesson>(`lessons/${id}`),
  createLesson: (title: string, files: File[], folder: number | null = null, materials: number[] = []) => {
    const form = new FormData(); form.append('title', title)
    if (folder !== null) form.append('folder', String(folder))
    materials.forEach(id => form.append('materials', String(id)))
    files.forEach(file => form.append('files', file))
    return req<Lesson>('lessons', { method: 'POST', body: form })
  },
  updateLesson: (id: number, data: Partial<Pick<Lesson, 'title' | 'notes' | 'pinned' | 'folder'>> & { done?: boolean; sources?: number[] }) =>
    req<Lesson>(`lessons/${id}`, json('PATCH', data)),
  lessonFolders: () => req<LessonFolder[]>('lesson-folders'),
  createLessonFolder: (name: string, parent: number | null) => req<LessonFolder>('lesson-folders', json('POST', { name, parent })),
  updateLessonFolder: (id: number, data: Partial<Pick<LessonFolder, 'name' | 'parent' | 'pinned'>>) => req<LessonFolder>(`lesson-folders/${id}`, json('PATCH', data)),
  deleteLessonFolder: (id: number) => req<void>(`lesson-folders/${id}`, { method: 'DELETE' }),
  /** put these folders and lessons in `folder` (null: the top), in this order */
  materials: () => req<Material[]>('materials'),
  addMaterials: (files: File[], folder: number | null) => {
    const form = new FormData(); files.forEach(file => form.append('files', file))
    if (folder !== null) form.append('folder', String(folder))
    return req<Material[]>('materials', { method: 'POST', body: form })
  },
  updateMaterial: (id: number, data: Partial<Pick<Material, 'name' | 'folder' | 'pinned'>>) => req<Material>(`materials/${id}`, json('PATCH', data)),
  deleteMaterial: (id: number) => req<void>(`materials/${id}`, { method: 'DELETE' }),
  transcribeMaterials: (ids: number[]) => req<Material[]>('materials/transcribe', json('POST', { ids })),
  linkLessonMaterials: (id: number, materials: number[]) => req<Lesson>(`lessons/${id}/files`, json('POST', { materials })),
  arrangeLessons: (folder: number | null, items: { folders?: number[]; lessons?: number[]; materials?: number[] }) => req<void>('lessons/arrange', json('POST', { folder, ...items })),
  deleteLesson: (id: number) => req<void>(`lessons/${id}`, { method: 'DELETE' }),
  addLessonFiles: (id: number, files: File[]) => {
    const form = new FormData(); files.forEach(file => form.append('files', file))
    return req<Lesson>(`lessons/${id}/files`, { method: 'POST', body: form })
  },
  removeLessonFile: (id: number, file: number) => req<void>(`lessons/${id}/files/${file}`, { method: 'DELETE' }),
  transcribeLessonFile: (id: number, file: number) => req<Lesson>(`lessons/${id}/files/${file}/transcribe`, { method: 'POST' }),
  stats: () => req<Stats>('stats'),
  /** the word at `at`, or with `end` the selected stretch text[at:end] */
  lookup: (text: string, at: number, pairs: [string, string][], signal?: AbortSignal, end?: number) =>
    req<{ word: Word | null; dictionary: DictionaryStatus }>('lookup' + qs({ text, at, end, ...(pairs.length ? { pairs: JSON.stringify(pairs) } : {}) }), { signal }),
  explain: (text: string, context: string, force = false, signal?: AbortSignal) =>
    req<Explanation>('explain', { ...json('POST', { text, context, force }), signal }),
  facets: () => req<Facets>('facets'),
  sources: (p: { status?: string; q?: string; kind?: string; category?: string; label?: string; limit?: number; offset?: number }) =>
    req<Page<Source>>('sources' + qs({ limit: 50, ...p })),
  source: (id: number) => req<Source>(`sources/${id}`),
  updateSource: (id: number, data: Partial<Pick<Source, 'status' | 'text' | 'title' | 'category' | 'labels'>>) =>
    req<Source>(`sources/${id}`, json('PATCH', data)),
  setSentences: (id: number, sentences: { text: string; start?: number | null; end?: number | null }[]) =>
    req<Source>(`sources/${id}/sentences`, json('POST', { sentences })),
  bulk: (data: { ids: number[]; status?: string; category?: string; add_label?: string | string[]; delete?: boolean }) =>
    req<{ updated?: number; deleted?: number }>('sources/bulk', json('POST', data)),
  sentences: (p: { q?: string; category?: string; label?: string; deck?: number; source?: number; status?: string; kind?: string; practice?: string; limit?: number; offset?: number }) =>
    req<Page<Sentence>>('sentences' + qs({ limit: 200, ...p })),
  sentence: (id: number) => req<Sentence>(`sentences/${id}`),
  updateSentence: (id: number, data: Partial<Pick<Sentence, 'text' | 'note' | 'reading_overrides' | 'translations'>>) => req<Sentence>(`sentences/${id}`, json('PATCH', data)),
  translate: (id: number, force = false) => req<Sentence>(`sentences/${id}/translate`, json('POST', { force })),
  language: () => req<Language>('translation?quick=1'),
  translation: () => req<TranslationStatus>('translation'),
  setLanguage: (to: string) => req<TranslationStatus>('translation', json('PATCH', { to })),
  chooseTranslator: (active: string) => req<TranslationStatus>('translation', json('PATCH', { active })),
  addTranslator: (t: TranslatorDraft, activate: boolean) => req<Translator>('translation/translators', json('POST', { ...t, activate })),
  updateTranslator: (id: string, t: TranslatorDraft, activate: boolean) => req<Translator>(`translation/translators/${id}`, json('PATCH', { ...t, activate })),
  removeTranslator: (id: string) => req<void>(`translation/translators/${id}`, { method: 'DELETE' }),
  testTranslator: (t: TranslatorDraft) => req<TranslatorCheck>('translation/translators/test', json('POST', t)),
  deleteSentence: (id: number) => req<void>(`sentences/${id}`, { method: 'DELETE' }),
  decks: () => req<Page<Deck>>('decks?limit=500'),
  deck: (id: number) => req<Deck>(`decks/${id}`),
  createDeck: (name: string, folder = '') => req<Deck>('decks', json('POST', { name, folder })),
  updateDeck: (id: number, data: Partial<Pick<Deck, 'name' | 'description' | 'folder'>>) => req<Deck>(`decks/${id}`, json('PATCH', data)),
  deleteDeck: (id: number) => req<void>(`decks/${id}`, { method: 'DELETE' }),
  addToDeck: (id: number, sentences: number[]) => req<Deck>(`decks/${id}/add`, json('POST', { sentences })),
  removeFromDeck: (id: number, sentences: number[]) => req<void>(`decks/${id}/remove`, json('POST', { sentences })),
  orderDeck: (id: number, sentences: number[]) => req<void>(`decks/${id}/order`, json('POST', { sentences })),
  review: () => req<{ due: Sentence[]; new: Sentence[]; next_due: string | null }>('review'),
  attempt: (data: Omit<Stamp, 'id' | 'created_at'> & { sentence: number; said?: string; units?: Unit[] }) =>
    req<{ sentence: Sentence }>('attempts', json('POST', data)),
  collectText: (text: string, title = '', labels: string[] = []) => req<Source>('collect/text', json('POST', { text, title, labels })),
  collectFile: (file: File, media?: File | null) => {
    const f = new FormData(); f.append('file', file); if (media) f.append('media', media)
    return req<Source>('collect/file', { method: 'POST', body: f })
  },
  engineStatus: () => req<EngineStatus>('engine/status'),
  engineLoad: () => req<EngineStatus>('engine/load', json('POST', {})),
  score: (pcm: Int16Array, expected: string) =>
    req<Score>('engine/score' + qs({ expected, final: 1 }), { method: 'POST', body: pcm.buffer as ArrayBuffer, headers: { 'Content-Type': 'application/octet-stream' } }),
  addons: () => req<Addons>('addons'),
  transcriptions: (signal?: AbortSignal) => req<TranscriptionQueue>('transcriptions', { signal }),
  job: (id: number) => req<Job>(`jobs/${id}`),
  recordings: () => req<Recording[]>('recordings'),
  cleanup: (id: number) => req<Cleanup>(`sources/${id}/cleanup`),
  analyze: (id: number, settings: CleanupSettings, retranscribe = false) =>
    req<Cleanup>(`sources/${id}/analyze`, json('POST', { settings, retranscribe })),
  saveCuts: (id: number, cuts: Cut[]) => req<{ saved: number }>(`sources/${id}/cuts`, json('PUT', { cuts })),
  saveScript: (id: number, text: string) => req<{ script: string; sentences: number }>(`sources/${id}/script`, json('PUT', { text })),
  render: (id: number, cuts: Cut[]) => req<Job>(`sources/${id}/render`, json('POST', { cuts })),
  peaks: (id: number) => req<{ rate: number; duration: number; peaks: number[] }>(`sources/${id}/peaks`),
  voices: () => req<{ voices: { id: string; name: string; engine?: string }[] }>('engine/tts/status'),
}

/** Decks grouped by folder: named folders A–Z, then the decks in none. */
export function byFolder(decks: Deck[]): [string, Deck[]][] {
  const groups = new Map<string, Deck[]>()
  for (const d of decks) groups.set(d.folder, [...(groups.get(d.folder) ?? []), d])
  return [...groups].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
}
