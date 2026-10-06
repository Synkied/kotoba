# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Django + Django REST Framework + SQLite (runs on an always-on Raspberry Pi, reached over Tailscale), React + TypeScript (Vite) frontend. jp-shadow-cut's engine is merged into the backend (`speech/`): Whisper transcription and live scoring run in kotoba itself, on a GPU when there is one, as optional install extras. One install, one Docker image.

## Users

The primary user is the author: a self-taught learner of Japanese who reads games, anime, videos, textbooks (e.g. Minna no Nihongo) and app UIs, and practises speaking by shadowing. They collect material on the desktop, then triage, build decks and practise on desktop, phone and tablet. The hub may later be published for other learners, so it needs honest empty states and clear setup, but not marketing.

## Product Purpose

kotoba (言葉) is the hub that turns everything a learner collects in Japanese into things they can practise. It gathers screen captures, audio, video, subtitles and pasted text; turns them into sentences tied to their source (a screenshot, or a time span of native audio); lets the learner triage them in an inbox and group them into decks; then drills them by shadowing the native audio or reading aloud against a synthetic voice, scoring each attempt. Scores feed spaced review, so weak sentences come back. Success: going from "I saw/heard this" to "I can say this" with no file juggling.

## Positioning

- The sentence, tied to its source, is the unit of everything. Every sentence remembers where it came from (the screenshot it was read off, or the seconds of audio it was spoken in) and every attempt at saying it.
- Shadowing native audio, not just TTS. Media is cut into timed sentences so the learner repeats the real speaker and is scored against it.
- Local and private. OCR and speech recognition run on the user's own machines; nothing goes to a cloud service.

## Operating Context

- Collect: screen_ocr captures (hotkey + drag) are pushed to the hub with the same `POST /api/captures` contract they use today, queued offline in `outbox/`. Audio/video/subtitle files are uploaded; Whisper on the desktop transcribes them into timed sentences. Text can be pasted.
- Triage: an inbox of raw sources: keep, fix OCR errors, split into sentences, tag (up to three labels, e.g. "minna no nihongo", "lesson 18"), archive or delete.
- Build: decks are ordered lists of sentences (a lesson, an episode).
- Practise (the speech engine): per sentence, listen to the model (native clip, or VOICEVOX/browser TTS), record, get accuracy / clarity / fluency scores and the words heard. Training from a transcript already exists in jp-shadow-cut.
- Review: a spaced-repetition queue fed by low scores.
- Devices: desktop browser (capture, triage, deck building, live practice with GPU), phone and tablet over Tailscale (library, review, practice).

## Capabilities and Constraints

- Absorbs screen_ocr's history page: search (including romaji readings: `tokyo` finds 東京), categories, labels (max 3), furigana, bulk edits, de-duplication (×N), copy.
- Recordings: jp-shadow-cut's cleanup editor, rebuilt in the hub. Cut retakes, fillers, repeats and pauses from your own takes, render a clean take, and turn what's kept into practice sentences.
- Data model: Source → Sentence (text, reading, source span) → Deck; Attempt (scores) per sentence.
- No network calls to third-party services, no telemetry, no CDN assets; fonts are system or self-hosted.
- Light and dark follow the system setting.
- Undecided: SRS algorithm, Anki export, URL import (yt-dlp).

## Brand Commitments

- Name: kotoba (言葉). Lowercase in running text.

## Evidence on Hand

- Real sample material: `/projects/jp-shadow-cut/lesson_18.mp3` with its transcript and cuts (Minna no Nihongo lesson 18); screen_ocr history captures.
- No users, testimonials, screenshots or benchmarks exist. Don't invent them.

## Product Principles

1. The sentence is the unit. Every screen is about sentences: where they came from, how well you can say them.
2. Never interrupt the read. Capture stays instant; the hub never slows the capture path.
3. Native audio first, synthetic voice as fallback.
4. Local by construction.
5. Japanese is first-class: furigana, readings, vertical-safe CJK typography, correct line breaking.

## Accessibility & Inclusion

- Fully keyboard operable (practice included: play, record, next).
- Light and dark from the system setting.
- CJK renders with system fonts or self-hosted fonts that cover JIS kanji.
