import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useOnPractised, usePractise } from '../lib/practise'
import { KeptTakeRows } from '../components/KeptTakes'
import { SourcesTabs } from '../components/SourcesTabs'
import { ErrorNotice, PageHome, SearchBox, Skeleton, useAsync, usePref } from '../components/ui'
import { Button, ButtonLink, EmptyState } from '../components/ds'

const plural = (n: number) => `${n} take${n === 1 ? '' : 's'}`

/** Every take you kept while practising, newest first, searchable by its sentence. */
export default function TakesPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const setQ = (v: string) => setParams(v ? { q: v } : {}, { replace: true })
  const [furigana] = usePref('furigana', true)
  const [limit, setLimit] = useState(100)
  useEffect(() => setLimit(100), [q])
  const { data, error, loading, reload, set } = useAsync(() => api.takes({ q, limit }), [q, limit])
  const practise = usePractise()
  useOnPractised(reload)
  const items = data?.results ?? []
  // a run over every sentence with a kept take, in the order they're listed
  const ids = [...new Set(items.map((t) => t.sentence.id))]

  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/sources/takes">Kept takes</PageHome> <span className="meta num">{data ? plural(data.count) : ''}</span></h1>
        <span className="grow" />
        {ids.length > 0 && <Button size="small" onClick={() => practise.open({ ids })}><Play aria-hidden="true" />Practise these</Button>}
        <div className="search"><SearchBox value={q} onChange={setQ} placeholder="Find a take by its sentence or reading" /></div>
      </header>
      <SourcesTabs />

      {error ? <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} /> :
        loading && !data ? <Skeleton /> :
        !items.length ? (
          <EmptyState>
            <h2>{q ? 'No kept take matches' : 'No kept takes yet'}</h2>
            <p>{q ? 'Try fewer words, or search by reading: “kyou” finds 今日.' : 'While practising, press Keep (or K) after a take to hear it again later. Kept takes gather here.'}</p>
            {!q && <ButtonLink variant="primary" to="/review">Go to Review</ButtonLink>}
          </EmptyState>
        ) : (
          <KeptTakeRows takes={items} furigana={furigana}
            go={(t) => <ButtonLink variant="ghost" size="small" {...practise.link({ sentence: t.sentence.id })}><Play aria-hidden="true" />Practise</ButtonLink>}
            onDropped={(t) => set((d) => ({ count: d.count - 1, results: d.results.filter((x) => x.id !== t.id) }))} />
        )}
      {data && items.length < data.count && <Button disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more takes'}</Button>}
    </>
  )
}
