# kotoba design system

A Muji-labelled study shelf (無印良品). Every section is the same white sheet; the Japanese sentence is the largest, calmest thing on it, and the facts about it (source, time, tries, labels) are small kraft labels pinned beside it. Hairline rules, square corners, one burgundy accent for state, and a traditional dye for each kind of thing on the shelf. The first section says where the system lives, so changing the design is one edit and reusing an element is one import; the rest says what the world is and how each screen uses it.

## How the system is built

Open **`/design`** in the app (by URL; it is not in the navigation). It shows every token and component live in the current theme, with each colour swatch reading back the hex it resolves to. Check it after changing anything below.

**Tokens:** `frontend/src/styles/tokens.css`. Every colour, size, space step, frame, radius, duration and easing is defined here and nowhere else. Each colour has a light value in `:root` and a dark value in the single `prefers-color-scheme: dark` block; only colours change there. To recolour the app, edit this file.
- The sheet and the rail: `--page`, `--rail`, `--rail-hover`, `--wash` (the current row and quiet fills: quotes, code, table heads).
- Ink and paper: `--ink` `--ink-2` `--ink-3`, `--paper` (inputs, balloons, sheets: the page itself, set off by a hairline), `--paper-hover` (a card under the pointer), `--on-ink`, `--rule` (hairline between rows), `--rule-strong` (field and panel frames, a rule that groups).
- Kraft: `--kraft`, `--kraft-ink`.
- The accent: `--accent`, `--accent-ink` (burgundy as text and underline), `--accent-wash` (behind an error), `--accent-press`, `--on-accent`; `--brand` and `--on-brand` for the 言葉 KOTOBA block.
- Stamp inks: `--stamp-shu` `--stamp-yu` `--stamp-ryo`, each with an `-ink` variant for text. 可 uses the accent.
- Kind dyes: `--dye-{folder,lesson,note,media,doc,source}`, each with `--on-dye-*` (the icon on a tile), `-ink` (the dye as text) and `-wash` (a pale ground). `[data-dye=…]` maps one onto `--dye` / `--on-dye` / `--dye-ink` / `--dye-wash` (`components/kind.css`).
- Status lights: `--ok`, `--warn` (engine and add-on dots; never text).
- Frames: `--frame` (1px), `--frame-head` (2px), `--radius-control` (0).
- Type: `--font`, `--mono`, `--t-tag` `--t-s` `--t-sub` `--t-m` `--t-read` `--t-fig` `--t-l` `--t-xl`, `--w-medium` (500), `--measure` (36em).
- Space and size: `--s-1` to `--s-8`, `--gutter`, `--control-h` `--control-h-s`, `--rail-w`.
- Motion and depth: `--ease`, `--t-fast`, `--t-state`, `--lift`.

**Styles:** `frontend/src/styles/index.css` imports in cascade order, and the order matters:
1. `tokens.css`, `base.css` (element defaults, selection, links, headings), `shell.css` (rail, page head and facts, phone tab bar)
2. `components/*.css`: one file per shared component (controls, panel, balloon, sentence-text, sentence-audio, stamp, lists, feedback, word-lookup, note-markdown)
3. `pages/*.css`: one file per route; its selectors stay inside that page's own classes
4. `touch.css`: last on purpose. On phones and coarse pointers every control grows to 44px and has to win over page-level sizing.

The font is imported in `main.tsx` (`@fontsource/zen-kaku-gothic-new` at 400, 500 and 700); there is no font stylesheet of our own any more.

New CSS goes in the file of the component or page it styles. If a page needs a colour or size the tokens don't have, add a token; don't write a literal.

**Components:** `frontend/src/components/ds` (`import { Button } from '../components/ds'`). Each primitive renders the native element with the system's classes, passes every other prop through, and adds no behaviour:
- `Button` (`variant` primary | ghost | accent, `size="small"`, `icon`), `ButtonLink` (a router link), `ButtonRow`, and `buttonClass()` for an `<a>`, `<summary>` or `<label>` that should look like a button. With no variant a Button is an ink outline. `accent` (burgundy) is for recording only. A Button has no default `type`; inside a form it submits.
- `Chip` (a label: a kraft tag), `ChipButton` (a kraft filter; pass `aria-pressed`, pressed reverses to ink), `Plate` (an ink plate for categories and counts; `tone` accent | hollow), `Kbd`
- `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Segmented` (native radios)
- `Panel`, `Sheet`, `Notice` (`tone="error"`), `EmptyState`; `as` changes the element where the markup needs it
- `KindTile` and `KindCounts` (`components/Kind.tsx`): a dyed square holding the kind's icon, and dyed counts ("■ PDF ■ 4 recordings"). `Menu`, `MenuItem`, `MenuRule` (`components/Menu.tsx`): a button that opens a short hairline list of actions, lifted; arrows move, Escape closes.
- Domain components stay in `frontend/src/components/`: `Balloon`, `SentenceText`, `Furigana` and `Units`, `Stamp` and `Stamps`, `SourcePanel`, `SentenceAudio`, `WordLookup`, `ReadingAids`, `NoteMarkdown` and `MentionTextarea`, plus `ui.tsx` (`SearchBox`, `Skeleton`, `ErrorNotice`, toasts).

Known deviations from the type scale, kept as they are: the stamps' internal sizes (`stamp.css`; the small stamp's 14px grade, the big stamp's 2.25rem score, 15px mark and 10px label, the 56px history stamp's 1.125rem), the phone balloon at 1.375rem (`practice.css`), and the cutting room's transcript and script at 1.0625rem and its marks at 1.125rem (`cleanup.css`). Bring them onto the scale, or into a token, the next time those screens are designed.

## World

- **One white sheet.** Every section reads on the same page: `--page` #ffffff (dark #161513). Sections are no longer told apart by colour; the rail says where you are.
- **The rail.** A warm-grey column (`--rail` #f3f1ec; dark #0d0c0a, darker than the page) running the full height. At its top the brand block: 言葉 over KOTOBA, white on burgundy (`--brand` #7f0019 in both themes), like a printed product label. Under it the search field, an underlined line rather than a box, with a Ctrl/⌘ K hint; it opens `/search`. Then the sections, Japanese first with the English beside it in small type: 受信 Inbox, 資料 Library, 単語 Words, デッキ Decks, 復習 Review, 素材 Sources, ノート Notes, 収集 Collect. Counts sit at the right; a due count is burgundy and bold. The current section is ink and bold with a short 3px × 16px burgundy marker at the rail's edge. Add-ons and today's tally sit in the rail's foot.
- **Ink.** `--ink` #1f1f1f, `--ink-2` #474542, `--ink-3` #5e5b56 (meta text, at least 5.9:1 on the page and the rail). Dark: #f2ecdf, #d2c9b9, #a99f8f.
- **Rules, not frames.** `--rule` #e6e3dc separates rows; `--rule-strong` #cfcac0 frames fields, panels and sheets. Dark: #2b2824 and #3a362f.
- **The wash.** `--wash` #faf8f4 (dark #1f1d1a) is the only fill on the sheet: the current row, a selected entry, hover on quiet controls, quotes, code and table heads.
- **Kraft labels.** `--kraft` #e7dac4 with `--kraft-ink` #3d3124 (dark: #2f2619 with #e7dac4). Kraft is for facts pinned to something: labels, the source tag under a sentence (title · time), the kind tag in a panel's corner, a mentioned source and a quoted time code in a note, the selection toolbar while something is selected, the looked-up word, and selected text.
- **One accent, burgundy.** `--accent` #7f0019, as text `--accent-ink` #7f0019. Dark lifts it so it still reads: #ff6f6a, text #ff8a85. The brand block keeps #7f0019 in both themes.

**The Burgundy Rule.** Burgundy means due, missed, current, recording, or 可. Errors borrow it (an error notice, an invalid field, a failed job). Nothing else is burgundy: not links, not headings, not primary buttons (those are ink).

**Kind dyes (染め).** Colour says *what* a thing is; burgundy says what *state* it is in. Each kind on the shelf has a traditional dye, so a folder, a lesson, a note and a recording read apart before their names do:
- 藍 indigo `#24548a`: folders. A folder card is cut like a file folder: a tab of the dye on its shoulder and a 2px rule of it along the top.
- 萌葱 green `#4a7a23`: lessons. A 4px band across the top of a lesson card (rule-strong once done).
- 山吹 gold `#e3a80f` (icon in dark brown on it; as text `#8a6200`): notes.
- 柿 persimmon `#c9592b`: recordings, audio and video. The recording playing on the lesson page is set in it.
- 紫 purple `#6e4596`: documents: PDFs, images, text.
- 浅葱 teal `#1b7f86`: collected sources linked to a lesson.
Dark lifts each one (`#6f9fd8`, `#8cc063`, `#f0bd3c`, `#f08a5d`, `#b38be0`, `#5cc4cb`) and sets its icon in the page colour. A dye appears as a square tile holding the kind's icon (32px; 24px small; 44px in a lesson head), as an 8px square before a count, as a 10px square keying a section head, or as a tab or band. A dyed card takes a breath of its wash under the pointer. Dyes are never text colour for reading, never a page or panel ground, and never state.

**Stamp inks.** Scores are inked by school grade: 秀 ≥90 gold (`--stamp-shu` #9a7400, text #7d5e00), 優 ≥75 green (#2f6b45), 良 ≥50 indigo (#34508f), 可 below 50 in the accent. Dark lifts each: #f2bf4a, #5cc98a, #7fa2ff.

No texture anywhere and no tinted grounds (the manga world's tinted stocks were hard to read). Quiet comes from space, the third ink and the wash; colour comes from the dyes on small marks.

## Type

- **Zen Kaku Gothic New** at 400, 500 and 700, self-hosted through @fontsource; fallbacks Hiragino Kaku Gothic ProN, Yu Gothic UI, Noto Sans CJK JP, system sans. One family for Japanese and Latin. `--mono` (system monospace) only for keys, code and the cutting room's ruler.
- **The scale:** `--t-tag` 11px (keys and the phone tab bar only, never reading text) · `--t-s` 13px (meta, crumbs, labels, filters) · `--t-sub` 15px (English glosses, secondary lines, nav, buttons) · `--t-m` 16px (body and controls) · `--t-read` 23px (a Japanese sentence being read) · `--t-fig` 24px (figures in a page head) · `--t-l` 28px (section heads, empty states, a looked-up word, the big balloon) · `--t-xl` 36px (the page title; 28px on phones).
- **The Sentence Rule.** The Japanese sentence is the largest reading text on a browsing screen: `--t-read` at weight 500, line height 1.9, its line held to `--measure` (36em). Furigana sit above at .48em in `--ink-3`.
- Weights: 500 for headings, the sentence and buttons; 700 for counts, the current item and emphasis; 400 for everything else. Body is 16px at 1.65.
- Japanese text uses `line-break: strict` and `word-break: auto-phrase`, so lines break between phrases.
- Tabular numerals for times, counts and scores.

## Frames and space

- **Hairlines.** Panels, sheets, fields, notices and balloons use `--frame` (1px) in `--rule-strong`. A focused field turns its frame ink and doubles it with a 1px inset.
- **The head rule.** One 2px ink rule (`--frame-head`) closes a page head; a 1px ink rule heads a day group or a folder of decks.
- **Square.** `--radius-control` is 0. No rounded corners anywhere except the circular stamps and status dots.
- **Depth.** Flat by default. `--lift` (a soft two-layer shadow) appears only on things that float: popovers, the word sheet, toasts, the selection dock, follow buttons, and a source card under the pointer.
- **Spacing scale:** 4/8/12/16/24/32/48/64. The gutter between panels is 16px. Rows breathe at 24px top and bottom.

## Sentence reading and practice balloons

Browsing uses `<SentenceText>`: plain, left-aligned Japanese at `--t-read`, weight 500, line height 1.9, with 4px vertical padding and a 36em measure. Inbox, Source, Deck, Review and sentence details use it. Rows are separated by `--rule` hairlines. Furigana, romaji and translation remain available; romaji sits under the text at `--t-s` in `--ink-3`, the translation at `--t-sub` in `--ink-2`. The sentence detail page groups its reading preferences directly beneath the text.

**Meaning underlines** (from NHK News Web Easy) mark how each word was heard, and the word keeps its ink; only the line under it speaks:
- missed: a solid 2px burgundy underline
- partly heard: a 1px burgundy underline
- unclear: a dashed 1.5px `--ink-2` underline

Expressive balloons are reserved for practice, where their outlines communicate recording and scoring states. `<Balloon>` draws a calm speech balloon in SVG around its text: a square hairline frame (`--rule-strong` on `--paper`; `--ink-3` for the big balloon) with a straight wedge tail cut out of its left edge, low down, pointing down-left at the source panel. Corners are mitred, never rounded. **The outline is the sentence's state:**
- round (the name predates the square frame): at rest, or the model line
- burst: the same frame with its edges broken into a fine, even crackle, 1.5px ink, burgundy while live: recording
- dashed: `--ink-2` in 5/4 dashes: some words were heard unclearly
- dim: no fill, a `--rule` outline and `--ink-3` text, for neighbouring sentences in practice

A balloon keeps 8px around its box, and 24px on the left when it has a tail, so the tail and the crackle never sit under adjacent content. Long text wraps within the remaining width. The big balloon sets its text at `--t-l`, weight 500, balanced.

## Other components

- **Stamp:** a double-ring score stamp (2px ring, a 1px inner ring at 55%), inked by grade and rotated by id. The small stamp (34px) shows the grade, 秀優良可; the score is in its label. Below 50 it is faint. Attempts never disappear; they pile up, overlapping (`Stamps`). The big stamp (112px, 3px ring) shows the grade over the score with a SCORE label, and lands with a press (see Motion).
- **Units:** scored words, with the meaning underlines above. Pending words are `--ink-3`.
- **Rows:** a sentence row is a number, the sentence with its kraft source tag beneath, and a tools-and-stamps column at the right; stamps sit in a slot of their own so the buttons stay put. **The Current Row Rule.** The current row sits on the wash with an inset 3px burgundy edge, and its number turns burgundy and bold. Rows already past (the Source page while it plays) step back to `--ink-3`.
- **Facts:** a page head can carry figures (`--t-fig`, weight 500) over a small `--ink-3` word: due, average, practised. Due is burgundy.
- **Notes:** `NoteMarkdown` renders a note's Markdown (Notes page and lesson page alike); a mentioned source is a kraft label, reversed to ink under the pointer. `MentionTextarea` opens a hairline source menu under the caret when you type @ (arrows, Enter, Esc); the chosen entry sits on the wash with a burgundy edge.
- **Chips and plates:** labels are kraft chips (26px, square). Filters are pressable kraft chips that reverse to ink. Reading aids (ふりがな, romaji, translation) are toggles instead: a hairline when off, ink when on. Categories and counts are ink plates; `accent` only for what is due or missed; `hollow` is a quiet hairline.
- **Buttons:** an ink outline by default (`--t-sub`, weight 500, 40px), `primary` (ink fill), `accent` (burgundy, record only), `ghost` (no frame, `--ink-2`), `small` (30px), `icon` (square). Hover takes the wash; disabled drops to 40%. Every button has hover, active, disabled and busy states.
- **Fields:** paper with a `--rule-strong` hairline, `--ink-3` on hover, ink on focus; an invalid field turns burgundy. Segmented controls are native radios in one hairline frame, the checked one reversed to ink.
- **Tabs:** plain words on a line; the current one is ink, bold, with a 2px ink rule under it.
- **Toolbar:** sticky on the page, closed by a hairline. While there is a selection it becomes a kraft label holding the actions (outlines in kraft ink; the primary action kraft-ink filled).
- **Notices, toasts and skeletons:** notices take a hairline; errors take the burgundy frame on `--accent-wash` with the recovery action. Toasts are ink with `--on-ink` text, lifted, and offer Undo. Skeletons are wash bars on a hairline, pulsing.

## Recordings: the cutting room

The recording editor (from jp-shadow-cut) reads on the same white sheet as everything else.

Recordings, Sentences and the transcription Queue are tabs of Sources (`/sources/recordings`, `/sources/sentences`, `/sources/queue`); the editor is `/sources/:id/cleanup`. The tabs are links in the `.tabs` style, the current one in ink with its 2px rule, and the Queue tab counts what's waiting. The queue uses ruled lists for ongoing and waiting work, with the shared loader, progress when available, and automatic refresh.
- **One continuous editing workspace.** On desktop, the transcript or script and cuts sit side by side with independent scrolling, above a permanently docked waveform and playback controls. At ≤900px, Transcript / Script / Cuts switch a single reading pane while the waveform stays visible.
- **Keep audition controls with the waveform.** Previous / next cut, preview result and keep / cut actions remain beside the selected range. Short phones use labelled icon buttons in one row. Analysis settings occupy the bounded reading workspace; filters and secondary actions open on demand.
- **Cut types are ink patterns, not hues.** Each type gets its own screentone-like pattern, drawn on the waveform canvas and as a 14px swatch in a 1px ink frame, so seven types stay readable without breaking the Burgundy Rule:
  - retake: solid ink
  - earlier take: hatching
  - off script: cross-hatching
  - filler: dot tone
  - repeat: horizontal lines
  - pause: sparse dot tone in `--ink-3`
  - your own cuts: hatching in burgundy pencil, the only accent
- **Cut speech is struck through.** Cut text drops to `--ink-3` with a 1.5px ink strike (burgundy for your own cuts). The character under the playhead is reversed: ink background, `--on-ink` text.
- **Script sentences get a teacher's marks.** ○ read, △ partly read, ✕ missing (burgundy), ✂ cut by your edits. The script line being heard is the current row: wash and burgundy edge.
- **The selected cut** gets a 3px ink frame on the waveform with grips on both edges; in the cut list it sits on the wash inside a hairline. The playhead is a 2px ink rule with a triangular cap, not burgundy.
- **Background jobs appear in a docked sheet.** Transcribing and rendering show in a hairline sheet docked bottom right, lifted, with an ink progress bar and the log on demand; a failed job takes the burgundy frame.

## Library and lessons: the study desk

A lesson page is a desk for reading and listening at once.
- **The head:** a small crumb of where it is kept (Library › folder › folder, or Archive), then the lesson's large green tile, the title with what it holds as dyed counts, and at the right a pin, Mark done (primary; Study again once done) and a ⋯ menu: Rename lesson, Move to another folder (opens a folder picker on the folder's wash under the head), Delete lesson. Nothing else sits between the head and the desk.
- **Recordings:** up to twelve are numbered keys in a hairline strip beside the persimmon tile, the one playing filled in persimmon and named beside the strip; past twelve they fall back to a select.
- **The worksheet takes the page.** On wide screens the PDF fills the left column to the bottom of the viewport. Nothing on the desk scrolls the page: the PDF, the transcript and the notebook each scroll on their own. With nothing to study yet, a dashed `--ink-3` sheet holds the place.
- **Rules share the room.** A rule between the PDF and the side column, and one between the listening panel and the notebook, can be dragged (or focused and moved with the arrow keys; Shift for bigger steps, Enter or a double click to reset). At rest each shows a short 3px × 40px grip in `--ink-3`; under the pointer, focused or held, it draws its full length in ink. The proportions are remembered.
- **Listening panel** (hairline frame, paper): the recording picker, then a small player, then the transcript following the voice. The rail under the player lays the transcript's lines end to end as ink blocks (past lines at about half ink, the current one solid and taller) with the triangular-cap playhead. A repeated line gets a hairline outline. Without a transcript it is a plain progress rule.
- **Transcript lines** match the Source page: a time code to play from, the current line as the current row (wash, burgundy edge, burgundy time code), and spoken lines in `--ink-3`. Scrolling away stops the follow; "Back to the current line" returns.
- **Keys:** Space plays or pauses, the left and right arrows step through lines, and R repeats the current line. While writing a note, Alt (⌥) K plays or pauses, Alt J / L step lines and Alt Q quotes the current line.
- **The notebook** (hairline frame, paper) sits under the listening panel: Notes, Sources and Files as tabs on its head, each with its small dyed tile (gold, teal, purple), divided by hairlines; the current one is on paper with a 3px rule in its dye under it, counts boxed in a 1px frame. Every tab stays mounted, so a half-written note survives a look at the files. The tab is remembered.
- **Writing is a ruled page.** Clicking a note (not a link, not while selecting) starts writing it. The editor is set in `--font` on `--rule` hairlines that scroll with the text, grows with what is written (the notebook scrolls, not a box inside it), and keeps Saved / Done writing in a sticky foot. Selected text there is kraft.
- **Quoting the voice.** Each transcript line has a quote button (on hover, focus or the current line; always on touch). It, or Alt Q, puts the line into the note being written at the caret (else into the last note, opened; else a new one) as `> [0:12](#at=f2:12) どんな写真を撮りますか。` with a blank line after it for the learner's own words. In a note the time code is a small kraft label with a play mark that plays the recording from there, switching recordings if needed; outside the lesson page it is a quiet hairline-outlined label in `--ink-3`.
- **≤1000px:** one column: the listening panel, then the notebook, then the PDF, because phones show PDFs poorly inline.
- **The library** is a drive: folders as deep as you like, holding files kept as they are and lessons, all in your order. Not everything in a folder is a lesson. Every way to add something is in the head: New lesson (primary) and one Add menu (New folder, New note, Add files, Import a folder) acting on the open folder. Inside a folder, one line says where you are: the path back up in small underlined steps, the open folder named at `--t-fig` with its indigo tile, and a ⋯ menu beside it (pin, rename, delete); the drag hint and Arrange sit at the right of the same line. At the top level that line holds only the hint and Arrange. Section heads (Folders, Lessons, Notes, Files) are keyed with their dye. Folders are cut cards, lessons banded cards (tile and title, what it holds as dyed counts, a note excerpt, and a foot with the date, a pin and a quiet Mark done), notes and files are drive rows with their dyed tile in one hairline list on paper (name, kind and size, the lessons using it, transcript state) so a folder of forty tracks stays scannable. A note's folder select shows only while arranging.
- **Moving things:** a folder or path step taking a drop reverses to ink like the file drop zone; a card or row taking one shows a 3px ink rule where the dragged item lands. A file dropped on a lesson joins it. Arrange gives the same moves as buttons (↑ ↓, a folder select) for keyboard and touch. Selected files get the selection dock: make a lesson, transcribe, move, rename, delete.
- **A lesson is a choice:** made from files the learner picks (linked, never copied; they stay in their folder) plus any new uploads. Importing a folder brings it in as it is by default; one lesson per folder is an option. Nothing is transcribed until asked.

## Motion

120ms (`--t-fast`) for hover, 160ms (`--t-state`) for state changes, ease `cubic-bezier(.2,.7,.2,1)`. Docks and toasts rise 8px as they fade in. No page-load choreography. `prefers-reduced-motion` turns motion off. The record button blinks between burgundy and its pressed shade once a second while live. One exception to quiet: a fresh score stamp is pressed on (about 1s): it drops, squashes, leaves an ink ring and spray in its grade's ink, and the result rocks with the thud. 秀 adds one glint.

## Layout

- **Desktop:** the 224px rail plus the page. The page has 48px above, side padding that grows from 16px to 64px with the viewport, and a head of crumb, title (36px) with its subline, facts and actions at the right, closed by the 2px ink rule.
- **≤1100px:** sentence rows stack: the text keeps its own reading area and the tools wrap beneath it.
- **≤900px:** practice stacks the source panel, then the stage, then the score.
- **≤760px:** the rail gives way to a bottom tab bar on the rail's grey (the eight sections plus Search, icons over 11px names). The current tab is ink and bold with a 2px burgundy rule along its top; counts are small ink plates, burgundy when due. The page title drops to 28px, and practice controls stick within thumb reach.

## Practice: model, take, score

- **One session bar** under the progress rule holds everything that applies to every sentence: reading aids (ふりがな, romaji, translation), the model voice (Native / Voice and the voice select) and Speak along. Toggles never sit between the sentences.
- **The progress rule** is one short segment per sentence: done in `--ink-3`, a weak result (below 70) in burgundy, the current one in ink and taller.
- **The side column** (sticky, ≥18rem) is the model and how you did against it: the source panel (waveform or screenshot, with its kraft kind tag) and its link, then the score slot (a fresh big stamp with Accuracy / Clarity / Fluency and Heard / Missed / Unclear, else "Last time" with a 56px stamp and earlier stamps under Before, else a one-line empty state, plus self-grading without Whisper), then the keys. The score is in the first viewport on desktop. In a narrow column the three scores stack as a tally beside the stamp.
- **The stage** is the take: the previous sentence as one dimmed line, the big balloon, the level meter (a 3px rule filling in burgundy), Listen / Say it / Next with the silence note, then the next sentence as one dimmed line (hidden on phones, where Next is in thumb reach). Say it is the burgundy accent button. The translation folds inside the big balloon under a dashed rule; T opens it.
- When stacked, a fresh score scrolls into view clear of the docked controls.

## Interface refinements

- Sentence rows keep the text in its own reading area at narrow widths (≤1100px); actions wrap beneath. Row variants live in CSS rather than inline column definitions. Long headings wrap, including editable deck names.
- Deck rows rest as sentence, kraft source tag and stamps. On fine pointers at desktop widths the row tools (Listen, Details, move, remove) come up under the pointer or on focus; stamps always show.
- Controls are at least 44px tall on phones and devices with a coarse pointer. The phone tab bar has the eight sections plus Search; tabs stay at least 48px wide, with horizontal scrolling on narrow screens. On phones Add-ons is in the Collect header.
- Inbox organization filters use a native disclosure with label/category selects. Changing a search or filter clears the visible selection. A selected inbox entry sits on the wash; the keyboard cursor adds the burgundy edge. Inbox and Library provide Load more; deck practice loads all deck sentences.
- Burgundy remains reserved for due counts, misses, the current item, recording and 可 stamps (and errors). Score stamps are inked by grade: 秀 ≥90 gold, 優 ≥75 green, 良 ≥50 indigo, 可 burgundy. Practice entry actions use ink. `--on-accent` supplies a contrasting foreground in both themes.
- Failed mutations retain drafts and show actionable errors; deck order/removal updates after server success. Undo remains until used, dismissed, or replaced by another notification.
- Recording cuts show Saving / Saved / Not saved with Retry. Saves are serialized, and internal link navigation flushes pending cuts first. The script reader uses a native modal dialog with focus containment and restoration.
- Practice respects focused controls, blocks sentence navigation while recording/scoring/saving, exposes Speak along on phones, and offers Retry for failed score saves. Native waveforms use server peaks and resize with their panel. Furigana and romaji preferences remain consistent across reading screens.
- Sentence details place the source beneath the title and group practice, copy, and deck actions beneath the reading. All detail-page buttons, selects, and deck links use 44px minimum targets. Reading/audio/editing sections share heading alignment and ruled spacing; source context occupies a secondary column, stacking below the main content at ≤1000px.
- Sentence audio uses one waveform player bounded to the sentence span, with relative elapsed time, play/pause, restart, repeat and speed. Space toggles playback and Left/Right seek one second; shortcuts defer to text entry and focused controls.
- Deck sentence rows provide Listen / Stop using native sentence spans or the preferred synthetic voice. Playback stops when switching sentences, removing the active sentence, or leaving the deck; pending voice requests are cancelled.
- Sentence audio supports dragging a waveform range and adjusting its start/end with keyboard-accessible sliders. Play, seek, restart and repeat stay within the selected range; Clear selection restores the full sentence.
- Source pages show the large source panel only when there is a screenshot; for audio the waveform is the source. The player column (≈4fr) stays sticky beside the script and scrolls itself if taller than the screen; at ≤900px the player docks at the top (56px waveform, no hint text) and the script reads beneath it. Start/end sliders fold into "Select a part of the audio"; Clear selection sits beside Play.
- Following the script: the spoken line is the current row (wash, burgundy edge, burgundy time code), lines already said turn `--ink-3`, and the script scrolls only when the line leaves the upper band of the reading area, landing it a quarter of the way down. Wheel, touch or page-key scrolling outside the player pauses following; a floating, lifted "Back to the current line" resumes it. A line's timecode plays from there; its speaker plays that line only; Previous / Next line sit beside Play. On fine pointers per-line tools appear on hover or focus; stamps always show.
- **Library notes.** Markdown notes are items in the existing Library folder tree, beside lessons and files. The Notes page remains a quick view of all notes; a note's folder can be changed from either surface. Each note may hold several compact links to existing sources. The links are stored as source relationships, so source title changes appear in notes without rewriting Markdown.
- **Library: source cards, not sentence lists.** Each kept source is a small paper card in a `--rule-strong` hairline (on hover `--lift`, the `--paper-hover` surface and an underlined title), in as many columns as fit at ≥19rem. A card carries a screenshot thumbnail only for captures. It shows the title (or first sentence, two lines), kind icon · sentence count · length · time, one line of context (the line matching the search, else the next sentence), its category plate and kraft label chips (both filter on click), and a footer under a hairline with the latest score stamp, "N of M practised" and Practise. The whole card opens the source; selection is per source (checkbox top-right, a 1.5px inset ink frame when selected).
- Library filters are pressable chips in rows (Kind, Labels with counts, Category); past 12 labels the rest sit in a compact select.
- Library's selection toolbar docks over the bottom of the page as a lifted kraft label (above the tab bar on phones; toasts move above it), so selecting never shifts the cards. It counts sources and sentences and offers Add to deck, Practise these and Add labels: a comma-separated line (`,`, `、` and `，` all split) with suggestions from existing labels and a live preview of the chips. Labels keep existing ones, and an addition that would pass three labels on any source is refused with the count, never silently dropped. The server splits commas the same way.
- Native selects and their options keep ink text on paper everywhere, including inside the kraft selection toolbar.
- Word lookup: tapping a word in any sentence puts it on kraft (via the CSS Highlight API), as if a label had been tied to it, and opens a hairline paper sheet beside it, lifted: the word with furigana at `--t-l`, reading and romaji, the dictionary form for conjugated words, numbered senses with the part of speech shown once until it changes, and Listen buttons in the preferred voice. At ≤760px it docks as a sheet above the tab bar. Escape, a tap outside, scrolling or resizing closes it; focus returns to where it was.

## Heard on YouTube

Lines from the subtitled YouTube channels the learner follows (`components/Heard.tsx`, `components/heard.css`). They aren't the learner's sentences until kept, so they read as sentences but carry no stamps, numbers or Details.
- **The section** sits under the learner's own sentences on a word page, and is the main column of the dictionary-word page (`/dict/:key`, a word not yet in any sentence; it hands over to the word page once it is). Its head is a day head keyed with a 10px persimmon square: "Heard on YouTube", the count of lines and videos, and Find more (ghost) at the right.
- **A heard row** is the line at `--t-read` with the word marked (as on the word page), the lines before and after it in `--t-sub` `--ink-3`, one line each and cut short, as practice dims its neighbours. Under it a kraft tag keyed with an 8px persimmon square: **channel** · title · time, opening YouTube there (emoji in titles are dropped: the label's face doesn't draw them). Then what it asks of the learner: a hollow "every other word known" plate, or "2 other new words" in meta. Tools at the right: Listen, What's said around it (a disclosure), Keep. Kept, Keep becomes an ink-outlined "✓ Kept" link to the sentence.
- **Playing:** the row is the current row: the wash and the burgundy edge reach past it (as the inbox cursor), so the text never moves. The first line of a video waits for its audio: the speaker breathes (opacity, 1.1s) and one meta line says why.
- **What's said around it** replaces the neighbours with ±6 lines of transcript in hairline rows: a time code that plays the line (burgundy and bold while it plays), the text at `--t-m` in `--ink-2`, Keep on hover or focus (always on touch). The line it opened from is ink at `--t-read`.
- **Order:** the fewest other words the learner doesn't know, then a length easy to repeat (8–40 characters), one per video before a second from any. Five, then Show more.
- **Elsewhere:** the word lookup sheet adds "Heard in N lines on YouTube" with a persimmon square under the library line; Search adds a Heard on YouTube group (compact rows: no neighbours, no disclosure) whose head links to all the lines of the word found.
- **Add-ons:** "Heard on YouTube · yt-dlp", what goes to YouTube in bold first words, Turn on (primary). On: the channels as hairline rows (name linking out, "47 of 199 videos with Japanese subtitles · 12,174 lines · 82 still to read", a 6px progress rule with lines read in ink and skipped in faint `--ink-3`, what was skipped and why, refresh and remove), the Follow field, then the yt-dlp version, Update now and Turn off. The dot is warn while reading or resting after YouTube's "too many requests", with when it carries on.
- **Empty and partial states** say the next step: off (set it up), no channels (follow one, or Find more), subtitles still being read (how many videos to go), not in the channels followed (Find more).

## Open

- Deck rows don't show meaning underlines yet: the deck API carries no attempt units, so a deck row can only show its stamps. The deck page also has no current row of its own yet; the wash-and-burgundy-edge treatment appears on the Source page, the lesson transcript, the cutting room's script and the inbox cursor.
- The practice balloon can leave a lone final kana (「す。」) on its own line at the big size; `text-wrap: balance` and `auto-phrase` don't prevent it.
