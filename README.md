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

**Settings** go in a `.env` file at the top of the repository: `cp .env.example .env`, uncomment what you need, then `make up` again (or restart `make run`). Docker and local runs both read it, and it stays out of git and out of the image. Every variable below can go there.

Whisper picks its model by itself: large-v3 on a GPU, large-v3-turbo (int8) on a CPU. Override it with `KOTOBA_WHISPER_MODEL`, `KOTOBA_WHISPER_DEVICE` and `KOTOBA_WHISPER_COMPUTE`. A VOICEVOX or AivisSpeech engine is found at `KOTOBA_VOICEVOX` (default `http://127.0.0.1:50021`).

### Translations

Sentences can show a translation (turn it on with the language chip under any sentence; pick the language on the Add-ons page). An LLM does the translating, with the neighbouring lines as context. Set one up on the **Add-ons** page: choose Ollama, llama.cpp, Claude or any OpenAI-compatible API, fill in its address, key and model, Test it, and save. Keep as many as you like and pick the one in use. Keys are stored in `settings.json` in the data folder (readable only by you) and are never sent back to the browser.

The variables below describe one more translator, "From the environment", which is used until you pick another. It is local by default:

- **Ollama** (the default, at `http://127.0.0.1:11434/v1`): `ollama pull qwen2.5:7b`. Under Docker, let Ollama listen beyond localhost (`OLLAMA_HOST=0.0.0.0`); the container reaches it at `host.docker.internal`.
- **llama.cpp**: `llama-server -m model.gguf --port 8080` with `KOTOBA_LLM_URL=http://127.0.0.1:8080/v1`.
- **Any OpenAI-compatible API** (LM Studio, vLLM, OpenRouter, OpenAI): set `KOTOBA_LLM_URL`, `KOTOBA_LLM_MODEL` and `KOTOBA_LLM_KEY`.
- **Claude**: `make install EXTRAS="whisper voice claude"`, then `KOTOBA_LLM_URL=anthropic` and `ANTHROPIC_API_KEY` (or `KOTOBA_LLM_KEY`). The model defaults to `claude-opus-5-5`; set `KOTOBA_LLM_MODEL` for another one.

With an API, sentences leave your machine; the Add-ons page says so. `KOTOBA_LLM_MODEL` can stay empty for a local server: kotoba uses the first model it lists. Nothing is translated until you ask: each sentence has a Translate button once the translation toggle is on, and a source page has Translate all, which first says whether it will use API credits or this computer. `make translate` (or `make translate TO=fr`) does every sentence at once. A translation can be corrected by hand on the sentence's page.

Phone and tablet access: `tailscale serve --bg 8780`, then `KOTOBA_HOSTS=<pi>.<tailnet>.ts.net`. The microphone needs HTTPS, which tailscale serve provides.

## Bring in what you have

```bash
make import-ocr         # screen_ocr's history.db (make docker-import-ocr for the container)
make import-jpcut       # jp-shadow-cut's recordings, with their transcriptions, scripts and edited cuts
make ocr-client         # install the screen-ocr capture client, then: screen-ocr --server http://localhost:8780
```

Uploaded audio and video are transcribed in the background. `make transcribe` does the waiting ones now, with progress in the terminal.

Each sentence has a permalink at `/sentences/<id>`, linked from sources, decks,
the library and review. Its page includes audio seeking, a highlighted sentence
span, repeat playback, speed controls, source context, notes and practice history.

Listening worksheets have their own **Listening** section at `/listening`.
Choose **Import package** there, or **Import a quiz package** in Collect. Select
one PDF and its audio files together (or add them in several selections), name
the package, review the recording order, and choose **Create quiz package**.
Dropping a PDF into Collect’s regular uploader also opens the package importer.
Packages stay separate and keep their worksheet and recordings together.

The supplied lesson 18 PDF and four recordings are recognized by their content,
even when renamed, and include the prepared questions. Other worksheets open
with one quiz per recording: use **Add question** to enter prompts, choose written
answers or multiple choice, and select the worksheet page for each quiz. Text
PDFs show extracted page text; scanned PDFs show their page images. The original
PDF remains available. **Edit quiz** can revise questions later; previous attempts
are retained, and changed questions start a new quiz version. These packages use
answer-and-review practice without automatically inferred corrections.

The command-line importer remains available for reviewed lesson manifests.
To import lesson 18 from a local `listening/` folder:

```bash
cd backend
uv run python manage.py migrate
uv run python manage.py import_listening ../listening
```

The importer copies the PDF and audio into Kotoba’s data directory and extracts
the worksheet illustrations. You can listen, adjust playback speed, answer all
four exercises, save answers for review, and retry. Drafts stay in the browser;
submitted attempts stay in the database. The supplied PDF has no answer key, so
these exercises use answer-and-review practice without automatic marking.

For another lesson, pass `--manifest /path/to/lesson.json`; the reviewed manifest
in `backend/library/data/minna18-listening.json` shows the format. Its `page` is
zero-based and `crop` is a normalized rectangle in a scanned page’s single image.
Each question can optionally contain a verified `answer` (a string or a list of
accepted answers) and `explanation`. Re-importing the same slug and exercise
positions updates assets and corrections while preserving attempts. Keep
question IDs stable for saved responses; create a new slug for different material.
The command-line importer does not automatically generate questions, transcripts,
or corrections from arbitrary PDFs. Local lesson files are excluded from Git.

Tap any word in a sentence to look it up: a sheet opens with its meaning, its reading in
kana and romaji (with furigana), its dictionary form when it's conjugated, and a button to
hear it in your chosen voice. Compounds that MeCab cuts apart (図書館 is 図書 + 館) are
joined back into the longest word the dictionary knows. Meanings come from
[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (© EDRDG, CC BY-SA 4.0) via
jmdict-simplified: the first lookup downloads it once (about 12 MB) into the data directory,
or run `make dictionary` beforehand. `KOTOBA_DICT_LANG=fre` (or ger, spa, rus, …) picks
another gloss language; English has by far the most entries.

Japanese readings use MeCab through fugashi with the bundled UniDic Lite dictionary.
On a platform without fugashi wheels (such as Alpine), install/build MeCab and its
headers before installing Python dependencies. Pykakasi remains a fallback.
Use **Edit readings** on a sentence page to save hiragana corrections;
**Reset to automatic** regenerates them. Changing sentence text clears its
corrections. Database migration regenerates existing automatic readings, and
`cd backend && uv run python manage.py refresh_readings` can refresh them later
while retaining saved corrections.
