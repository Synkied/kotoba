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
