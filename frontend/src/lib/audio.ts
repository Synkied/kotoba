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

/** The synthetic voice through jp-shadow-cut; falls back to the browser's Japanese voice.
 *  With a saved sentence's id the voice reads its kanji as its furigana show. */
export async function speak(text: string, voice: string | null, speed = 1, signal?: AbortSignal, sentence?: number): Promise<void> {
  stopAudio()
  if (voice?.startsWith('kokoro:')) {
    await readyKokoro(signal)
    if (signal?.aborted) return
  }
  if (voice && voice !== 'browser') {
    const r = await fetch('/api/engine/tts?' + new URLSearchParams({ text, voice, speed: String(speed), ...(sentence ? { sentence: String(sentence) } : {}) }), { signal })
    if (r.ok) {
      const blob = await r.blob()
      if (signal?.aborted) return
      const url = URL.createObjectURL(blob)
      const el = (player = new Audio(url))
      stopAt = null
      return new Promise((resolve) => { el.onended = el.onpause = () => { URL.revokeObjectURL(url); resolve() }; el.play().catch(() => resolve()) })
    }
  }
  if (signal?.aborted) return
  if (!('speechSynthesis' in window)) throw new Error('No voice available: start jp-shadow-cut for VOICEVOX or Kokoro voices.')
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'; u.rate = speed
    u.voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ja')) ?? null
    u.onend = u.onerror = () => resolve()
    speechSynthesis.speak(u)
  })
}

export function stopAudio() {
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
