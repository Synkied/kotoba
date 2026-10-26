# kotoba (言葉)

A hub for your Japanese: collect screen captures, audio, video, subtitles and text, triage them into sentences, practise them by shadowing native audio, and clean up your own recordings. Scores feed spaced review.

- **backend/**: Django + DRF + SQLite. Data goes in `~/.local/share/kotoba` (or set `KOTOBA_DATA`).
  - `library/`: sources, sentences, decks, practice and review.
  - `speech/`: the speech engine, merged in from jp-shadow-cut. Whisper scores speaking and transcribes uploads, Kokoro and VOICEVOX read sentences aloud, and the recording editor cuts retakes, fillers, repeats and pauses.
- **frontend/**: React + TypeScript (Vite). The design system is described in `DESIGN.md`.
- **screen-ocr** is the one separate piece: a small desktop client that captures text on screen and pushes it to the inbox.

## Run

With Docker, nothing else to install:

```bash
make up                 # http://localhost:8780; data and downloaded models stay in the kotoba-data volume
make up GPU=1           # Whisper on an NVIDIA GPU (needs the NVIDIA Container Toolkit)
make up VOICEVOX=1      # also start the VOICEVOX engine, for more voices
make logs               # make down to stop
```

Without Docker (needs uv, npm, ffmpeg and a C compiler for the voice):

```bash
make install            # everything; EXTRAS=whisper for no voice, EXTRAS= for the plain hub, GPU=1 for CUDA
make run                # builds the frontend, migrates, serves http://127.0.0.1:8780
make dev                # hot reload: open http://localhost:5173
```

`make` lists every target. The Add-ons page shows what is installed and what's missing.

### Accounts

Everyone signs in, and each account has its own library: sources, sentences, decks, words, lessons, notes, translators and the YouTube channels it follows. Make the first account, then sign in at kotoba's address:

```bash
make adduser NAME=you STAFF=1        # make docker-adduser NAME=you STAFF=1 under Docker
```

`KOTOBA_SIGNUP=1` in `.env` lets anyone who reaches kotoba make an account from the sign-in page; otherwise accounts are made with `make adduser`. Staff accounts (`STAFF=1`) may use the translator set in `.env`, which spends the server's own credits; other accounts add their own on the Add-ons page. On a server, put kotoba behind an HTTPS proxy and set `KOTOBA_HTTPS=1`.

**Upgrading from before accounts**: your library is still there, belonging to nobody until you claim it, once:

```bash
make adduser NAME=you STAFF=1
make claim-data NAME=you             # make docker-claim-data NAME=you under Docker
```

That gives that account every source, deck, word, lesson and note from before, the translators and settings from the old `settings.json`, and the YouTube channels you followed.

Screen-ocr and scripts sign in with the account's capture key (Account page), sent as `Authorization: Token <key>`. Commands that work on a library (`make import-ocr`, `make import-jpcut`, `make translate`) take `NAME=you` when there's more than one account.

**Settings** go in a `.env` file at the top of the repository: `cp .env.example .env`, uncomment what you need, then `make up` again (or restart `make run`). Docker and local runs both read it, and it stays out of git and out of the image. Every variable below can go there.

Whisper picks its model by itself: large-v3 on a GPU, large-v3-turbo (int8) on a CPU. Override it with `KOTOBA_WHISPER_MODEL`, `KOTOBA_WHISPER_DEVICE` and `KOTOBA_WHISPER_COMPUTE`. A VOICEVOX or AivisSpeech engine is found at `KOTOBA_VOICEVOX` (default `http://127.0.0.1:50021`).

### Translations

Sentences can show a translation (turn it on with the language chip under any sentence; pick the language on the Add-ons page). An LLM does the translating, with the neighbouring lines as context. Set one up on the **Add-ons** page: choose Ollama, llama.cpp, Claude or any OpenAI-compatible API, fill in its address, key and model, Test it, and save. Keep as many as you like and pick the one in use. Keys are stored with your account in kotoba's database and are never sent back to the browser.

The variables below describe one more translator, "From the environment", which staff accounts use until they pick another. It is local by default:

- **Ollama** (the default, at `http://127.0.0.1:11434/v1`): `ollama pull qwen2.5:7b`. Under Docker, let Ollama listen beyond localhost (`OLLAMA_HOST=0.0.0.0`); the container reaches it at `host.docker.internal`.
- **llama.cpp**: `llama-server -m model.gguf --port 8080` with `KOTOBA_LLM_URL=http://127.0.0.1:8080/v1`.
- **Any OpenAI-compatible API** (LM Studio, vLLM, OpenRouter, OpenAI): set `KOTOBA_LLM_URL`, `KOTOBA_LLM_MODEL` and `KOTOBA_LLM_KEY`.
- **Claude**: `make install EXTRAS="whisper voice claude"`, then `KOTOBA_LLM_URL=anthropic` and `ANTHROPIC_API_KEY` (or `KOTOBA_LLM_KEY`). The model defaults to `claude-opus-5-5`; set `KOTOBA_LLM_MODEL` for another one.

With an API, sentences leave your machine; the Add-ons page says so. `KOTOBA_LLM_MODEL` can stay empty for a local server: kotoba uses the first model it lists. Nothing is translated until you ask: each sentence has a Translate button once the translation toggle is on, and a source page has Translate all, which first says whether it will use API credits or this computer. `make translate` (or `make translate TO=fr`) does every sentence at once. A translation can be corrected by hand on the sentence's page.

Phone and tablet access: `tailscale serve --bg 8780`, then `KOTOBA_HOSTS=<pi>.<tailnet>.ts.net`. The microphone needs HTTPS, which tailscale serve provides. Sign in on each device; it stays signed in for six months.

### Heard on YouTube

A word's page can play the word as native speakers say it, from YouTube channels you follow: turn it on in **Add-ons** (kotoba fetches yt-dlp into the data folder, plus deno when there's no JavaScript runtime, and keeps yt-dlp up to date itself), then follow a channel (`https://www.youtube.com/@name`) or a playlist. Only human-made Japanese subtitles count, not automatic captions. YouTube hands subtitles only to what passes for a browser, so Docker also runs a small token server for it ([bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider), the `pot` service); for local runs, start it as `.env.example` says. Subtitles are read in the background: a video's details every 7 seconds or so, and its subtitles, when it has human-made ones, a minute after the last, as YouTube refuses more from one address for hours (a channel with 50 subtitled videos takes about an hour; if YouTube still asks for a rest, kotoba pauses and carries on), and channels are looked at again every 12 hours kotoba runs. **Find more** on a word searches YouTube for it once. A video's audio is fetched the first time one of its lines plays and kept 30 days; **Keep** makes a line one of your sentences, in the inbox, with the video's audio. Off, nothing goes to YouTube.

## Bring in what you have

```bash
make import-ocr         # screen_ocr's history.db (make docker-import-ocr for the container)
make import-jpcut       # jp-shadow-cut's recordings, with their transcriptions, scripts and edited cuts
make ocr-client         # install the screen-ocr capture client, then: screen-ocr --server http://localhost:8780 --key <capture key> (from the Account page; or set SCREEN_OCR_KEY)
```

Uploaded audio and video are transcribed in the background. `make transcribe` does the waiting ones now, with progress in the terminal.

Each sentence has a permalink at `/sentences/<id>`, linked from sources, decks,
the library and review. Its page includes audio seeking, a highlighted sentence
span, repeat playback, speed controls, source context, notes and practice history.

**Lessons** (`/lessons`) hold what you study: a worksheet PDF, its recordings, pictures,
your notes, and the library sources you practise from it. Choose **New lesson** and drop
the files in (a PDF dropped in Collect starts a lesson too). A lesson's page shows the
PDF beside your notes, plays the recordings at the speed you pick, and links sources to
practise. Choose **Done** when you're finished: the lesson leaves your current list for
the **Archive**, where it stays searchable with its files. **Pin** the lessons you always
want at hand; pinned ones stay at the top whether they're done or not.

Tap any word in a sentence to look it up: a sheet opens with its meaning, its reading in
kana and romaji (with furigana), its dictionary form when it's conjugated, and a button to
hear it in your chosen voice. Compounds that MeCab cuts apart (図書館 is 図書 + 館) are
joined back into the longest word the dictionary knows. Meanings come from
[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (© EDRDG, CC BY-SA 4.0) via
jmdict-simplified: the first lookup downloads it once (about 12 MB) into the data directory,
or run `make dictionary` beforehand. `KOTOBA_DICT_LANG=fre` (or ger, spa, rus, …) picks
another gloss language; English has by far the most entries.

**Words** (`/words`) links your sentences through the words they share. Every sentence you
keep is cut into the words the dictionary lists (読んでいました is filed under 読む, 図書館 stays
one word), in the background, so collecting never waits for it. Each word's page has its
meanings, every sentence it's in across all your sources (each one playable in its own native
audio), the forms it takes, its kanji (each leads to the other words with it), and how saying it
has gone: a word you missed or slurred twice or more in your latest attempts is flagged as one you
**keep missing**. Mark the words you already know; a word in a sentence you've said well counts as
**practised**. **Next sentences** lists the ones you're a single new word away from, the most
common new word first. A sentence's page lists its words and the sentences elsewhere that share
its rarer ones, a source's page shows how much of its vocabulary you have, and a tapped word links
to its page. Without the dictionary, words are found more roughly and get the dictionary's
spelling once it's in (Get the dictionary on the Words page).

**Search** (the box at the top of the sidebar, Ctrl/⌘ K, or the Search tab on a phone) looks
through everything at once: words by spelling, reading, romaji or English meaning (`library`
finds 図書館), sentences by text, reading or translation, and sources, lessons and decks by name.

**Sources** has five tabs: the sources themselves, **Recordings** (your own takes and any audio
or video, each opening the clean-up editor), every **Sentence** in one list, your **Decks**, and the
transcription **Queue**. The old `/recordings` and `/transcriptions` links still work.

**Stories** (物語, their own section) are short texts written for you with only the words and grammar you've studied, then
read aloud. Pick a syllabus and how far you've got: a JLPT level (N5 to N1; the word lists come
with kotoba, from Jonathan Waller's lists, CC BY), or a course you fill in yourself under
**Syllabi**, unit by unit (Minna no Nihongo lesson 1, 2, …: paste each lesson's words and grammar,
or import a CSV). A story may use every unit up to the one you pick and features that one's new
words. Your translator writes it (or another of your LLMs: **Writes stories** on the Add-ons page;
a capable model matters here), kotoba checks every word against the syllabus and has the writer
fix the lines that stray, once, then marks what still does; a voice (VOICEVOX, else Kokoro)
reads it. A story is a source like any other: furigana, lookups, translations, practice. Link a
unit to the lesson you study it in, and the lesson page offers **Make a story**.

Select any stretch of a sentence (a few words, a clause, the whole line) and an **Explain**
button comes up beside it. It opens the stretch with its reading in kana and romaji, its meanings
when the dictionary lists it, and what your translator (see Translations below) says it means in
that sentence: a translation and a few notes on the words, grammar and nuance. A tapped word has
the same explanation one click away. Explanations are asked for only on a click, and the same
question isn't sent twice while kotoba runs.

Japanese readings use MeCab through fugashi with the bundled UniDic Lite dictionary.
On a platform without fugashi wheels (such as Alpine), install/build MeCab and its
headers before installing Python dependencies. Pykakasi remains a fallback.
Use **Edit readings** on a sentence page to save hiragana corrections;
**Reset to automatic** regenerates them. Changing sentence text clears its
corrections. Database migration regenerates existing automatic readings, and
`cd backend && uv run python manage.py refresh_readings`
(`make docker-refresh-readings` under Docker) can refresh
them later while retaining saved corrections. The Docker container also does this on
start whenever the reading engine has changed.
