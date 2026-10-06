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

## Signature: balloons
`<Balloon>` draws manga's electronic-sound balloon in SVG around its text: a ruled polygon with straight, slightly tilted edges, one corner clipped deep, one medium and the others barely, never an even octagon. Each balloon keeps its own cut. Its straight wedge tail points down-left at the source panel (screenshot crop, audio clip or text icon). Corners are mitred, never rounded. **The outline is the sentence's state:**
- round: at rest, or the model line
- burst (the same polygon with crackling edges, red while live): recording
- dashed: some words were heard unclearly

The `dim` variant applies screentone to neighbouring sentences in practice.

## Other components
- **Stamp:** a red double-ring score stamp, rotated by id. Attempts never disappear; they pile up (`Stamps`). The big stamp lands with a 260ms press.
- **Units:** scored words. Missed words are struck through in red ink, unclear ones get a dashed underline.
- **Chips:** labels are boxed 1px. Categories are black reversal plates. Filters are `aria-pressed` chips.
- **Buttons:** default (paper), `.primary` (ink), `.red` (record), `.ghost`, `.small`, `.icon`. Every button has hover, active, disabled and busy states.
- **Toolbar:** sticky. It turns into a black plate while there is a selection.
- **Notices, toasts and skeletons:** ink-framed. Errors use the red frame. Toasts offer Undo.

## Recordings: the cutting room

The recording editor (from jp-shadow-cut) lives on its own stock, a cold blue-grey newsprint (`--stock-recordings`).
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
