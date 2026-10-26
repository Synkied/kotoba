import { KeyRound, LogOut, RotateCw, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Account } from '../lib/api'
import { ErrorNotice, PageHome, useAction, useToast } from '../components/ui'
import { CopyButton } from './Library'
import { Button, ButtonRow, Chip, Field, Input, Notice, Sheet } from '../components/ds'

/** Signed in, the page starts afresh: nothing from a session before (another account's) stays in memory. */
const restart = () => window.location.replace(window.location.href)

/** The way in: a username and a password, and a new account when this kotoba lets anyone make one. */
export function SignInPage({ signup }: { signup: boolean }) {
  const [making, setMaking] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'kotoba · Sign in' }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      await (making ? api.signup(username, password) : api.signin(username, password))
      restart()
    } catch (x) { setError((x as Error).message); setBusy(false) }
  }

  return (
    <main className="signin">
      <p className="brand" aria-label="kotoba"><span lang="ja" aria-hidden="true">言葉</span><small aria-hidden="true">KOTOBA</small></p>
      <Sheet as="form" onSubmit={submit} aria-labelledby="signin-head">
        <h1 id="signin-head">{making ? 'Make an account' : 'Sign in'}</h1>
        <Field><span>Username</span>
          <Input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus
            value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field><span>Password</span>
          <Input name="password" type="password" autoComplete={making ? 'new-password' : 'current-password'} required
            minLength={making ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <Notice tone="error" role="alert">{error}</Notice>}
        <div><Button variant="primary" disabled={busy || !username.trim() || !password} aria-busy={busy}>
          {busy ? (making ? 'Making it…' : 'Signing in…') : (making ? 'Make the account' : 'Sign in')}</Button></div>
        {signup ? (
          <p>{making ? 'Have an account? ' : 'New here? '}
            <button type="button" className="link" onClick={() => { setMaking(!making); setError(null) }}>{making ? 'Sign in' : 'Make an account'}</button></p>
        ) : <p>Accounts are made by whoever runs this kotoba.</p>}
      </Sheet>
    </main>
  )
}

/** Who is signed in: the password, the key screen-ocr and scripts sign in with, and signing out. */
export default function AccountPage({ account }: { account: Account }) {
  return (
    <>
      <header className="page-head"><h1><PageHome to="/account">Account</PageHome></h1></header>
      <div className="account">
        <Sheet>
          <h2><UserRound aria-hidden="true" />{account.username}{account.staff && <Chip>staff</Chip>}</h2>
          <p>Your sources, sentences, decks, lessons, notes and translators are yours alone: nobody else signed in to this kotoba sees them.</p>
          <div><Button onClick={() => api.signout().finally(() => window.location.assign('/'))}><LogOut aria-hidden="true" />Sign out</Button></div>
        </Sheet>
        <PasswordForm />
        <CaptureKey />
      </div>
    </>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const action = useAction()
  const toast = useToast()
  const differs = again !== '' && again !== next
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (differs) return
    action.run(async () => {
      await api.changePassword(current, next)
      setCurrent(''); setNext(''); setAgain('')
      toast({ text: 'Password changed. Other devices sign in again.' })
    })
  }
  return (
    <Sheet as="form" onSubmit={submit}>
      <h2>Password</h2>
      <Field><span>Current password</span>
        <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field><span>New password</span>
        <Input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field><span>New password again</span>
        <Input type="password" autoComplete="new-password" required value={again} aria-invalid={differs} onChange={(e) => setAgain(e.target.value)} /></Field>
      {differs && <p className="meta failed">The two new passwords differ.</p>}
      {action.error != null && <ErrorNotice error={action.error} />}
      <div><Button variant="primary" disabled={action.busy || !current || !next || differs} aria-busy={action.busy}>Change password</Button></div>
    </Sheet>
  )
}

/** The key that sends captures to your inbox without a browser. */
function CaptureKey() {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const action = useAction()
  useEffect(() => { api.token().then((t) => setToken(t.token), setError) }, [])
  const renew = () => {
    if (window.confirm('Make a new key? Whatever uses the old one (screen-ocr, a script) stops sending captures until it gets the new one.'))
      action.run(async () => setToken((await api.renewToken()).token))
  }
  return (
    <Sheet id="key">
      <h2><KeyRound aria-hidden="true" />Capture key</h2>
      <p>Screen-ocr and scripts sign in with this key, sent as <code className="inline">Authorization: Token …</code>, so what they send lands in your inbox. Keep it to yourself; make a new one if it got out.</p>
      {error != null ? <ErrorNotice error={error} /> : token && (
        <div className="account-key">
          <code className="code">{token}</code>
          <CopyButton text={token} />
        </div>
      )}
      {token && <p>Start screen-ocr with it: <code className="inline">screen-ocr --server {window.location.origin} --key {token}</code>, or set <code className="inline">SCREEN_OCR_KEY</code>.</p>}
      {action.error != null && <ErrorNotice error={action.error} />}
      <ButtonRow><Button size="small" disabled={action.busy || !token} aria-busy={action.busy} onClick={renew}><RotateCw aria-hidden="true" />Make a new key</Button></ButtonRow>
    </Sheet>
  )
}
