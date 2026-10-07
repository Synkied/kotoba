---
version: 1
slug: "frontend-src-pages-cleanup-tsx"
primary_target: "frontend/src/pages/Cleanup.tsx"
related_targets: ["frontend/src/styles/app.css"]
---

# Recording editor

Scope: recording detail in `frontend/src/pages/Cleanup.tsx`, with its styles in `frontend/src/styles/app.css`. Mode: Operate. Desktop side-by-side editing is the priority; tablet and phone retain a visible waveform and transport.

The learner listens to a recording, seeks from the transcript or script, adjusts suggested and manual cuts, auditions the result, and renders a clean take. The editor must support that loop without scrolling between text and waveform. Preserve script drafts when analysis settings open. Follow playback is optional; filters change visibility, not whether a cut applies.

## Direction contract

THESIS: One continuous audio editing workspace keeps hearing and reading together.

OWN-WORLD: Inherit kotoba's weekly manga magazine: recordings' cold blue-grey newsprint, ink frames, paper controls, Japanese lettering, screentone cut types and red pencil for manual cuts. DESIGN.md and existing tokens remain authoritative.

STORY: Listen → seek from transcript → select and adjust cuts → audition result → render.

FIRST VIEWPORT: Compact title, autosave summary and Actions menu above transcript/script and cuts side by side; waveform, transport and selected-cut controls docked below. At ≤900px show one Transcript / Script / Cuts pane. Short phones keep cut navigation and labelled icon actions horizontally together; waveform height adapts.

FORM: Existing weekly manga magazine form and seed key 2a3ca589, inherited rather than reassigned. Signature interaction: text and cut selection seek or reveal the relevant waveform region while playback stays within reach.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verification evidence

Baseline: `/tmp/kotoba-ui-check/recording-before.png`. Review captures: `.impeccable/review/recording-editor/`. Check desktop, laptop, tablet, phone, short viewports and light/dark themes; confirm independent pane scrolling and accessible compact controls. Final verdict belongs to the finish review.
