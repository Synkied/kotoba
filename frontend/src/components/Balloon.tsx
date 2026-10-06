import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** The signature: every sentence is a speech balloon, cut like manga's electronic-sound
 *  balloon (ruled straight edges, clipped corners, a wedge tail). Its outline is its state.
 *  round  = the model line / a sentence at rest (the name predates the ruled outline)
 *  burst  = you are speaking (recording): the edges crackle
 *  dashed = some words were heard unclearly
 *  The tail points left, at the panel the sentence came from. */
export type BalloonShape = 'round' | 'burst' | 'dashed'

type Props = {
  shape?: BalloonShape
  tail?: 'left' | 'none'
  big?: boolean
  dim?: boolean
  live?: boolean
  className?: string
  children: ReactNode
  lang?: string
}

type Pt = [number, number]

/** A small deterministic generator, so each balloon keeps its shape across renders. */
function rng(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

/** The electronic-sound balloon: a ruled polygon, straight edges and sharp corners,
 *  each corner clipped by a different amount so no two balloons are the same box. */
function outline(w: number, h: number, shape: BalloonShape, tail: 'left' | 'none', seed: string): string {
  const r = rng(seed)
  // each corner pushed outward by its own amount (never inward, so text never clips),
  // which tilts every edge off the square: the ruled, hand-cut look
  const ox = () => 1 + r() * Math.min(11, w * 0.05), oy = () => 1 + r() * Math.min(8, h * 0.14)
  const corners: Pt[] = [[-ox(), -oy()], [w + ox(), -oy()], [w + ox(), h + oy()], [-ox(), h + oy()]]
  // one corner gets a deep cut, one a medium one, the others barely: never an even octagon
  const cap = Math.min(h * 0.42, w * 0.25, h > 90 ? 40 : 28)
  const big = Math.floor(r() * 4), mid = (big + 1 + Math.floor(r() * 3)) % 4
  const pts: Pt[] = []
  corners.forEach((p, i) => {
    const c = i === big ? cap * (0.75 + r() * 0.25) : i === mid ? cap * (0.35 + r() * 0.2) : r() * 4
    if (c < 2) { pts.push(p); return }
    const prev = corners[(i + 3) % 4], next = corners[(i + 1) % 4]
    const toward = (q: Pt): Pt => {
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy)
      return [p[0] + (dx / len) * c, p[1] + (dy / len) * c]
    }
    pts.push(toward(prev), toward(next))
  })

  let poly = pts
  if (tail === 'left') {
    // a straight wedge out of the left edge, its point down and to the left
    // clockwise from the top-left, so the left edge runs from the last point back to the first
    const A = pts[pts.length - 1], B = pts[0]
    const at = (t: number): Pt => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]
    const span = Math.hypot(B[0] - A[0], B[1] - A[1])
    const t0 = Math.min(0.4, 5 / span + 0.12), t1 = Math.min(0.9, t0 + Math.min(20, span * 0.45) / span)
    const lo = at(t0), hi = at(t1)
    const apex: Pt = [Math.min(lo[0], hi[0]) - 20, Math.min(h + 10, lo[1] + 14)]
    poly = [...pts, lo, apex, hi]
  }

  if (shape === 'burst') {
    // the same polygon, its edges broken into a crackle: you are on the air
    const z: Pt[] = []
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy)
      const n = Math.max(1, Math.round(len / 13))
      z.push(p)
      if (n < 2) return
      for (let k = 1; k < n; k++) {
        const o = k % 2 ? 4 + r() * 4 : -1
        z.push([p[0] + (dx * k) / n + (dy / len) * o, p[1] + (dy * k) / n - (dx / len) * o])
      }
    })
    poly = z
  }
  return 'M' + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z'
}

export function Balloon({ shape = 'round', tail = 'left', big, dim, live, className = '', children, lang = 'ja' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const seed = useId()
  const [box, setBox] = useState<[number, number]>([0, 0])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const r = e.borderBoxSize?.[0]
      const w = r ? r.inlineSize : el.offsetWidth, h = r ? r.blockSize : el.offsetHeight
      setBox((prev) => (Math.abs(prev[0] - w) < 0.5 && Math.abs(prev[1] - h) < 0.5 ? prev : [w, h]))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cls = ['balloon', shape, big && 'big', dim && 'dim tone', live && 'live', className].filter(Boolean).join(' ')
  return (
    <div ref={ref} className={cls} lang={lang}>
      {box[0] > 0 && (
        <svg className="outline" width={box[0]} height={box[1]} aria-hidden="true">
          <path d={outline(box[0], box[1], shape, tail, seed)} />
        </svg>
      )}
      {children}
    </div>
  )
}
