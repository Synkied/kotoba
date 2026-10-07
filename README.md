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

Whisper picks its model by itself: large-v3 on a GPU, large-v3-turbo (int8) on a CPU. Override it with `KOTOBA_WHISPER_MODEL`, `KOTOBA_WHISPER_DEVICE` and `KOTOBA_WHISPER_COMPUTE`. A VOICEVOX or AivisSpeech engine is found at `KOTOBA_VOICEVOX` (default `http://127.0.0.1:50021`).

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

Japanese readings use MeCab through fugashi with the bundled UniDic Lite dictionary.
On a platform without fugashi wheels (such as Alpine), install/build MeCab and its
headers before installing Python dependencies. Pykakasi remains a fallback.
Use **Edit readings** on a sentence page to save hiragana corrections;
**Reset to automatic** regenerates them. Changing sentence text clears its
corrections. Database migration regenerates existing automatic readings, and
`cd backend && uv run python manage.py refresh_readings` can refresh them later
while retaining saved corrections.
