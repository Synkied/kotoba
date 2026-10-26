import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BookOpen, Captions, Check, Cloud, Globe, HardDrive, Languages, Mic, Pencil, Plus, RotateCw, ScanText, Square, Trash2, UserRound, Volume2 } from 'lucide-react'
import { api, type HeardChannel, type YouTube, type Addons, type TranslationStatus, type Translator, type TranslatorCheck, type TranslatorDraft, type TranslatorKind } from '../lib/api'
import { speak, stopAudio } from '../lib/audio'
import { setLanguage } from '../components/ReadingAids'
import { ErrorNotice, Skeleton, dayLabel, clock, useAction, usePref, PageHome } from '../components/ui'
import { CopyButton } from './Library'
import { Button, ButtonLink, ButtonRow, Chip, Field, Input, Segmented, Select } from '../components/ds'

/** ok: working · warn: on its way (loading, reading, paused) · off: not set up · fail: set up but failing */
type Dot = 'ok' | 'warn' | 'off' | 'fail'
type State = [Dot, string]
type Id = 'whisper' | 'voices' | 'youtube' | 'dictionary' | 'translations' | 'screen-ocr'

/** The page's index: every add-on by what it's for, in the order the sections run. */
const GROUPS: { name: string; items: { id: Id; name: string }[] }[] = [
  { name: 'Listening and speaking', items: [{ id: 'whisper', name: 'Speaking scores' }, { id: 'voices', name: 'Voices' }, { id: 'youtube', name: 'Heard on YouTube' }] },
  { name: 'Reading', items: [{ id: 'dictionary', name: 'Dictionary' }, { id: 'translations', name: 'Translations' }] },
  { name: 'Collecting', items: [{ id: 'screen-ocr', name: 'Screen captures' }] },
]

/** Each section tells the index how it's doing. */
const Report = createContext<(id: Id, s: State) => void>(() => {})

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** What this kotoba can do on this machine: each optional piece, whether it's there,
 *  where it shows up, what leaves the machine, and the one command that adds it. */
export default function AddonsPage() {
  const [a, setA] = useState<Addons | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [states, setStates] = useState<Partial<Record<Id, State>>>({})
  const [current, setCurrent] = useState<Id | null>(null)
  const loc = useLocation()
  const report = useCallback((id: Id, s: State) => setStates((x) => x[id]?.[0] === s[0] && x[id]?.[1] === s[1] ? x : { ...x, [id]: s }), [])
  useEffect(() => {
    let live = true
    const poll = () => api.addons().then((x) => { if (live) { setA(x); setError(null) } }, (e) => live && setError(e))
    poll()
    const t = window.setInterval(poll, 4000)
    return () => { live = false; window.clearInterval(t) }
  }, [])

  // the section in view is the index's current row
  const shown = Object.keys(states).length
  const loaded = !!a
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.addon[id]')]
    if (!els.length) return
    const io = new IntersectionObserver((es) => {
      const hit = es.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0]
      if (hit) setCurrent(hit.target.id as Id)
    }, { rootMargin: '-15% 0px -70% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [shown, loaded])

  // a link here can name a section (/addons#youtube); go to it once it's on the page
  const landed = useRef('')
  useEffect(() => {
    const id = loc.hash.slice(1)
    if (!id || landed.current === id) return
    const el = document.getElementById(id)
    if (el) { landed.current = id; el.scrollIntoView({ block: 'start' }) }
  }, [loc.hash, shown, loaded])

  if (error && !a) return <ErrorNotice error={error} />
  if (!a) return <Skeleton rows={3} />

  const go = (e: React.MouseEvent, id: Id) => {
    const el = document.getElementById(id)
    if (!el) return
    e.preventDefault()
    el.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
    window.history.replaceState(window.history.state, '', '#' + id)
    landed.current = id
  }
  const count = (d: Dot) => Object.values(states).filter((s) => s[0] === d).length

  const w = a.whisper
  const whisper: State = !a.ffmpeg ? ['off', 'ffmpeg is missing'] :
    w.state === 'missing' ? ['off', 'Not installed'] :
      w.state === 'ready' ? ['ok', `Loaded: ${w.key.join(' · ')}`] :
        w.state === 'loading' ? ['warn', 'Loading the model…'] :
          w.state === 'error' ? ['fail', `Failed to load: ${w.error}`] : ['ok', `Installed; loads on first use (${w.key.join(' · ')})`]
  const v = a.voices
  const voice: State = v.kokoro === 'loading' ? ['warn', 'Loading Kokoro…'] : v.count ? ['ok', `${v.count} voices${v.voicevox ? ', VOICEVOX connected' : ''}`] :
    v.kokoro === 'error' ? ['fail', v.kokoro_error ?? 'Kokoro failed'] : ['off', 'Only the browser\'s voices']
  const d = a.dictionary
  const dict: State = d.state === 'ready' ? ['ok', `JMdict${d.version ? ' ' + d.version : ''}`] : d.state === 'downloading' ? ['warn', 'Downloading…']
    : d.state === 'error' ? ['fail', d.error || 'The download failed'] : ['off', 'Not downloaded']
  const last = a.screen_ocr.last_capture
  const ocr: State = last ? ['ok', `Last capture ${dayLabel(last).rel || dayLabel(last).date}, ${clock(last)}`] : ['off', 'No captures yet']
  const q = a.queue

  return (
    <Report.Provider value={report}>
      <header className="page-head">
        <h1><PageHome to="/addons">Add-ons</PageHome></h1>
        <span className="grow" />
        <dl className="facts" aria-live="polite">
          <div><dt>working</dt><dd className="num">{count('ok')}</dd></div>
          <div><dt>not set up</dt><dd className="num">{count('off')}</dd></div>
          {count('fail') > 0 && <div className="due"><dt>failing</dt><dd className="num">{count('fail')}</dd></div>}
        </dl>
        <ButtonLink variant="ghost" size="small" to="/account"><UserRound aria-hidden="true" />Account</ButtonLink>
      </header>
      {error != null && <ErrorNotice error={error} />}
      <div className="addons">
        <nav className="addons-index" aria-label="Add-ons on this machine">
          {GROUPS.map((g) => (
            <div key={g.name}>
              <p className="addons-index-group">{g.name}</p>
              <ol>
                {g.items.map((i) => {
                  const s = states[i.id]
                  return (
                    <li key={i.id}>
                      <a href={'#' + i.id} data-state={s?.[0]} aria-current={current === i.id ? 'location' : undefined} onClick={(e) => go(e, i.id)}>
                        <span className={'dot ' + (s?.[0] ?? '')} aria-hidden="true" />
                        <span className="name">{i.name}</span>
                        <span className="state" title={s?.[1]}>{s?.[1] ?? '…'}</span>
                      </a>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </nav>

        <div className="addons-list">
          <p className="addons-lead">kotoba keeps and organises your sentences on its own. These pieces add listening and speaking. Each one is optional, and the hub works without them.</p>

          <Group name="Listening and speaking">
            <Addon id="whisper" icon={<Mic />} dot={whisper} name="Speaking scores and transcription" by="Whisper"
              where={['local', <><b>Runs on this machine.</b> Your voice and your audio never leave it.</>]}
              uses={[{ to: '/practice', ja: '練習', en: 'Practice', what: 'scores each take, word by word' },
                { to: '/sources/queue', ja: '素材', en: 'Sources', what: 'turns uploaded audio and video into timed sentences' },
                { to: '/sources/recordings', en: 'Recordings', what: 'finds retakes, fillers and pauses in your own takes' }]}>
              <p>Scores what you say in practice, transcribes uploaded audio and video into timed sentences, and finds the cuts in your recordings. Works on a CPU; a GPU makes it much faster.</p>
              {w.state === 'missing' || !a.ffmpeg ? (
                <Install cmds={[...(!a.ffmpeg ? ['# ffmpeg, from your package manager, e.g.', 'sudo apt install ffmpeg'] : []),
                  ...(w.state === 'missing' ? ['make install EXTRAS=whisper    # or: uv sync --extra whisper'] : [])]} watched />
              ) : (w.state === 'idle' || w.state === 'error') && (
                <div><Button size="small" disabled={busy} aria-busy={busy} onClick={async () => { setBusy(true); try { await api.engineLoad() } catch (err) { setError(err) } finally { setBusy(false) } }}>Load Whisper now</Button></div>
              )}
              {(q.waiting > 0 || q.failed > 0 || q.jobs.length > 0) && (
                <p className="addon-queue">
                  {q.jobs.filter((j) => j.state === 'running').map((j) => <span key={j.id}>Working on <b>{j.title}</b>{j.progress != null && ` (${Math.round(j.progress * 100)}%)`}. </span>)}
                  {q.waiting > 0 && <>{q.waiting} upload{q.waiting > 1 ? 's' : ''} waiting to be transcribed. </>}
                  {q.failed > 0 && <><Link to="/inbox">{q.failed} failed</Link>; open them in the inbox to see why.</>}
                </p>
              )}
            </Addon>

            <Addon id="voices" icon={<Volume2 />} dot={voice} name="Voices" by="Kokoro · VOICEVOX"
              where={['local', <><b>Runs on this machine.</b> VOICEVOX, when you use it, is another app on your own machines.</>]}
              uses={[{ to: '/practice', ja: '練習', en: 'Practice', what: 'the model line when a sentence has no native audio' },
                { to: '/decks', ja: 'デッキ', en: 'Decks', what: 'Listen on each sentence' },
                { to: '/words', ja: '単語', en: 'Words', what: 'Listen to a word and its sentences' }]}>
              <p>Reads sentences aloud when there's no native audio. Kokoro runs inside kotoba; VOICEVOX (or AivisSpeech) is a separate app with many more voices, found at <code className="inline">{v.voicevox_url}</code>.</p>
              {v.kokoro === 'missing' && <Install cmds={['make install EXTRAS=voice    # Kokoro, then: uv run python -m unidic download']} watched />}
              <VoiceTry count={v.count} />
            </Addon>

            <YouTubeAddon />
          </Group>

          <Group name="Reading">
            <Addon id="dictionary" icon={<BookOpen />} dot={dict} name="Dictionary" by="JMdict"
              where={['net', <><b>Downloaded once</b> from GitHub (jmdict-simplified), about 12 MB. After that it works offline, and lookups never leave this machine.</>]}
              uses={[{ to: '/words', ja: '単語', en: 'Words', what: 'each word as the dictionary lists it, with its meanings' },
                { en: 'Any sentence', what: 'tap a word to look it up, conjugated or not' }]}>
              <p>Finds the words in your sentences by their dictionary form (読む for 読んでいました) and gives their readings and meanings. Without it, words are only roughly found and have no meanings.</p>
              {(d.state === 'missing' || d.state === 'error') && <DictionaryGet />}
            </Addon>

            <TranslationAddon />
          </Group>

          <Group name="Collecting">
            <Addon id="screen-ocr" icon={<ScanText />} dot={ocr} name="Screen captures" by="screen-ocr"
              where={['local', <><b>Runs on the computer you read on</b> and sends captures only to this kotoba.</>]}
              uses={[{ to: '/inbox', ja: '受信', en: 'Inbox', what: 'each capture, its text beside its screenshot' }]}>
              <p>Press a hotkey and drag over text on screen: the text and its screenshot land in the inbox, queued offline when kotoba isn't reachable. It runs on the computer you read on.</p>
              <Install where="On the computer you read on, in the kotoba folder" cmds={['make ocr-client', `screen-ocr --server ${window.location.origin}`]} />
              <p>Captures go to your own inbox: they're sent with <Link to="/account#key">your capture key</Link>.</p>
            </Addon>
          </Group>
        </div>
      </div>
    </Report.Provider>
  )
}

function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="addon-group" aria-label={name}>
      <h2 className="addon-group-head">{name}</h2>
      {children}
    </section>
  )
}

type Use = { to?: string; ja?: string; en: string; what: string }

/** One add-on: a tile that's ink once it works, its name and maker, how it's doing,
 *  then what it does, where it shows up in kotoba, and what (if anything) leaves the machine. */
function Addon({ id, icon, dot, name, by, uses, where, children }: {
  id: Id; icon: React.ReactNode; dot: State; name: string; by: string; uses: Use[]; where: ['local' | 'net' | 'cloud', React.ReactNode]; children: React.ReactNode
}) {
  const report = useContext(Report)
  const [look, says] = dot
  useEffect(() => report(id, [look, says]), [report, id, look, says])
  return (
    <section className={'addon ' + dot[0]} id={id} tabIndex={-1} aria-labelledby={id + '-name'}>
      <span className="addon-tile" aria-hidden="true">{icon}</span>
      <div className="addon-title">
        <h3 id={id + '-name'}>{name}</h3>
        <Chip>{by}</Chip>
        <p className="addon-state" role="status"><span className={'dot ' + dot[0]} aria-hidden="true" />{dot[1]}</p>
      </div>
      <div className="addon-body">
        {children}
        <dl className="addon-uses" aria-label={`Where ${name.toLowerCase()} shows up`}>
          {uses.map((u) => (
            <div key={u.en}>
              <dt>{u.to ? <Link to={u.to}>{u.ja && <span lang="ja">{u.ja}</span>}{u.en}</Link> : u.en}</dt>
              <dd>{u.what}</dd>
            </div>
          ))}
        </dl>
        <p className={'addon-where ' + where[0]}>
          {where[0] === 'local' ? <HardDrive aria-hidden="true" /> : where[0] === 'cloud' ? <Cloud aria-hidden="true" /> : <Globe aria-hidden="true" />}
          <span>{where[1]}</span>
        </p>
      </div>
    </section>
  )
}

const SAMPLE = '今日はいい天気ですね。'

/** Pick the voice used when there's no native audio, and hear it. The choice is this device's,
 *  the same one Practice offers. */
function VoiceTry({ count }: { count: number }) {
  const [voice, setVoice] = usePref<string>('voice', 'browser')
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([])
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    let live = true
    api.voices().then((x) => live && setVoices(x.voices), () => {})
    return () => { live = false }
  }, [count])
  useEffect(() => () => stopAudio(), [])
  const play = async () => {
    if (playing) { stopAudio(); setPlaying(false); return }
    setPlaying(true)
    try { await speak(SAMPLE, voice) } catch { /* nothing to play */ } finally { setPlaying(false) }
  }
  return (
    <div className="voice-try">
      <Field><span>Voice on this device</span>
        <Select value={voice} onChange={(e) => { stopAudio(); setPlaying(false); setVoice(e.target.value) }}>
          <option value="browser">Browser voice</option>
          {voices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      </Field>
      <Button type="button" aria-pressed={playing} onClick={play}>
        {playing ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}{playing ? 'Stop' : 'Hear it'}</Button>
      <span className="voice-sample" lang="ja">{SAMPLE}</span>
    </div>
  )
}

function DictionaryGet() {
  const action = useAction()
  return <>
    <div><Button variant="primary" size="small" aria-busy={action.busy} disabled={action.busy} onClick={() => action.run(async () => { await api.fetchDictionary() })}>
      Get the dictionary</Button></div>
    {action.error != null && <ErrorNotice error={action.error} />}
  </>
}

const num = (n: number) => n.toLocaleString()

/** YouTube listening: the channels you follow, read for their human-made Japanese subtitles so a
 *  word page can play the word as native speakers say it. Polled while something is being read. */
function YouTubeAddon() {
  const [y, setY] = useState<YouTube | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [updating, setUpdating] = useState(false)
  const load = (p: Promise<unknown> = Promise.resolve()) => {
    setBusy(true); setError(null)
    return p.then(() => api.youtube()).then(setY, setError).finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [])
  const active = !!y && (y.worker.busy || y.tool.installing || y.channels.some((c) => c.videos.waiting > 0 || !c.checked_at))
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => api.youtube().then(setY, () => {}), 3000)
    return () => window.clearTimeout(t)
  }, [active, y])
  if (!y) return error ? <ErrorNotice error={error} /> : null

  const t = y.tool
  const okVideos = y.channels.reduce((n, c) => n + c.videos.ok, 0) + y.found.videos
  const dot: State = !y.enabled ? ['off', 'Off'] : t.installing ? ['warn', 'Fetching yt-dlp…'] : !t.installed ? ['fail', t.error || 'yt-dlp is missing']
    : y.worker.paused_until ? ['warn', `Paused until ${until(y.worker.paused_until)}: YouTube said kotoba was asking too often`]
    : y.worker.error ? ['fail', y.worker.error] : y.worker.busy ? ['warn', y.worker.doing || 'Reading…']
      : y.lines ? ['ok', `${num(y.lines)} lines from ${num(okVideos)} videos`] : ['warn', 'Follow a channel to begin']
  const follow = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    await load(api.follow(url.trim()).then(() => setUrl('')))
  }
  return (
    <Addon id="youtube" icon={<Captions />} dot={dot} name="Heard on YouTube" by="yt-dlp"
      where={['net', <><b>This asks YouTube</b> for a channel’s videos and their subtitles when you follow it (and twice a day after), for search results when you press Find more on a word, and for a video’s audio when you first play one of its lines. Nothing about your sentences is sent.</>]}
      uses={[{ to: '/words', ja: '単語', en: 'Words', what: 'a word’s page plays the lines it’s in, the easiest to follow first' },
        { to: '/search', en: 'Search', what: 'a Heard on YouTube group under your own sentences' }]}>
      <p>Hear your words said by native speakers. kotoba reads the Japanese subtitles of the YouTube channels you follow (only ones written by people, not automatic captions), and a word’s page plays the lines it’s in, the easiest to follow first. Keep a line and it’s one of your sentences, with its audio.</p>
      {!y.enabled ? (
        <div><Button variant="primary" size="small" disabled={busy} aria-busy={busy} onClick={() => load(api.setYouTube(true))}>Turn on</Button></div>
      ) : <>
        <ul className="heard-channels" aria-label="Channels you follow">
          {y.channels.map((c) => <ChannelRow key={c.id} c={c} worker={y.worker} onChange={() => load()} />)}
          {(y.found.videos > 0) && <li className="heard-channel">
            <span className="heard-channel-name">Found with Find more</span>
            <p className="meta num">{num(y.found.videos)} videos with Japanese subtitles · {num(y.found.lines)} lines</p>
          </li>}
        </ul>
        <form className="heard-follow" onSubmit={follow} aria-label="Follow a channel">
          <Input type="url" inputMode="url" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/@channel, or a playlist" aria-label="Channel or playlist address" disabled={!t.installed} />
          <Button variant="primary" size="small" disabled={busy || !url.trim() || !t.installed} aria-busy={busy}><Plus aria-hidden="true" />Follow</Button>
        </form>
        <div className="heard-tool meta">
          <span className="num">{t.installed ? `yt-dlp ${t.version ?? ''}` : t.installing ? 'Fetching yt-dlp…' : 'yt-dlp isn’t here yet'}{t.js && ` · ${t.js}`}{t.pot && ` · token server ${t.pot}`}</span>
          {t.installed && <Button type="button" variant="ghost" size="small" disabled={updating} aria-busy={updating}
            onClick={async () => { setUpdating(true); try { await load(api.updateYtDlp()) } finally { setUpdating(false) } }}>{updating ? 'Updating…' : 'Update now'}</Button>}
          {t.updated && <span>{t.updated}</span>}
          {t.note && <span>{t.note}</span>}
          <span className="grow" />
          <Button type="button" variant="ghost" size="small" disabled={busy} onClick={() => load(api.setYouTube(false))}>Turn off</Button>
        </div>
        {t.error && <p className="meta failed">{t.error}</p>}
      </>}
      {error != null && <ErrorNotice error={error} />}
    </Addon>
  )
}

const until = (at: number) => clock(new Date(at * 1000).toISOString())

/** One channel followed: how far its subtitles have been read, and what was skipped and why. */
function ChannelRow({ c, worker, onChange }: { c: HeardChannel; worker: YouTube['worker']; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const v = c.videos
  const all = v.ok + v.none + v.members + v.failed + v.waiting
  const skipped = v.none + v.members + v.failed
  const act = (p: Promise<unknown>) => { setBusy(true); p.then(onChange).finally(() => setBusy(false)) }
  const why = [v.none && `${num(v.none)} without human subtitles`, v.members && `${num(v.members)} members-only or private`,
    v.failed && `${num(v.failed)} couldn’t be read`].filter(Boolean).join(' · ')
  return (
    <li className="heard-channel">
      <span className="heard-channel-name"><a href={c.url} target="_blank" rel="noreferrer">{c.title || c.url}</a>
        {c.kind === 'playlist' && <span className="meta">playlist</span>}</span>
      {!c.checked_at ? <p className="meta">{worker.channel === c.id ? 'Reading its video list…'
        : worker.paused_until ? `Its video list is read after the pause, at ${until(worker.paused_until)}`
          : worker.busy && worker.doing ? `Its video list is next · now: ${worker.doing}`
            : 'Its video list is read in a moment'}</p> : <>
        <p className="meta num">
          {num(v.ok)} of {num(all)} videos with Japanese subtitles · {num(c.lines)} lines
          {v.waiting > 0 && <> · <b>{num(v.waiting)} still to read</b>{worker.paused_until ? `, paused until ${until(worker.paused_until)}` : ''}</>}
        </p>
        {all > 0 && <div className="heard-progress" role="img" aria-label={`${num(v.ok + skipped)} of ${num(all)} videos read`}>
          <i className="ok" style={{ width: `${(v.ok / all) * 100}%` }} /><i className="skipped" style={{ width: `${(skipped / all) * 100}%` }} />
        </div>}
        {why && <p className="meta">Skipped: {why}</p>}
      </>}
      {c.error && <p className="meta failed">{c.error}</p>}
      <span className="acts">
        <Button type="button" variant="ghost" size="small" icon disabled={busy} aria-label={`Look for new videos on ${c.title || 'this channel'}`} title="Look for new videos now"
          onClick={() => act(api.refreshChannel(c.id))}><RotateCw aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="small" icon disabled={busy} aria-label={`Stop following ${c.title || c.url}`} title="Stop following"
          onClick={() => { if (window.confirm(`Stop following ${c.title || c.url}? Its lines go too; the ones you kept stay in your sentences.`)) act(api.unfollow(c.id)) }}>
          <Trash2 aria-hidden="true" /></Button>
      </span>
    </li>
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
    p.then(() => api.translation()).then((x) => { setT(x); setLanguage({ to: x.to, name: x.name, translator: x.translators.find((y) => y.id === x.active)?.name ?? null, cloud: x.cloud }) }, setError).finally(() => setBusy(false))
  }
  useEffect(() => load(Promise.resolve()), [])
  if (!t) return error ? <ErrorNotice error={error} /> : null
  const active = t.translators.find((x) => x.id === t.active) ?? null
  // the translator from .env is only a guess at a local server: not answering, it's simply not set up yet
  const dot: State = !active ? ['off', 'Not set up: add a translator'] : t.ready ? ['ok', `${t.model} · ${active.name}`]
    : active.builtin ? ['off', 'Not set up: nothing answers yet'] : ['fail', `${active.name} isn’t answering`]
  const remove = (x: Translator) => {
    if (window.confirm(`Remove the translator “${x.name}”?${x.key_set ? ' Its API key is deleted too.' : ''}`)) load(api.removeTranslator(x.id))
  }
  return (
    <Addon id="translations" icon={<Languages />} dot={dot} name="Translations" by="a local LLM, or an API"
      where={t.cloud && active ? ['cloud', <><b>Sentences leave this machine:</b> they go to {where(active)}, with the lines around them.</>]
        : ['local', <><b>Sentences stay on your machines</b> with a local model. An API translator sends them out, and says so here.</>]}
      uses={[{ to: '/practice', ja: '練習', en: 'Practice', what: 'the translation folds inside the balloon; T opens it' },
        { en: 'Any sentence', what: 'the translation reading aid, and a looked-up word in context' }]}>
      <p>Translates each sentence with the lines around it as context. A model on your own machine keeps sentences private; Ollama and llama.cpp both work.</p>
      <ButtonRow>
        <label className="btn-row"><span>Translate into</span>
          <Select style={{ width: 'auto' }} value={t.to} disabled={busy} onChange={(e) => load(api.setLanguage(e.target.value))}>
            {t.languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </Select>
        </label>
        <span className="meta num">{t.translated} of {t.sentences} sentences translated</span>
      </ButtonRow>

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
                  : <span className={'meta' + (x.builtin ? '' : ' failed')}>{t.error}</span>)}
              </span>
            </label>
            {x.builtin ? <span className="meta hint">Set in <code className="inline">.env</code></span> : (
              <span className="btn-row">
                <Button type="button" variant="ghost" size="small" onClick={() => setEditing(x)}><Pencil aria-hidden="true" />Edit</Button>
                <Button type="button" variant="ghost" size="small" icon aria-label={`Remove ${x.name}`} title="Remove" onClick={() => remove(x)}><Trash2 aria-hidden="true" /></Button>
              </span>
            )}
          </div>
        ))}
        {editing === 'new' ? (
          <TranslatorForm defaults={t.defaults} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(Promise.resolve()) }} />
        ) : (
          <ButtonRow>
            <Button type="button" size="small" onClick={() => setEditing('new')}><Plus aria-hidden="true" />Add a translator</Button>
            {!t.ready && <Button type="button" variant="ghost" size="small" onClick={() => load(Promise.resolve())}>Check again</Button>}
          </ButtonRow>
        )}
      </fieldset>
      {t.translators.length > 0 && <ButtonRow>
        <label className="btn-row"><span>Writes stories</span>
          <Select style={{ width: 'auto' }} value={t.writer ?? ''} disabled={busy} onChange={(e) => load(api.chooseWriter(e.target.value))}>
            <option value="">{active ? `The translator in use (${active.name})` : 'The translator in use'}</option>
            {t.translators.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </label>
        <span className="meta">Stories need a capable model: small local ones break the level they're asked for. <Link to="/stories">Stories</Link></span>
      </ButtonRow>}
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
      <Segmented role="radiogroup" aria-label="Kind of translator" name={`kind-${id}`} value={d.kind}
        options={KINDS.map((k) => ({ value: k.kind, label: <>{k.icon}{k.label}</> }))} onChange={pick} />
      <p className="meta">{{
        ollama: <>Runs models on your own machine (ollama.com). Pull one first: <code className="inline">ollama pull qwen2.5:7b</code>.</>,
        llamacpp: <>Serves one GGUF model: <code className="inline">llama-server -m model.gguf --port 8080</code>.</>,
        anthropic: <>Claude, through Anthropic’s API. Needs the claude extra: <code className="inline">make install EXTRAS="whisper voice claude"</code> (the Docker image has it).</>,
        openai: <>Any server that speaks OpenAI’s API: OpenAI, OpenRouter, LM Studio, vLLM, a llama-swap…</>,
      }[d.kind]}</p>

      <div className="form-grid">
        {d.kind !== 'anthropic' && (
          <Field className="wide"><span>Address</span>
            <Input type="url" required inputMode="url" spellCheck={false} value={d.url}
              placeholder={d.kind === 'openai' ? 'https://api.openai.com/v1' : defaults[d.kind]} onChange={(e) => set({ url: e.target.value.trim() })} />
          </Field>
        )}
        {!local && (
          <Field className="wide"><span>API key{d.kind === 'openai' && <span className="meta"> if it asks for one</span>}</span>
            <Input type="password" autoComplete="off" spellCheck={false} value={d.key}
              required={d.kind === 'anthropic' && !keyKept}
              placeholder={keyKept ? `Saved (${initial!.key_hint}). Leave empty to keep it` : d.kind === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              onChange={(e) => set({ key: e.target.value.trim() })} />
          </Field>
        )}
        <Field><span>Model{local && <span className="meta"> optional</span>}</span>
          <Input list={`models-${id}`} spellCheck={false} value={d.model} required={d.kind === 'openai'}
            placeholder={d.kind === 'anthropic' ? 'claude-opus-5-5' : local ? 'The first one it lists' : 'e.g. gpt-5-mini'}
            onChange={(e) => set({ model: e.target.value })} />
          <datalist id={`models-${id}`}>{check?.models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field><span>Name <span className="meta">optional</span></span>
          <Input value={d.name} placeholder={KIND_NAME[d.kind]} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </Field>
      </div>

      {!local && <p className="meta"><b>Sentences leave this machine</b> when this translator is in use. The key is kept in kotoba’s data folder on this machine and is never shown again.</p>}
      {check && (
        <p className={'meta test-result ' + (check.ready ? 'ok' : 'failed')} role="status">
          {check.ready ? <><Check aria-hidden="true" />It answers{check.models.length ? `, with ${check.models.length} model${check.models.length > 1 ? 's' : ''}: pick one in Model` : ''}.</> : check.error}
        </p>
      )}
      {action.error != null && <ErrorNotice error={action.error} />}
      <ButtonRow>
        <Button variant="primary" size="small" aria-busy={action.busy} disabled={action.busy}>Save and use</Button>
        <Button type="button" size="small" disabled={action.busy} onClick={() => save(false)}>Save</Button>
        <Button type="button" variant="ghost" size="small" aria-busy={testing} disabled={testing || action.busy} onClick={test}>{testing ? 'Testing…' : 'Test'}</Button>
        <span className="grow" />
        <Button type="button" variant="ghost" size="small" onClick={onCancel}>Cancel</Button>
      </ButtonRow>
    </form>
  )
}

/** The commands that add something, to paste into a terminal. Copy leaves the comments out. */
function Install({ cmds, where = 'In a terminal, in the kotoba folder', watched }: { cmds: string[]; where?: string; watched?: boolean }) {
  return (
    <div className="install">
      <div className="install-head">
        <span>{where}</span>
        <CopyButton text={cmds.filter((c) => !c.startsWith('#')).map((c) => c.replace(/\s+#.*$/, '')).join('\n')} />
      </div>
      <pre className="code">{cmds.map((c, k) => {
        const note = c.startsWith('#') ? c : c.match(/\s+#.*$/)?.[0]
        return <span key={k}>{note === c ? null : c.slice(0, note ? -note.length : undefined)}{note && <span className="comment">{note}</span>}{'\n'}</span>
      })}</pre>
      {watched && <p className="install-note">This page checks again every few seconds and changes once it’s in.</p>}
    </div>
  )
}
