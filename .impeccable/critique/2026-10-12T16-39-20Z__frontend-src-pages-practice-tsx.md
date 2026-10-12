---
target: practice take playback UI
total_score: 21
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 2
target_identity: "file:/projects/kotoba/frontend/src/pages/Practice.tsx"
target_fingerprint: "sha256:4751b2af7130df7cfbbbd2639d384b4597b7e2cf4d18cb57726e84dd9435c301"
target_path: /projects/kotoba/frontend/src/pages/Practice.tsx
timestamp: 2026-10-12T16-39-20Z
slug: frontend-src-pages-practice-tsx
---
# Critique: practice take playback (take-bar, KeptTakes)

Method: dual-agent (A: design review · B: detector + browser)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 2 | Compare shows only "Stop"; no "model… now you" signal |
| 2 | Match real world | 3 | "Compare" doesn't say model then you |
| 3 | User control | 2 | Playback keeps running into the next recording; letting a kept take go has no Undo |
| 4 | Consistency | 2 | "my take"/"Hear it"/"Your take"; aria-pressed on actions; no pressed fill |
| 5 | Error prevention | 2 | Own playback can be recorded; new take sits above the old score |
| 6 | Recognition | 3 | Visible labels; 11-key list near the limit |
| 7 | Flexibility | 3 | M/C/K shortcuts |
| 8 | Minimalist | 2 | 6-9 actions after a take; kept takes repeat stamps |
| 9 | Error recovery | 2 | Playback errors appear in the other column |
| 10 | Help | n/a | Operate mode, tooltips enough |
| Total | | 21/36 | Acceptable (58%) |

Priority issues:
- [P0] take-bar CSS not loaded: rules only in the unimported styles/pages/practice.css (CSS split in progress); bars render unstyled.
- [P1] Playback bleeds into the next recording: hush() doesn't stopAudio(); startRec doesn't either.
- [P1] On phones the take is out of reach after a failed take: score slot is below the stage and only scrolls in on a fresh score.
- [P2] Take-bar sits above the stamp: pushes the stamp's moment down, separates Compare from Missed.
- [P2] Kept takes are a parallel list with weak names ("82 · 3 days ago"); stamps should be playable.
Minor: duplicated feedback-label rule; no pressed fill; aria-pressed + changing label; layout jump while recording; cap of 3 with no "+N".
