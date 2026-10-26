import { ChevronLeft, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Syllabus, type SyllabusUnit, type UnitSummary } from '../lib/api'
import { ErrorNotice, Skeleton, useAction, useAsync, useToast } from '../components/ui'
import { Button, ButtonLink, ButtonRow, EmptyState, Field, Input, Notice, Select, Textarea, buttonClass } from '../components/ds'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What stories are written within: JLPT, which comes with kotoba, and the courses you fill in. */
export default function SyllabiPage() {
  const { data, error, reload } = useAsync(() => api.syllabi(), [])
  const [name, setName] = useState('')
  const action = useAction()
  const nav = useNavigate()
  return <>
    <header className="page-head">
      <ButtonLink variant="ghost" icon to="/stories" aria-label="Back to stories"><ChevronLeft aria-hidden="true" /></ButtonLink>
      <h1>Syllabi</h1>
    </header>
    <p className="meta stories-lead">A story may use the words and grammar of the unit you pick and every unit before it. JLPT comes with kotoba;
      for a textbook such as Minna no Nihongo, add each lesson's words and grammar as a unit.</p>
    {error != null && <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} />}
    {!data && error == null && <Skeleton rows={3} />}
    {data && <ul className="syllabi">
      {data.map((s) => <li key={s.id}>
        <Link to={`/stories/syllabi/${s.id}`}><b>{s.name}</b></Link>
        <span className="meta num">{s.bundled ? 'Comes with kotoba · ' : ''}{plural(s.units.length, 'unit')} · {plural(s.units.reduce((n, u) => n + u.vocab, 0), 'word')}</span>
      </li>)}
    </ul>}
    <form className="edit-line syllabus-new" onSubmit={(e) => {
      e.preventDefault()
      action.run(async () => { const s = await api.createSyllabus(name); nav(`/stories/syllabi/${s.id}`) })
    }}>
      <Field style={{ flex: 1 }}><span>New syllabus</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Minna no Nihongo I" maxLength={200} /></Field>
      <Button disabled={!name.trim() || action.busy}><Plus aria-hidden="true" />Add</Button>
    </form>
    {action.error != null && <ErrorNotice error={action.error} />}
  </>
}

export function SyllabusPage() {
  const id = useParams().id!
  const { data: s, error, reload, set } = useAsync(() => api.syllabus(id), [id])
  const lessons = useAsync(() => api.lessons(), [])
  const archived = useAsync(() => api.lessons({ state: 'done' }), [])
  const [open, setOpen] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [csv, setCsv] = useState<string | null>(null)
  const action = useAction()
  const toast = useToast()
  const nav = useNavigate()
  if (error) return <ErrorNotice error={error} action={<Button onClick={reload}>Try again</Button>} />
  if (!s) return <Skeleton rows={4} />
  const next = Math.max(0, ...s.units.map((u) => u.number)) + 1
  const allLessons = [...(lessons.data ?? []), ...(archived.data ?? [])]
  const replaceUnit = (u: SyllabusUnit) => set((prev) => {
    const row: UnitSummary = { number: u.number, title: u.title, vocab: u.vocab.length, grammar: u.grammar.length, lesson: u.lesson, lesson_title: u.lesson_title ?? null }
    return { ...prev, units: [...prev.units.filter((x) => x.number !== u.number), row].sort((a, b) => a.number - b.number) }
  })

  return <>
    {action.error != null && <ErrorNotice error={action.error} />}
    <header className="page-head">
      <ButtonLink variant="ghost" icon to="/stories/syllabi" aria-label="Back to syllabi"><ChevronLeft aria-hidden="true" /></ButtonLink>
      {renaming === null ? <h1>{s.name} <span className="meta num">{plural(s.units.length, 'unit')}</span></h1> : (
        <form className="edit-line" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); action.run(async () => { set(await api.renameSyllabus(s.id, renaming)); setRenaming(null) }) }}>
          <label style={{ flex: 1 }}><span className="sr">Name</span><Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} /></label>
          <Button variant="primary" size="small">Save</Button>
        </form>
      )}
      <span className="grow" />
      <a className={buttonClass({})} href={api.syllabusCsvUrl(s.id)} download><Download aria-hidden="true" />Export CSV</a>
      {!s.bundled && <>
        <Button variant="ghost" onClick={() => setCsv(csv === null ? '' : null)} aria-expanded={csv !== null}><Upload aria-hidden="true" />Import CSV</Button>
        <Button variant="ghost" icon aria-label="Rename" title="Rename" onClick={() => setRenaming(s.name)}><Pencil aria-hidden="true" /></Button>
        <Button variant="ghost" icon aria-label={`Delete ${s.name}`} title="Delete" onClick={() => {
          if (window.confirm(`Delete “${s.name}” and its ${plural(s.units.length, 'unit')}? Stories already written stay.`))
            action.run(async () => { await api.deleteSyllabus(s.id); nav('/stories/syllabi') })
        }}><Trash2 aria-hidden="true" /></Button>
      </>}
    </header>

    {s.bundled && <p className="meta stories-lead">The JLPT word lists are Jonathan Waller's (tanos.co.uk, CC BY) by way of elzup/jlpt-word-list; the N5 and N4 grammar lists were written for kotoba.
      The JLPT publishes no official lists, so these are an approximation. They can't be changed here: export them to start your own.</p>}

    {csv !== null && <section className="syllabus-import" aria-label="Import CSV">
      <p className="meta">Columns: <code className="inline">unit, title, type, text, reading, meaning</code>, with type <code className="inline">vocab</code> or <code className="inline">grammar</code>
        (a grammar row's note goes in meaning). Each unit in the file replaces the unit with that number; others stay.</p>
      <Input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()) }} />
      <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'unit,title,type,text,reading,meaning\n1,はじめまして,vocab,会社員,かいしゃいん,office worker\n1,はじめまして,grammar,〜は〜です,,X is Y'} />
      <ButtonRow>
        <Button variant="primary" disabled={!csv.trim() || action.busy} onClick={() => action.run(async () => {
          const out = await api.importSyllabus(s.id, csv); set(out); setCsv(null); toast({ text: `${plural(out.imported, 'unit')} imported` })
        })}>Import</Button>
        <Button variant="ghost" onClick={() => setCsv(null)}>Cancel</Button>
      </ButtonRow>
    </section>}

    {!s.units.length && <EmptyState>
      <h2>No units yet</h2>
      <p>Add a unit for each lesson you've studied: its new words, one per line, and its grammar. Or import them all from a CSV.</p>
    </EmptyState>}
    <ol className="units">
      {s.units.map((u) => <li key={u.number}>
        {open === u.number ? <UnitEditor syl={s} n={u.number} lessons={allLessons.map((l) => ({ id: l.id, title: l.title }))}
          onSaved={(x) => { replaceUnit(x); setOpen(null) }} onClose={() => setOpen(null)}
          onDeleted={() => { set((prev) => ({ ...prev, units: prev.units.filter((x) => x.number !== u.number) })); setOpen(null) }} />
          : <div className="unit-row">
            <span className="unit-n num">{s.bundled ? u.title : u.number}</span>
            <span className="unit-what">
              {!s.bundled && <b lang="ja">{u.title || `Unit ${u.number}`}</b>}
              <span className="meta num">{plural(u.vocab, 'word')} · {plural(u.grammar, 'grammar point')}{u.lesson_title && <> · <Link to={`/lessons/${u.lesson}`}>{u.lesson_title}</Link></>}</span>
            </span>
            <span className="grow" />
            <ButtonLink size="small" variant="ghost" to={`/stories?syllabus=${s.id}&unit=${u.number}`}>Make a story</ButtonLink>
            <Button size="small" variant="ghost" onClick={() => setOpen(u.number)}>{s.bundled ? 'Show' : 'Edit'}</Button>
          </div>}
      </li>)}
    </ol>
    {!s.bundled && (open === next ? <UnitEditor syl={s} n={next} fresh lessons={allLessons.map((l) => ({ id: l.id, title: l.title }))}
      onSaved={(x) => { replaceUnit(x); setOpen(null) }} onClose={() => setOpen(null)} onDeleted={() => setOpen(null)} />
      : <ButtonRow><Button onClick={() => setOpen(next)}><Plus aria-hidden="true" />Add unit {next}</Button></ButtonRow>)}
  </>
}

const vocabText = (rows: SyllabusUnit['vocab']) => rows.map(([w, r, m]) => `${w}${r ? ' ' + r : ''}${m ? ' — ' + m : ''}`).join('\n')
const grammarText = (rows: SyllabusUnit['grammar']) => rows.map(([p, n]) => `${p}${n ? ' — ' + n : ''}`).join('\n')

function UnitEditor({ syl, n, fresh, lessons, onSaved, onClose, onDeleted }: {
  syl: Syllabus; n: number; fresh?: boolean; lessons: { id: number; title: string }[]
  onSaved: (u: SyllabusUnit) => void; onClose: () => void; onDeleted: () => void
}) {
  const { data: u, error } = useAsync(() => fresh ? Promise.resolve({ number: n, title: '', vocab: [], grammar: [], lesson: null } as SyllabusUnit) : api.unit(syl.id, n), [syl.id, n])
  const [draft, setDraft] = useState<{ title: string; vocab: string; grammar: string; lesson: number | null } | null>(null)
  const action = useAction()
  if (error) return <ErrorNotice error={error} />
  if (!u) return <Skeleton rows={2} />
  const d = draft ?? { title: u.title, vocab: vocabText(u.vocab), grammar: grammarText(u.grammar), lesson: u.lesson }
  const change = (patch: Partial<typeof d>) => setDraft({ ...d, ...patch })
  const ro = syl.bundled
  return <form className="unit-editor" onSubmit={(e) => { e.preventDefault(); action.run(async () => onSaved(await api.saveUnit(syl.id, n, d))) }}>
    <h2>{ro ? `JLPT ${u.title}` : `Unit ${n}`}</h2>
    {!ro && <div className="unit-editor-head">
      <Field style={{ flex: 1 }}><span>Title <span className="meta">(optional)</span></span><Input lang="ja" value={d.title} onChange={(e) => change({ title: e.target.value })} placeholder="はじめまして" /></Field>
      <Field><span>Studied in</span>
        <Select value={d.lesson ?? ''} onChange={(e) => change({ lesson: e.target.value ? Number(e.target.value) : null })}>
          <option value="">No lesson</option>
          {lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </Select>
      </Field>
    </div>}
    <Field><span>Words <span className="meta">one per line: word, reading, — meaning (会社員 かいしゃいん — office worker)</span></span>
      <Textarea lang="ja" rows={ro ? 12 : 10} readOnly={ro} value={d.vocab} onChange={(e) => change({ vocab: e.target.value })} placeholder={'わたし — I\n会社員 かいしゃいん — office worker\n先生（せんせい） — teacher'} />
    </Field>
    <p className="meta">A word written in kana here is expected in kana in the story, as early textbooks write it.</p>
    <Field><span>Grammar <span className="meta">one pattern per line, — what it does</span></span>
      <Textarea lang="ja" rows={ro ? 8 : 5} readOnly={ro} value={d.grammar} onChange={(e) => change({ grammar: e.target.value })} placeholder={'〜は〜です — X is Y\n〜じゃありません — is not\n〜か — question'} />
    </Field>
    {ro && !u.grammar.length && <Notice as="p">No grammar list for this level: the writer keeps to what the level covers, from its own knowledge.</Notice>}
    {action.error != null && <ErrorNotice error={action.error} />}
    <ButtonRow>
      {!ro && <Button variant="primary" disabled={action.busy}>Save unit</Button>}
      <Button type="button" variant="ghost" onClick={onClose}>{ro ? 'Close' : 'Cancel'}</Button>
      <span className="grow" />
      {!ro && !fresh && <Button type="button" variant="ghost" onClick={() => {
        if (window.confirm(`Delete unit ${n}?`)) action.run(async () => { await api.deleteUnit(syl.id, n); onDeleted() })
      }}><Trash2 aria-hidden="true" />Delete unit</Button>}
    </ButtonRow>
  </form>
}

