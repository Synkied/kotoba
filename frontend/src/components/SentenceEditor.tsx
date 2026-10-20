import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw } from 'lucide-react'
import { api, type Sentence } from '../lib/api'
import { Furigana } from './Furigana'
import { useLanguage } from './ReadingAids'
import { ErrorNotice, useAction, useToast } from './ui'
import { Button, ButtonRow, Field, Input, Kbd, Textarea } from './ds'

type Pairs = [string, string][]
const mac = /Mac|iP(hone|ad)/.test(navigator.platform)

/** A reading is known by its kanji and which of that kanji's appearances it is, so a
 *  correction survives edits to the text around it. */
const keys = (pairs: Pairs) => {
  const seen = new Map<string, number>()
  return pairs.map(([k]) => { const n = seen.get(k) ?? 0; seen.set(k, n + 1); return `${k}#${n}` })
}

/** Fix a sentence in one place: its text, the furigana over its kanji and its translation.
 *  The readings follow the text as you type; the ones you change are kept and marked. */
export function SentenceEditor({ sentence: s, onSaved, onClose }: { sentence: Sentence; onSaved: (s: Sentence) => void; onClose: () => void }) {
  const lang = useLanguage()
  const toast = useToast()
  const action = useAction()
  const [text, setText] = useState(s.text)
  // the readings kotoba gives the text as it stands, and the ones you've set yourself
  const [auto, setAuto] = useState<{ text: string; pairs: Pairs } | null>(s.reading_overrides.length ? null : { text: s.text, pairs: s.furigana })
  const [mine, setMine] = useState<Record<string, string>>(() => Object.fromEntries(keys(s.reading_overrides).map((k, i) => [k, s.reading_overrides[i][1]])))
  const savedMeaning = lang ? s.translations[lang.to] ?? '' : ''
  const [meaning, setMeaning] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState<unknown>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trimmed = text.trim()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current
    el?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { el?.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])

  useEffect(() => {
    if (!trimmed || auto?.text === trimmed) return
    const stop = new AbortController()
    const t = window.setTimeout(() => {
      setLookupError(null)
      api.furigana(trimmed, stop.signal).then((r) => setAuto({ text: trimmed, pairs: r.furigana }),
        (e) => { if (!stop.signal.aborted) setLookupError(e) })
    }, 250)
    return () => { window.clearTimeout(t); stop.abort() }
  }, [trimmed]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !trimmed || auto?.text === trimmed
  const spans = trimmed && auto ? auto.pairs : []
  const spanKeys = keys(spans)
  const readings: Pairs = spans.map(([k, r], i) => [k, mine[spanKeys[i]] ?? r])
  const changedReadings = readings.some(([, r], i) => r !== spans[i][1])
  const textChanged = trimmed !== s.text
  const meaningNow = meaning ?? savedMeaning
  const dirty = textChanged || meaning !== null && meaning !== savedMeaning
    || (ready && JSON.stringify(changedReadings ? readings : []) !== JSON.stringify(s.reading_overrides))

  const close = () => { if (!dirty || action.busy || window.confirm('Discard your changes to this sentence?')) onClose() }
  const save = () => action.run(async () => {
    if (!ready || !trimmed) return
    const data: Parameters<typeof api.updateSentence>[1] = { reading_overrides: changedReadings ? readings : [] }
    if (textChanged) data.text = trimmed
    // a new text makes the other languages' translations stale; the one shown here is yours to keep or clear
    if (lang && (textChanged || meaning !== null)) data.translations = textChanged ? { [lang.to]: meaningNow } : { ...s.translations, [lang.to]: meaningNow }
    onSaved(await api.updateSentence(s.id, data))
    toast({ text: 'Sentence saved' })
    onClose()
  })

  return createPortal(
    <dialog ref={dialog} className="sentence-editor" aria-labelledby="sentence-editor-title"
      onCancel={(e) => { e.preventDefault(); close() }}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.querySelector('form')?.requestSubmit() } }}>
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <h2 id="sentence-editor-title">Edit sentence</h2>

        <p className="sentence-editor-preview sentence-text" lang="ja" aria-label="Preview">
          {trimmed ? <Furigana text={trimmed} pairs={ready ? readings : []} lookup={false} /> : <span className="meta" lang="en">The sentence is empty.</span>}
        </p>

        <Field><span>Text</span>
          <Textarea lang="ja" rows={2} autoFocus value={text} required maxLength={2000} onChange={(e) => setText(e.target.value)} /></Field>

        <fieldset className="sentence-editor-readings">
          <legend>Readings</legend>
          {lookupError != null ? <ErrorNotice error={lookupError} />
            : !ready ? <p className="meta" role="status">Finding the readings…</p>
            : !spans.length ? <p className="meta">No kanji, so no furigana to set.</p>
            : <>
              <div className="reading-fields">{readings.map(([k, r], i) => {
                const own = r !== spans[i][1]
                return <label key={spanKeys[i]} data-own={own || undefined}>
                  <span lang="ja">{k}{own && <span className="sr"> (your reading; automatic is {spans[i][1]})</span>}</span>
                  <Input lang="ja" value={r} required maxLength={100} pattern="[ぁ-ゖー]+" title="Hiragana only"
                    onChange={(e) => setMine({ ...mine, [spanKeys[i]]: e.target.value })} />
                </label>
              })}</div>
              <p className="meta">{changedReadings ? 'The marked readings are yours; the rest are automatic.' : 'Automatic readings. Correct any that are wrong for this sentence.'}</p>
              {changedReadings && <Button type="button" variant="ghost" size="small" onClick={() => setMine({})}><RotateCcw aria-hidden="true" />Reset to automatic</Button>}
            </>}
        </fieldset>

        {lang && <Field><span>{lang.name}</span>
          <Textarea lang={lang.to} rows={2} value={meaningNow} maxLength={2000} onChange={(e) => setMeaning(e.target.value)}
            placeholder={`What it means in ${lang.name}. Leave it empty to translate it later.`} />
          {textChanged && meaning === null && savedMeaning && <small className="meta">This translates the old text. Check it still fits.</small>}
        </Field>}

        {action.error != null && <ErrorNotice error={action.error} />}
        <ButtonRow className="sentence-editor-actions">
          <Button variant="primary" disabled={action.busy || !ready || !trimmed || !dirty} aria-busy={action.busy}>{action.busy ? 'Saving…' : 'Save'} <Kbd>{mac ? '⌘↵' : 'ctrl ↵'}</Kbd></Button>
          <Button type="button" variant="ghost" disabled={action.busy} onClick={close}>Cancel <Kbd>esc</Kbd></Button>
        </ButtonRow>
      </form>
    </dialog>,
    document.body,
  )
}
