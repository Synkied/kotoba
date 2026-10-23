import { ChevronLeft } from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { HeardSection } from '../components/Heard'
import { Entries } from '../components/WordLookup'
import { ErrorNotice, Skeleton, useAsync } from '../components/ui'
import { ButtonLink } from '../components/ds'
import { useBackTo } from '../lib/trail'
import { Say } from './Word'

export default function DictPage() {
  const key = useParams().key ?? ''
  return <Detail key={key} termKey={key} />
}

/** A word by its dictionary entry, before it's one of yours: what it means, and the lines it's
 *  heard in on YouTube. Once your sentences have it, its word page says more. */
function Detail({ termKey }: { termKey: string }) {
  const { data: t, error } = useAsync(() => api.term(termKey), [termKey])
  const backTo = useBackTo(`dict:${termKey}`, (p) => p.startsWith('/sentences/') || p.startsWith('/search'))
  if (error) return <ErrorNotice error={error} action={<ButtonLink size="small" to="/words">All words</ButtonLink>} />
  if (!t) return <Skeleton rows={4} />
  if (t.word) return <Navigate to={`/words/${t.word.id}#heard`} replace />
  return (
    <div className="word-page">
      <header className="page-head">
        <ButtonLink variant="ghost" icon to={backTo ?? '/words'} aria-label="Back"><ChevronLeft aria-hidden="true" /></ButtonLink>
        <h1 className="word-page-title" lang="ja">{t.lemma}</h1>
      </header>
      <div className="word-page-layout">
        <section className="word-page-main" aria-label="Heard on YouTube">
          <p className="word-page-reading">
            {t.reading && <span lang="ja">{t.reading}</span>} {t.romaji && <span className="word-romaji">{t.romaji}</span>}
            {t.reading && <Say text={t.reading} label={`Listen to ${t.lemma}`} />}
          </p>
          <p className="meta">Not in your sentences yet. Keep a line with it and it’s one of your words.</p>
          <HeardSection termKey={t.key} lemma={t.lemma} />
        </section>
        <aside className="word-page-aside">
          <section className="sentence-section"><h2>Meaning</h2>
            {t.entries.length ? <div className="word-page-entries"><Entries entries={t.entries} /></div>
              : <p className="meta">{t.dictionary === 'ready' ? 'Not in the dictionary.' : 'Meanings come with the dictionary.'}</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}
