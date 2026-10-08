import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Cloud, HardDrive, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, type Addons, type TranslationStatus, type Translator, type TranslatorCheck, type TranslatorDraft, type TranslatorKind } from '../lib/api'
import { setLanguage } from '../components/ReadingAids'
import { ErrorNotice, Skeleton, dayLabel, clock, useAction } from '../components/ui'
import { CopyButton } from './Library'

type Dot = 'ok' | 'warn' | 'off'

/** What this kotoba can do on this machine: each optional piece, whether it's there,
 *  and the one command that adds it. */
export default function AddonsPage() {
  const [a, setA] = useState<Addons | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const poll = () => api.addons().then((x) => { if (live) { setA(x); setError(null) } }, (e) => live && setError(e))
    poll()
    const t = window.setInterval(poll, 4000)
    return () => { live = false; window.clearInterval(t) }
  }, [])
  if (error && !a) return <ErrorNotice error={error} />
  if (!a) return <Skeleton rows={3} />

  const w = a.whisper
  const whisper: [Dot, string] = !a.ffmpeg ? ['off', 'ffmpeg is missing'] :
    w.state === 'missing' ? ['off', 'Not installed'] :
      w.state === 'ready' ? ['ok', `Loaded: ${w.key.join(' · ')}`] :
        w.state === 'loading' ? ['warn', 'Loading the model…'] :
          w.state === 'error' ? ['off', `Failed to load: ${w.error}`] : ['warn', `Installed; loads on first use (${w.key.join(' · ')})`]
  const v = a.voices
  const voice: [Dot, string] = v.kokoro === 'loading' ? ['warn', 'Loading Kokoro…'] : v.count ? ['ok', `${v.count} voices${v.voicevox ? ', VOICEVOX connected' : ''}`] :
    v.kokoro === 'error' ? ['off', v.kokoro_error ?? 'Kokoro failed'] : ['off', 'Only the browser\'s voices']
  const last = a.screen_ocr.last_capture
  const ocr: [Dot, string] = last ? ['ok', `Last capture ${dayLabel(last).rel || dayLabel(last).date}, ${clock(last)}`] : ['off', 'No captures yet']
  const q = a.queue

  return (
    <>
      <header className="page-head"><h1>Add-ons</h1></header>
      {error != null && <ErrorNotice error={error} />}
      <section className="sheet addons">
        <p>kotoba keeps and organises your sentences on its own. These pieces add listening and speaking. Each one is optional, and the hub works without them.</p>

        <Addon dot={whisper} name="Speaking scores and transcription" by="Whisper">
          <p className="meta">Scores what you say in practice, transcribes uploaded audio and video into timed sentences, and finds the cuts in your recordings. Works on a CPU; a GPU makes it much faster.</p>
          {w.state === 'missing' || !a.ffmpeg ? (
            <Install cmds={[...(!a.ffmpeg ? ['# ffmpeg, from your package manager, e.g.', 'sudo apt install ffmpeg'] : []),
              ...(w.state === 'missing' ? ['make install EXTRAS=whisper    # or: uv sync --extra whisper'] : [])]} />
          ) : (w.state === 'idle' || w.state === 'error') && (
            <div><button className="btn small" disabled={busy} onClick={async () => { setBusy(true); try { await api.engineLoad() } catch (err) { setError(err) } finally { setBusy(false) } }}>Load Whisper now</button></div>
          )}
          {(q.waiting > 0 || q.failed > 0 || q.jobs.length > 0) && (
            <p className="meta">
              {q.jobs.filter((j) => j.state === 'running').map((j) => <span key={j.id}>Working on <b>{j.title}</b>{j.progress != null && ` (${Math.round(j.progress * 100)}%)`}. </span>)}
              {q.waiting > 0 && <>{q.waiting} upload{q.waiting > 1 ? 's' : ''} waiting to be transcribed. </>}
              {q.failed > 0 && <><Link to="/inbox">{q.failed} failed</Link>; open them in the inbox to see why.</>}
            </p>
          )}
        </Addon>

        <Addon dot={voice} name="Voices" by="Kokoro · VOICEVOX">
          <p className="meta">Reads sentences aloud when there's no native audio. Kokoro runs inside kotoba; VOICEVOX (or AivisSpeech) is a separate app with many more voices, found at <code className="inline">{v.voicevox_url}</code>.</p>
          {v.kokoro === 'missing' && <Install cmds={['make install EXTRAS=voice    # Kokoro, then: uv run python -m unidic download']} />}
        </Addon>

        <TranslationAddon />

        <Addon dot={ocr} name="Screen captures" by="screen-ocr">
          <p className="meta">Press a hotkey and drag over text on screen: the text and its screenshot land in the inbox, queued offline when kotoba isn't reachable. It runs on the computer you read on.</p>
          <Install cmds={['make ocr-client', `screen-ocr --server ${window.location.origin}`]} />
        </Addon>
      </section>
    </>
  )
}

function Addon({ dot, name, by, children }: { dot: [Dot, string]; name: string; by: string; children: React.ReactNode }) {
  return (
    <div className="addon">
      <span className={'dot ' + dot[0]} aria-hidden="true" />
      <h2>{name} <span className="meta" style={{ fontWeight: 400 }}>{by}</span></h2>
      <span className="meta addon-state">{dot[1]}</span>
      <div className="addon-body">{children}</div>
    </div>
  )
}

/** Asked for once, not polled: the status check talks to the LLM server. */
function TranslationAddon() {
  const [t, setT] = useState<TranslationStatus | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Translator | 'new' | null>(null)
  const load = (p: Promise<unknown>) => {
    setBusy(true); setError(null)
    p.then(() => api.translation()).then((x) => { setT(x); setLanguage({ to: x.to, name: x.name, translator: x.translators.find((y) => y.id === x.active)?.name, cloud: x.cloud }) }, setError).finally(() => setBusy(false))
  }
  useEffect(() => load(Promise.resolve()), [])
  if (!t) return error ? <ErrorNotice error={error} /> : null
  const active = t.translators.find((x) => x.id === t.active)!
  const dot: [Dot, string] = t.ready ? ['ok', `${t.model} · ${active.name}`] : ['off', `${active.name} isn’t answering`]
  const remove = (x: Translator) => {
    if (window.confirm(`Remove the translator “${x.name}”?${x.key_set ? ' Its API key is deleted too.' : ''}`)) load(api.removeTranslator(x.id))
  }
  return (
    <Addon dot={dot} name="Translations" by="a local LLM, or an API">
      <p className="meta">Translates each sentence with the lines around it as context. A model on your own machine keeps sentences private; Ollama and llama.cpp both work.</p>
      <div className="btn-row">
        <label className="btn-row"><span>Translate into</span>
          <select className="select" style={{ width: 'auto' }} value={t.to} disabled={busy} onChange={(e) => load(api.setLanguage(e.target.value))}>
            {t.languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </label>
        <span className="meta num">{t.translated} of {t.sentences} sentences translated</span>
      </div>

      <fieldset className="translators" disabled={busy}>
        <legend>Translator <span className="meta">one at a time</span></legend>
        {t.translators.map((x) => editing !== 'new' && editing?.id === x.id ? (
          <TranslatorForm key={x.id} initial={x} defaults={t.defaults} onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(Promise.resolve()) }} />
        ) : (
          <div className="translator" key={x.id}>
            <label>
              <input type="radio" name="translator" checked={x.id === t.active} onChange={() => load(api.chooseTranslator(x.id))} />
              <span className="what">
                <b>{x.name}</b>
                <span className="meta">{describe(x)}</span>
                {x.id === t.active && (t.ready
                  ? <span className="meta">{t.cloud ? <><b>Sentences leave this machine:</b> they go to {where(x)}.</> : 'Answering. Sentences stay on your machines.'}</span>
                  : <span className="meta failed">{t.error}</span>)}
              </span>
            </label>
            {x.builtin ? <span className="meta hint">Set in <code className="inline">.env</code></span> : (
              <span className="btn-row">
                <button type="button" className="btn small ghost" onClick={() => setEditing(x)}><Pencil aria-hidden="true" />Edit</button>
                <button type="button" className="btn small ghost icon" aria-label={`Remove ${x.name}`} title="Remove" onClick={() => remove(x)}><Trash2 aria-hidden="true" /></button>
              </span>
            )}
          </div>
        ))}
        {editing === 'new' ? (
          <TranslatorForm defaults={t.defaults} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(Promise.resolve()) }} />
        ) : (
          <div className="btn-row">
            <button type="button" className="btn small" onClick={() => setEditing('new')}><Plus aria-hidden="true" />Add a translator</button>
            {!t.ready && <button type="button" className="btn small ghost" onClick={() => load(Promise.resolve())}>Check again</button>}
          </div>
        )}
      </fieldset>
      {error != null && <ErrorNotice error={error} />}
      {t.ready && t.translated < t.sentences && <Install cmds={['# sentences are translated when you ask; to do all of them now:', 'make translate']} />}
    </Addon>
  )
}

const KINDS: { kind: TranslatorKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'ollama', label: 'Ollama', icon: <HardDrive aria-hidden="true" /> },
  { kind: 'llamacpp', label: 'llama.cpp', icon: <HardDrive aria-hidden="true" /> },
  { kind: 'anthropic', label: 'Claude', icon: <Cloud aria-hidden="true" /> },
  { kind: 'openai', label: 'Other API', icon: <Cloud aria-hidden="true" /> },
]
const KIND_NAME: Record<TranslatorKind, string> = { ollama: 'Ollama', llamacpp: 'llama.cpp', anthropic: 'Claude', openai: 'OpenAI-compatible API' }
const host = (url: string) => { try { return new URL(url).host } catch { return url } }
const where = (x: Translator) => x.kind === 'anthropic' ? 'Anthropic (Claude)' : host(x.url)
const describe = (x: Translator) => [x.builtin ? KIND_NAME[x.kind] : null, x.kind === 'anthropic' ? null : host(x.url),
  x.model || (x.kind === 'anthropic' ? 'claude-opus-5-5' : 'first model listed'), x.key_set ? `key ${x.key_hint}` : null].filter(Boolean).join(' · ')

/** One translator's settings. The fields follow the kind: a local server needs an address,
 *  Claude a key, any other API all three. */
function TranslatorForm({ initial, defaults, onSaved, onCancel }: {
  initial?: Translator; defaults: Record<TranslatorKind, string>; onSaved: () => void; onCancel: () => void
}) {
  const [d, setD] = useState<TranslatorDraft>(() => initial
    ? { id: initial.id, kind: initial.kind, name: initial.name, url: initial.url === 'anthropic' ? '' : initial.url, model: initial.model, key: '' }
    : { kind: 'ollama', name: '', url: defaults.ollama, model: '', key: '' })
  const [check, setCheck] = useState<TranslatorCheck | null>(null)
  const [testing, setTesting] = useState(false)
  const action = useAction()
  const set = (patch: Partial<TranslatorDraft>) => { setD((x) => ({ ...x, ...patch })); setCheck(null) }
  const pick = (kind: TranslatorKind) => {
    const wasDefault = !d.url || Object.values(defaults).includes(d.url)
    set({ kind, url: wasDefault ? (kind === 'anthropic' ? '' : defaults[kind]) : d.url })
  }
  const keyKept = !!initial?.key_set && initial.kind === d.kind && (d.kind === 'anthropic' || initial.url === d.url)
  const local = d.kind === 'ollama' || d.kind === 'llamacpp'
  const id = initial?.id ?? 'new'
  const test = async () => {
    setTesting(true)
    try { setCheck(await api.testTranslator(d)) } catch (e) { setCheck({ url: d.url, model: d.model, cloud: false, ready: false, error: (e as Error).message, models: [] }) }
    finally { setTesting(false) }
  }
  const save = (use: boolean) => action.run(async () => {
    await (initial ? api.updateTranslator(initial.id, d, use) : api.addTranslator(d, use))
    onSaved()
  })

  return (
    <form className="translator-form" onSubmit={(e) => { e.preventDefault(); save(true) }} aria-label={initial ? `Edit ${initial.name}` : 'Add a translator'}>
      <div className="seg" role="radiogroup" aria-label="Kind of translator">
        {KINDS.map((k) => (
          <label key={k.kind}><input type="radio" name={`kind-${id}`} checked={d.kind === k.kind} onChange={() => pick(k.kind)} /><span>{k.icon}{k.label}</span></label>
        ))}
      </div>
      <p className="meta">{{
        ollama: <>Runs models on your own machine (ollama.com). Pull one first: <code className="inline">ollama pull qwen2.5:7b</code>.</>,
        llamacpp: <>Serves one GGUF model: <code className="inline">llama-server -m model.gguf --port 8080</code>.</>,
        anthropic: <>Claude, through Anthropic’s API. Needs the claude extra: <code className="inline">make install EXTRAS="whisper voice claude"</code> (the Docker image has it).</>,
        openai: <>Any server that speaks OpenAI’s API: OpenAI, OpenRouter, LM Studio, vLLM, a llama-swap…</>,
      }[d.kind]}</p>

      <div className="form-grid">
        {d.kind !== 'anthropic' && (
          <label className="field wide"><span>Address</span>
            <input className="input" type="url" required inputMode="url" spellCheck={false} value={d.url}
              placeholder={d.kind === 'openai' ? 'https://api.openai.com/v1' : defaults[d.kind]} onChange={(e) => set({ url: e.target.value.trim() })} />
          </label>
        )}
        {!local && (
          <label className="field wide"><span>API key{d.kind === 'openai' && <span className="meta"> if it asks for one</span>}</span>
            <input className="input" type="password" autoComplete="off" spellCheck={false} value={d.key}
              required={d.kind === 'anthropic' && !keyKept}
              placeholder={keyKept ? `Saved (${initial!.key_hint}). Leave empty to keep it` : d.kind === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              onChange={(e) => set({ key: e.target.value.trim() })} />
          </label>
        )}
        <label className="field"><span>Model{local && <span className="meta"> optional</span>}</span>
          <input className="input" list={`models-${id}`} spellCheck={false} value={d.model} required={d.kind === 'openai'}
            placeholder={d.kind === 'anthropic' ? 'claude-opus-5-5' : local ? 'The first one it lists' : 'e.g. gpt-5-mini'}
            onChange={(e) => set({ model: e.target.value })} />
          <datalist id={`models-${id}`}>{check?.models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="field"><span>Name <span className="meta">optional</span></span>
          <input className="input" value={d.name} placeholder={KIND_NAME[d.kind]} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>

      {!local && <p className="meta"><b>Sentences leave this machine</b> when this translator is in use. The key is kept in kotoba’s data folder on this machine and is never shown again.</p>}
      {check && (
        <p className={'meta test-result ' + (check.ready ? 'ok' : 'failed')} role="status">
          {check.ready ? <><Check aria-hidden="true" />It answers{check.models.length ? `, with ${check.models.length} model${check.models.length > 1 ? 's' : ''}: pick one in Model` : ''}.</> : check.error}
        </p>
      )}
      {action.error != null && <ErrorNotice error={action.error} />}
      <div className="btn-row">
        <button className="btn small primary" aria-busy={action.busy} disabled={action.busy}>Save and use</button>
        <button type="button" className="btn small" disabled={action.busy} onClick={() => save(false)}>Save</button>
        <button type="button" className="btn small ghost" aria-busy={testing} disabled={testing || action.busy} onClick={test}>{testing ? 'Testing…' : 'Test'}</button>
        <span className="grow" />
        <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function Install({ cmds }: { cmds: string[] }) {
  const text = cmds.join('\n')
  return (
    <div className="install">
      <code className="code">{text}</code>
      <CopyButton text={cmds.filter((c) => !c.startsWith('#')).map((c) => c.replace(/\s+#.*$/, '')).join('\n')} />
    </div>
  )
}
