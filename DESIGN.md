# kotoba design system

A weekly manga magazine of your own sentences. Tokens live in `frontend/src/styles/tokens.css`; components in `frontend/src/styles/app.css` and `frontend/src/components/`.

## World
- **Stocks.** Each section is printed on its own tinted newsprint. The page ground (`--stock`) changes per section and does the wayfinding:
  inbox `#f4dfd5` salmon · sources `#f0e7c6` straw · decks `#dce8d2` celadon · practice `#fbfaf6` white · review `#e5dff1` lavender · library (folders, files and lessons) `#d5e9e3` mint · collect `#e8e4db` natural.
  Dark mode turns these into deep inks (`#2a1e1a` …) on "beta" black pages.
- **Ink.** `--ink #1a1714`, `--ink-2 #463f37`, `--ink-3 #5f574d` (≥5.4:1 on every stock). Balloons, inputs and sheets use `--paper #fffdf8`.
- **One red.** `--red #cc1f1a` (text: `--red-ink #b0130e`) is only for recording, misses, due counts and score stamps. Never decorative.
- **Spine.** The nav is a black plate (`--spine #171411`). The active section steps out onto its own stock.
- **Screentone** (`.tone`, 4px dot grid) is the only texture. Use it only to push unfocused content back.

## Type
- `--font`: **Kotoba Kana** (BIZ UDPMincho, kana only) → **BIZ UDPGothic**. Together they make the アンチック体 mix of manga lettering: kanji in gothic, kana in mincho. Both are self-hosted through @fontsource. Run `scripts/kana-font.py` again after updating the package.
- **Three sizes only:** `--t-s .8125rem`, `--t-m 1rem`, `--t-l 1.75rem`. Show rank with weight (400/700) and black reversal plates (`.plate`), never with more sizes.
- Tabular numerals for times, counts and scores.

## Frames and space
- Panels use `--frame-bold 3px` ink borders with no radius. Controls and balloons use `--frame-thin 1.5px`. Controls have a 3px radius.
- Spacing scale: 4/8/12/16/24/32/48/64. The gutter between panels is 12px.

## Sentence reading and practice balloons

Browsing uses `<SentenceText>`: plain, left-aligned Japanese at the body size with a 1.7 line height and 4px vertical padding. Inbox, Source, Deck, Review and sentence details use this compact reading treatment. Existing row dividers separate sentences; furigana and optional romaji remain available. Source metadata aligns with the text. The sentence detail page groups its reading preference directly beneath the text.

Expressive balloons are reserved for practice, where their outlines communicate recording and scoring states. The newsprint stocks, Japanese lettering and score stamps carry the magazine identity across browsing pages without enclosing every sentence.
`<Balloon>` draws manga's electronic-sound balloon in SVG around its text: a ruled polygon with straight, slightly tilted edges, one corner clipped deep, one medium and the others barely, never an even octagon. Each balloon keeps its own cut. Its straight wedge tail points down-left at the source panel (screenshot crop, audio clip or text icon). Corners are mitred, never rounded. **The outline is the sentence's state:**
- round: at rest, or the model line
- burst (the same polygon with crackling edges, red while live): recording
- dashed: some words were heard unclearly

The `dim` variant applies screentone to neighbouring sentences in practice.
Balloons reserve 24px around their layout box for the outward outline and recording spikes, increased to 48px on the left when a tail is present. This clearance belongs to the practice component so adjacent content cannot sit under the SVG. Long text wraps within the remaining width.

## Other components
- **Stamp:** a red double-ring score stamp, rotated by id. Attempts never disappear; they pile up (`Stamps`). The big stamp lands with a 260ms press.
- **Units:** scored words. Missed words are struck through in red ink, unclear ones get a dashed underline.
- **Chips:** labels are boxed 1px. Categories are black reversal plates. Filters are `aria-pressed` chips.
- **Buttons:** default (paper), `.primary` (ink), `.red` (record), `.ghost`, `.small`, `.icon`. Every button has hover, active, disabled and busy states.
- **Toolbar:** sticky. It turns into a black plate while there is a selection.
- **Notices, toasts and skeletons:** ink-framed. Errors use the red frame. Toasts offer Undo.

## Recordings: the cutting room

The recording editor (from jp-shadow-cut) lives on its own stock, a cold blue-grey newsprint (`--stock-recordings`).
- **One continuous editing workspace.** On desktop, the transcript or script and cuts sit side by side with independent scrolling, above a permanently docked waveform and playback controls. At ≤900px, Transcript / Script / Cuts switch a single reading pane while the waveform stays visible.
- **Keep audition controls with the waveform.** Previous / next cut, preview result and keep / cut actions remain beside the selected range. Short phones use labelled icon buttons in one row. Analysis settings occupy the bounded reading workspace; filters and secondary actions open on demand.
- **Cut types are screentone, not hues.** Each type gets its own ink pattern, on the waveform and as a 14px swatch, so seven types stay readable without breaking the one-red rule:
  - retake: solid ink
  - earlier take: hatching
  - off script: cross-hatching
  - filler: dot tone
  - repeat: horizontal lines
  - pause: sparse grey tone
  - your own cuts: hatching in red pencil, the only red
- **Cut speech is struck through in ink.** The character under the playhead is reversed: ink background, paper text.
- **Script sentences get a teacher's marks.** ○ read, △ partly read, ✕ missing (red pencil), ✂ cut by your edits.
- **The selected cut gets the bold panel frame,** with grips on both edges. The playhead is an ink rule with a triangular cap, not red.
- **Background jobs appear in a framed sheet.** Transcribing and rendering show in a sheet docked bottom right, with an ink progress bar and the log on demand.

## Library and lessons: the study desk

A lesson page is a desk for reading and listening at once, on the mint stock.
- **The worksheet takes the page.** On wide screens the PDF fills the left column to the bottom of the viewport. The side column scrolls on its own.
- **Listening panel** (bold frame, paper): the recording picker, then a small player, then the transcript following the voice. The rail under the player lays the transcript's lines end to end as ink blocks (past lines half ink, the current one solid and taller) with the triangular-cap playhead. A repeated line gets a thin outline. Without a transcript it is a plain progress rule.
- **Transcript lines** match the Source page: a mono time code to play from, current line on a paper wash with an inset ink rule and a reversed time code, and spoken lines in `--ink-3`. Scrolling away stops the follow; "Back to the current line" returns.
- **Keys:** Space plays or pauses, the left and right arrows step through lines, and R repeats the current line.
- **Drawers** (thin frame, `<details>`) hold notes, sources and files. Each remembers whether it was open. A closed Notes drawer previews its first line.
- **≤1000px:** one column with the listening panel first, because phones show PDFs poorly inline.
- **The library** is a drive on the mint stock: folders as deep as you like, holding files kept as they are and lessons, all in your order. Not everything in a folder is a lesson. A path leads back up (current step bold, the others underlined); folders are cards with the bold frame, lessons are cards, files are drive rows in one thin-framed list (icon, name, kind and size, the lessons using it, transcript state) so a folder of forty tracks stays scannable.
- **Moving things:** a folder or path step taking a drop reverses to ink like the file drop zone; a card or row taking one shows an ink rule where the dragged item lands. A file dropped on a lesson joins it. Arrange gives the same moves as buttons (↑ ↓, a folder select) for keyboard and touch. Selected files get the selection dock: make a lesson, transcribe, move, rename, delete.
- **A lesson is a choice:** made from files the learner picks (linked, never copied; they stay in their folder) plus any new uploads. Importing a folder brings it in as it is by default; one lesson per folder is an option. Nothing is transcribed until asked.

## Motion
120ms for hover, 160ms for state changes, ease `cubic-bezier(.2,.7,.2,1)`. No page-load choreography. `prefers-reduced-motion` turns motion off.

## Layout
- **Desktop:** 208px spine plus the page.
- **≤760px:** a bottom tab bar, and the practice controls stick within thumb reach.
- **≤900px:** practice stacks the source panel above the stage.

## Interface refinements

- Sentence rows keep the text in its own reading area at narrow widths (≤1100px); actions wrap beneath. Row variants live in CSS rather than inline column definitions. Long headings wrap, including editable deck names.
- Controls are at least 44px tall on phones and devices with a coarse pointer. The mobile navigation has seven sections including Lessons; Add-ons is available above the page header.
- Inbox organization filters use a native disclosure with label/category selects. Changing a search or filter clears the visible selection. Inbox and Library provide Load more; deck practice loads all deck sentences.
- Red remains reserved for recording, due counts, misses, and score stamps. Practice entry actions use ink. `--on-red` supplies a contrasting foreground in both themes.
- Failed mutations retain drafts and show actionable errors; deck order/removal updates after server success. Undo remains until used, dismissed, or replaced by another notification.
- Recording cuts show Saving / Saved / Not saved with Retry. Saves are serialized, and internal link navigation flushes pending cuts first. The script reader uses a native modal dialog with focus containment and restoration.
- Practice respects focused controls, blocks sentence navigation while recording/scoring/saving, exposes Speak along on phones, and offers Retry for failed score saves. Native waveforms use server peaks and resize with their panel. Furigana and romaji preferences remain consistent across reading screens.

- Sentence details place the source beneath the title and group practice, copy, and deck actions beneath the reading. All detail-page buttons, selects, and deck links use 44px minimum targets. Reading/audio/editing sections share heading alignment and ruled spacing; source context occupies a secondary column, stacking below the main content at ≤1000px.

- Sentence audio uses one waveform player bounded to the sentence span, with relative elapsed time, play/pause, restart, repeat and speed. Space toggles playback and Left/Right seek one second; shortcuts defer to text entry and focused controls.

- Deck sentence rows provide Listen / Stop using native sentence spans or the preferred synthetic voice. Playback stops when switching sentences, removing the active sentence, or leaving the deck; pending voice requests are cancelled.

- Sentence audio supports dragging a waveform range and adjusting its start/end with keyboard-accessible sliders. Play, seek, restart and repeat stay within the selected range; Clear selection restores the full sentence.

- Source pages show the large source panel only when there is a screenshot; for audio the waveform is the source. The player column (≈4fr) stays sticky beside the script and scrolls itself if taller than the screen; at ≤900px the player docks at the top (56px waveform, no hint text) and the script reads beneath it. Start/end sliders fold into "Select a part of the audio"; Clear selection sits beside Play.
- Following the script: the spoken line gets paper and the ink rule, lines already said turn `--ink-3`, and the script scrolls only when the line leaves the upper band of the reading area, landing it a quarter of the way down. Wheel, touch or page-key scrolling outside the player pauses following; a floating "Back to the current line" resumes it. A line's timecode plays from there; its speaker plays that line only; Previous / Next line sit beside Play. On fine pointers per-line tools appear on hover or focus; stamps always show.
- **Library: source cards, not sentence lists.** Each kept source is a small paper card on the straw stock (thin ink frame, `--lift` on hover), in as many columns as fit at ≥19rem. A card carries a screenshot thumbnail only for captures. It shows the title (or first sentence, two lines), kind icon · sentence count · length · time, one line of context (the line matching the search, else the next sentence), its category plate and label chips (both filter on click), and a footer with the latest score stamp, "N of M practised" and Practise. The whole card opens the source; selection is per source (checkbox top-right, inset ink frame when selected).
- Library filters are pressable chips in rows (Kind, Labels with counts, Category); past 12 labels the rest sit in a compact select.
- Library's selection toolbar docks over the bottom of the page (above the tab bar on phones; toasts move above it), so selecting never shifts the cards. It counts sources and sentences and offers Add to deck, Practise these and Add labels: a comma-separated line (`,`, `、` and `，` all split) with suggestions from existing labels and a live preview of the chips. Labels keep existing ones, and an addition that would pass three labels on any source is refused with the count, never silently dropped. The server splits commas the same way.
- Native selects and their options retain ink text on paper, including inside reversed selection toolbars; toolbar text remains reversed without reversing the controls' own foreground.
- Word lookup: tapping a word in any sentence reverses it (ink plate, paper text, via the CSS Highlight API) and opens a bold-framed paper sheet beside it: the word with furigana at `--t-l`, reading and romaji, the dictionary form for conjugated words, numbered senses with the part of speech shown once until it changes, and Listen buttons in the preferred voice. At ≤760px it docks as a sheet above the tab bar. Escape, a tap outside, scrolling or resizing closes it; focus returns to where it was.
