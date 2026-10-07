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

## Direction contract

THESIS: kotoba is a weekly manga magazine of your own sentences. Browsing uses compact, aligned reading text; expressive speech balloons belong to practice, where the tail points at the source panel and the outline communicates recording and feedback. Newsprint stocks, Japanese lettering and score stamps connect the reading and practice surfaces.

OWN-WORLD: Each section is printed on its own tinted newsprint stock (inbox salmon, library straw, decks celadon, practice white, review lavender); near-black ink frames at two weights; one magazine red for recording and misses. Japanese set as アンチック体: kanji in BIZ UDPGothic, kana in BIZ UDPMincho. Three type sizes only; rank by weight and black reversal labels. Screentone dots only for dimmed/unfocused state. Score stamps in red ink.

STORY: The learner opens the inbox, keeps or fixes what came in, groups it into a deck, then practises: hears the real speaker, says it, and sees which words landed. Each attempt stamps the sentence; weak ones return in Review.

FIRST VIEWPORT: Desktop: magazine-spine nav rail on the left (section names with stock swatches, inbox count), page on its section stock; header with page title and global search (/). Practice: source panel left, the current sentence in a large balloon right with Listen / Record / Next below, previous and next sentences dimmed in screentone. Phone: bottom tab bar, balloon full width, controls in thumb reach.

FORM: weekly manga magazine, #7 on my resonance list (assigned); seed key 2a3ca589. Signature: balloon outline is state: round = model line, jagged burst while recording, dashed = words heard unclearly. Raised from streaming wall: focused sentence full ink, the rest screentone. Raised from ticket wallet: attempts never vanish, they stamp. Raised from timetable rack: three sizes, rank by weight/reversal. Motion: 160ms state changes; balloon morphs round→burst on record.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
