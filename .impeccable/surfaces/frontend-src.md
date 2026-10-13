---
version: 1
slug: "frontend-src"
primary_target: "frontend/src"
related_targets: []
---

# kotoba app (frontend/src)

Scope: the whole kotoba web app: Inbox, Library, Decks, Practice, Review, Collect. Mode: Operate.
Task: turn collected Japanese (captures, audio, subtitles, text) into sentences and practise them. Most frequent: triage the inbox, then a practice/review session of 10–30 sentences.
Constraints: standard web controls and navigation; keyboard operable (practice: L listen, Space record, N next); light/dark from system; no CDN; phone, tablet and desktop.
Readability is the reason for the redesign: the user found the manga world's tinted stocks and flat hierarchy hard to read. Must survive: 秀優良可 score stamps and the practice balloon states (at rest / burst while recording / dashed when unclear).

## Direction contract

THESIS: kotoba is a Muji-labelled study shelf: a white sheet where the Japanese sentence is the largest, calmest thing on screen, and everything about it (source, time, tries) is a small kraft label pinned beside it. It refuses the tinted-section, framed-panel dashboard.

OWN-WORLD: White page (#fff; dark #161513), warm-grey rail (#f3f1ec; dark #0d0c0a) with Japanese-first section names (受信 Inbox). One accent, burgundy #7f0019 (dark text #ff6f6a): due counts, misses, the current item, 可, the logo block. Kraft labels (#e7dac4 / ink #3d3124) for source and attempt facts. Hairline rules (#e6e3dc), a 2px ink rule under a page head, no panel frames, square corners. Zen Kaku Gothic New 400/500/700. Meaning underlines from NHK Easy: solid burgundy = missed, dashed ink = unclear. Grade-inked double-ring stamps.

STORY: The learner opens a deck, reads each sentence at full size with furigana, sees at a glance which words they missed or blurred, which one is next, and how each one last scored; then practises the due ones.

FIRST VIEWPORT: Desktop: 224px rail (burgundy 言葉 KOTOBA block, underlined search field with ⌘K, bilingual nav with counts, burgundy 3px marker on the current section). Page: crumb, 36px title with a 14px subline, facts (due in burgundy, average, practised) and Edit / Practise N due at the right; a 2px ink rule and a plain-text filter bar with the underline key; sentence rows at 23px, measure ≤36em, kraft tag and stamp right-aligned; the current row on a faint warm wash with a burgundy edge. Phone: bottom tab bar, rows stack text over tag and stamp.

FORM: Muji labelling (無印良品), round 2's assigned direction (#1 after re-roll), refined as variant R2a (one-line kraft tags + NHK Easy meaning underlines); seed key 72d042db. Signature: the meaning underline and the kraft label. Practice balloons become a calm hairline rectangle with a tail; burst edge in burgundy while recording, dashed when unclear. Motion: 120ms hover, 160ms state; the stamp press stays.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
