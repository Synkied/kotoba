import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Practice sentences sit in a calm speech balloon: a square hairline frame with a straight
 *  wedge tail. Its outline is its state.
 *  round  = the model line / a sentence at rest (the name predates the square frame)
 *  burst  = you are speaking (recording): the edges crackle, burgundy while live
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

/** The frame: the box itself, square-cornered, with the tail cut out of its left edge. */
function outline(w: number, h: number, shape: BalloonShape, tail: 'left' | 'none'): string {
  let poly: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]]
  if (tail === 'left') {
    // a straight wedge out of the left edge, low down, its point down and to the left
    const lo = Math.max(h * 0.5, h - 34), hi = Math.max(lo - 16, h * 0.3)
    poly = [...poly, [0, lo], [-18, Math.min(h + 8, lo + 12)], [0, hi]]
  }
  if (shape === 'burst') {
    // the same frame, its edges broken into a fine, even crackle: you are on the air
    const z: Pt[] = []
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy)
      const n = Math.max(1, Math.round(len / 9))
      z.push(p)
      if (n < 2) return
      for (let k = 1; k < n; k++) {
        const o = k % 2 ? 3.5 : 0
        z.push([p[0] + (dx * k) / n + (dy / len) * o, p[1] + (dy * k) / n - (dx / len) * o])
      }
    })
    poly = z
  }
  return 'M' + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z'
}

export function Balloon({ shape = 'round', tail = 'left', big, dim, live, className = '', children, lang = 'ja' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
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
  const cls = ['balloon', shape, tail === 'left' && 'has-tail', big && 'big', dim && 'dim quiet', live && 'live', className].filter(Boolean).join(' ')
  return (
    <div ref={ref} className={cls} lang={lang}>
      {box[0] > 0 && (
        <svg className="outline" width={box[0]} height={box[1]} aria-hidden="true">
          <path d={outline(box[0], box[1], shape, tail)} />
        </svg>
      )}
      {children}
    </div>
  )
}
