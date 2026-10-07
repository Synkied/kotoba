# kotoba design system

A weekly manga magazine of your own sentences. Tokens live in `frontend/src/styles/tokens.css`; components in `frontend/src/styles/app.css` and `frontend/src/components/`.

## World
- **Stocks.** Each section is printed on its own tinted newsprint. The page ground (`--stock`) changes per section and does the wayfinding:
  inbox `#f4dfd5` salmon · library `#f0e7c6` straw · decks `#dce8d2` celadon · practice `#fbfaf6` white · review `#e5dff1` lavender · collect `#e8e4db` natural.
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

Browsing uses `<SentenceText>`: plain, left-aligned Japanese at the body size with a 1.7 line height and 4px vertical padding. Inbox, Library, Source, Deck, Review and sentence details use this compact reading treatment. Existing row dividers separate sentences; furigana and optional romaji remain available. Source metadata aligns with the text. The sentence detail page groups its reading preference directly beneath the text.

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

## Motion
120ms for hover, 160ms for state changes, ease `cubic-bezier(.2,.7,.2,1)`. No page-load choreography. `prefers-reduced-motion` turns motion off.

## Layout
- **Desktop:** 208px spine plus the page.
- **≤760px:** a bottom tab bar, and the practice controls stick within thumb reach.
- **≤900px:** practice stacks the source panel above the stage.

## Interface refinements

- Sentence rows keep the text in its own reading area at narrow widths (≤1100px); actions wrap beneath. Row variants live in CSS rather than inline column definitions. Long headings wrap, including editable deck names.
- Controls are at least 44px tall on phones and devices with a coarse pointer. The mobile navigation has seven sections including Listen; Add-ons is available above the page header.
- Organization filters use a native disclosure with label/category selects. Changing a search or filter clears the visible selection. Inbox and Library provide Load more; deck practice loads all deck sentences.
- Red remains reserved for recording, due counts, misses, and score stamps. Practice entry actions use ink. `--on-red` supplies a contrasting foreground in both themes.
- Failed mutations retain drafts and show actionable errors; deck order/removal updates after server success. Undo remains until used, dismissed, or replaced by another notification.
- Recording cuts show Saving / Saved / Not saved with Retry. Saves are serialized, and internal link navigation flushes pending cuts first. The script reader uses a native modal dialog with focus containment and restoration.
- Practice respects focused controls, blocks sentence navigation while recording/scoring/saving, exposes Speak along on phones, and offers Retry for failed score saves. Native waveforms use server peaks and resize with their panel. Furigana and romaji preferences remain consistent across reading screens.

- Sentence details place the source beneath the title and group practice, copy, and deck actions beneath the reading. All detail-page buttons, selects, and deck links use 44px minimum targets. Reading/audio/editing sections share heading alignment and ruled spacing; source context occupies a secondary column, stacking below the main content at ≤1000px.

- Sentence audio uses one waveform player bounded to the sentence span, with relative elapsed time, play/pause, restart, repeat and speed. Space toggles playback and Left/Right seek one second; shortcuts defer to text entry and focused controls.

- Deck sentence rows provide Listen / Stop using native sentence spans or the preferred synthetic voice. Playback stops when switching sentences, removing the active sentence, or leaving the deck; pending voice requests are cancelled.

- Sentence audio supports dragging a waveform range and adjusting its start/end with keyboard-accessible sliders. Play, seek, restart and repeat stay within the selected range; Clear selection restores the full sentence.

- Source pages keep full-source audio directly below the large source panel, before metadata and labels; this source column stacks above the transcript at ≤900px.
- Library's selected-sentence toolbar offers Add label with an explicit source count and scope explanation: labels apply to each owning source once, preserve its existing labels, and respect the three-label limit. Failed additions keep the label draft visible.
- Native selects and their options retain ink text on paper, including inside reversed selection toolbars; toolbar text remains reversed without reversing the controls' own foreground.
