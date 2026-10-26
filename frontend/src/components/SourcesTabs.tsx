import { NavLink } from 'react-router-dom'
import { useStats } from '../App'

/** The views of Sources: the sources themselves, the recordings you clean up, every sentence,
 *  the stories written for you, and the transcription queue (with how much is in it). */
export function SourcesTabs() {
  const { stats } = useStats()
  const waiting = stats?.waiting ?? 0
  return (
    <nav className="tabs sources-tabs" aria-label="Sources views">
      <NavLink to="/sources" end>Sources</NavLink>
      <NavLink to="/sources/recordings">Recordings</NavLink>
      <NavLink to="/sources/sentences">Sentences</NavLink>
      <NavLink to="/sources/stories">Stories</NavLink>
      <NavLink to="/sources/queue">Queue{waiting > 0 && <span className="n num" aria-label={`${waiting} waiting`}>{waiting}</span>}</NavLink>
    </nav>
  )
}
