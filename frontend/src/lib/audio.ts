/** Microphone capture at 16 kHz mono int16 (what jp-shadow-cut's scorer takes),
 *  native clip playback, and the synthetic voice. */

const WORKLET = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true }
}
registerProcessor('tap', Tap)`

/** Require sustained speech before treating a pause as the end of a take. */
export class SpeechEndDetector {
  private voiced = 0
  private silence = 0
  private elapsed = 0
  private heardSpeech = false
  // the room's level: drops to any quieter moment at once and creeps up slowly, so a
  // steady hum, gain the browser turns up, or the model's voice leaking back from the
  // speakers (speak along) stops counting as speech
  private floor = Infinity

  update(rms: number, seconds: number): boolean {
    this.elapsed += seconds
    this.floor = rms < this.floor ? rms : this.floor + (rms - this.floor) * Math.min(1, seconds / 4)
    if (rms >= Math.max(0.015, this.floor * 2)) {
      this.voiced += seconds
      this.silence = 0
      if (this.voiced >= 0.12) this.heardSpeech = true
    } else {
      this.voiced = 0
      this.silence += seconds
    }
    return (this.heardSpeech && this.silence >= 1.5) || this.elapsed >= 60
  }
}

export class Recorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private chunks: Float32Array[] = []
  onLevel: (rms: number) => void = () => {}
  onAutoStop: () => void = () => {}

  async start() {
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.ctx = new AudioContext()
    await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })))
    const node = new AudioWorkletNode(this.ctx, 'tap')
    const ctx = this.ctx
    const detector = new SpeechEndDetector()
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.ctx !== ctx) return
      this.chunks.push(e.data)
      let s = 0
      for (const v of e.data) s += v * v
      const rms = Math.sqrt(s / e.data.length)
      this.onLevel(rms)
      if (detector.update(rms, e.data.length / ctx.sampleRate)) this.onAutoStop()
    }
    this.ctx.createMediaStreamSource(this.stream).connect(node)
  }

  /** Stops and returns the take resampled to 16 kHz int16. */
  stop(): { pcm: Int16Array; seconds: number } {
    const rate = this.ctx?.sampleRate ?? 48000
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close()
    this.ctx = null; this.stream = null
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const all = new Float32Array(total)
    let o = 0
    for (const c of this.chunks) { all.set(c, o); o += c.length }
    const r = rate / 16000, n = Math.floor(total / r), pcm = new Int16Array(n)
    for (let i = 0; i < n; i++) {
      // box filter: average the source samples that fall in this output sample
      const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r))
      let s = 0
      for (let k = a; k < b; k++) s += all[k]
      pcm[i] = Math.max(-32768, Math.min(32767, (s / (b - a)) * 32768))
    }
    return { pcm, seconds: n / 16000 }
  }

  get active() { return this.ctx !== null }
}

let player: HTMLAudioElement | null = null
let stopAt: number | null = null

/** Play [start, end] of a source's media. Resolves when the clip ends or is stopped. */
export function playClip(url: string, start: number, end: number, onTime?: (t: number) => void): Promise<void> {
  stopAudio()
  const el = (player = new Audio(url))
  el.preload = 'auto'
  stopAt = end
  return new Promise((resolve, reject) => {
    const done = () => { el.pause(); el.ontimeupdate = null; resolve() }
    el.onloadedmetadata = () => { el.currentTime = Math.max(0, start - 0.05); el.play().catch(reject) }
    el.ontimeupdate = () => {
      onTime?.(el.currentTime)
      if (stopAt !== null && el.currentTime >= stopAt) done()
    }
    el.onended = done
    el.onpause = () => resolve()
    el.onerror = () => reject(new Error('This audio could not be played.'))
  })
}

/** Play a whole file: a take, kept or just recorded. Resolves when it ends or is stopped. */
export function playUrl(url: string): Promise<void> {
  stopAudio()
  const el = (player = new Audio(url))
  stopAt = null
  return new Promise((resolve, reject) => {
    el.onended = el.onpause = () => resolve()
    el.onerror = () => reject(new Error('This take could not be played.'))
    el.play().catch(reject)
  })
}

/** A take as the recorder hands it over (16 kHz mono int16), wrapped as a WAV to play back. */
export function wav(pcm: Int16Array): Blob {
  const head = new DataView(new ArrayBuffer(44))
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) head.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); head.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVE')
  text(12, 'fmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true)
  head.setUint32(24, 16000, true); head.setUint32(28, 32000, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true)
  text(36, 'data'); head.setUint32(40, pcm.byteLength, true)
  return new Blob([head.buffer, pcm.buffer as ArrayBuffer], { type: 'audio/wav' })
}

let kokoroReady = false
let voiceLoading = false
const voiceListeners = new Set<() => void>()
/** Whether a voice model is being loaded (Kokoro's first use downloads its weights). */
export const voiceLoadingNow = () => voiceLoading
export function onVoiceLoading(cb: () => void) { voiceListeners.add(cb); return () => { voiceListeners.delete(cb) } }
const setVoiceLoading = (on: boolean) => { voiceLoading = on; voiceListeners.forEach((cb) => cb()) }

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const t = window.setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { window.clearTimeout(t); resolve() }, { once: true })
})

/** Load Kokoro before its first sentence, flagging the wait. Any failure is left to the
 *  speech request, which reports it the usual way. */
async function readyKokoro(signal?: AbortSignal) {
  let shown = false
  try {
    while (!kokoroReady && !signal?.aborted) {
      const r = await fetch('/api/engine/tts/load', { method: 'POST', signal })
      if (!r.ok) return
      const st: { kokoro: string } = await r.json()
      if (st.kokoro !== 'loading') { kokoroReady = st.kokoro === 'ready'; return }
      if (!shown) { shown = true; setVoiceLoading(true) }
      await wait(1000, signal)
    }
  } catch { /* aborted or offline: the speech request says why */ } finally { if (shown) setVoiceLoading(false) }
}

/** The voice's take of a line, or null when there's no server voice to read it. */
async function fetchVoice(text: string, voice: string | null, speed: number, signal?: AbortSignal, sentence?: number): Promise<Blob | null> {
  if (!voice || voice === 'browser') return null
  if (voice.startsWith('kokoro:')) {
    await readyKokoro(signal)
    if (signal?.aborted) return null
  }
  const r = await fetch('/api/engine/tts?' + new URLSearchParams({ text, voice, speed: String(speed), ...(sentence ? { sentence: String(sentence) } : {}) }), { signal })
  return r.ok ? r.blob() : null
}

function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob)
  const el = (player = new Audio(url))
  stopAt = null
  return new Promise((resolve) => { el.onended = el.onpause = () => { URL.revokeObjectURL(url); resolve() }; el.play().catch(() => resolve()) })
}

let utterance: SpeechSynthesisUtterance | null = null // held on to: Chrome drops the end event of one it has collected
function browserSay(text: string, lang: string, speed: number): Promise<void> {
  if (!('speechSynthesis' in window)) throw new Error('No voice available: start jp-shadow-cut for VOICEVOX or Kokoro voices.')
  return new Promise((resolve) => {
    const u = (utterance = new SpeechSynthesisUtterance(text))
    u.lang = lang; u.rate = speed
    u.voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2))) ?? null
    u.onend = u.onerror = () => { if (utterance === u) utterance = null; resolve() }
    speechSynthesis.speak(u)
  })
}

/** The synthetic voice through jp-shadow-cut; falls back to the browser's Japanese voice.
 *  With a saved sentence's id the voice reads its kanji as its furigana show. */
export async function speak(text: string, voice: string | null, speed = 1, signal?: AbortSignal, sentence?: number): Promise<void> {
  stopAudio()
  const blob = await fetchVoice(text, voice, speed, signal, sentence)
  if (signal?.aborted) return
  return blob ? playBlob(blob) : browserSay(text, 'ja-JP', speed)
}

const JA_LETTER = '\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}ーｰ'
// digits touching Japanese go with it (300円, 第3); spaces and punctuation with whatever they follow; a line ends it
const JA_RUN = new RegExp(`\\p{N}*[${JA_LETTER}](?:[${JA_LETTER}]|[^\\p{L}\\p{N}\\n]|\\p{N}+(?=[${JA_LETTER}])|(?<=[${JA_LETTER}])\\p{N}+)*`, 'gu')
const SENTENCE_END = /(?<=[。！？!?…\n])|(?<=\.)(?=\s)/
const LONGEST = 280 // the server reads at most 300 characters at a time

function sentences(run: string): string[] {
  const out: string[] = []
  for (let s of run.split(SENTENCE_END)) {
    while (s.length > LONGEST) {
      const pause = Math.max(...['、', '，', ',', ' '].map((c) => s.lastIndexOf(c, LONGEST - 1)))
      const at = pause > 0 ? pause + 1 : LONGEST
      out.push(s.slice(0, at))
      s = s.slice(at)
    }
    out.push(s)
  }
  return out.map((t) => t.trim()).filter((t) => /[\p{L}\p{N}]/u.test(t))
}

/** Text cut up to be read aloud: sentence by sentence, Japanese apart from everything else,
 *  since the Japanese voices can't read the learner's own language. */
export function speechParts(text: string): { text: string; ja: boolean }[] {
  const out: { text: string; ja: boolean }[] = []
  const add = (run: string, ja: boolean) => { for (const t of sentences(run)) out.push({ text: t, ja }) }
  let at = 0
  for (const m of text.matchAll(JA_RUN)) {
    add(text.slice(at, m.index), false)
    add(m[0], true)
    at = m.index + m[0].length
  }
  add(text.slice(at), false)
  return out
}

let reading: AbortController | null = null
/** Whether readAloud is still going. */
export const readingNow = () => reading !== null

/** Read any length of text: its Japanese in the chosen voice, the rest in the browser's voice
 *  for `otherLang`. Resolves when it's finished or stopped; any other audio stops it. */
export async function readAloud(text: string, voice: string | null, otherLang: string, speed = 1): Promise<void> {
  stopAudio()
  const ctl = (reading = new AbortController())
  const { signal } = ctl
  const parts = speechParts(text)
  const take = (i: number) => parts[i]?.ja ? fetchVoice(parts[i].text, voice, speed, signal).catch(() => null) : Promise.resolve(null)
  try {
    let next = take(0)
    for (let i = 0; i < parts.length; i++) {
      const blob = await next
      if (signal.aborted) return
      next = take(i + 1) // asked for now, so the voice doesn't leave a gap between sentences
      await (blob ? playBlob(blob) : browserSay(parts[i].text, parts[i].ja ? 'ja-JP' : otherLang, speed))
      if (signal.aborted) return
    }
  } finally {
    if (reading === ctl) reading = null
  }
}

export function stopAudio() {
  reading?.abort()
  reading = null
  if (player) { player.pause(); player = null }
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}

const decoded = new Map<string, Promise<AudioBuffer>>()
/** Decoded media, cached per URL, for drawing a clip's waveform. */
export function decode(url: string): Promise<AudioBuffer> {
  if (!decoded.has(url)) {
    decoded.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(b)))
  }
  return decoded.get(url)!
}
