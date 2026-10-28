---
target: chat page
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/projects/kotoba/frontend/src/pages/Chat.tsx"
target_fingerprint: "sha256:45e958c09bb433e628c5de505ce52dd699190b020ab222d4ff181bb3f1ad4139"
target_path: /projects/kotoba/frontend/src/pages/Chat.tsx
timestamp: 2026-10-28T19-20-28Z
slug: frontend-src-pages-chat-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "is writing" + spinner clear; no progress for slow local models |
| 2 | Match System / Real World | 2 | raw model name ("From the environment is writing"); readings as parentheses |
| 3 | User Control and Freedom | 2 | no Stop; New chat wipes with no undo |
| 4 | Consistency and Standards | 3 | Japanese at 16px broke the Sentence Rule; phone × covered thumbnails |
| 5 | Error Prevention | 2 | silent 8000-char truncation; Enter sends on phones (no newline) |
| 6 | Recognition Rather Than Recall | 3 | hint hidden on phones |
| 7 | Flexibility and Efficiency | 2 | no copy / keep / lookup on replies |
| 8 | Aesthetic and Minimalist Design | 3 | calm; empty state sparse |
| 9 | Error Recovery | 3 | Try again keeps the turn |
| 10 | Help and Documentation | 2 | one hint line, none on phones |
| **Total** | | **25/40** | Acceptable |

## Design Specificity
In-world frame (hairlines, wash, square ink controls, no burgundy misuse) but category-generic content: Japanese replies were not treated as kotoba sentences (no Sentence Rule, no lookup, no keep). Detector: CLI clean; browser: one straggler in the empty-state intro; monotonous-spacing is app-wide (also on /words, /notes), a false positive here. Contrast ≥6.7:1, focus visible on every control, targets ≥24px.

## Priority Issues
- [P1] Full-width replies at unreadable measure; Japanese undersized. Fix: cap reply prose at 46rem, Japanese paragraphs by the Sentence Rule.
- [P1] No Stop; New chat destructive. Fix: Stop in place of Send, Ask again; Undo toast.
- [P1] Chat is an island. Fix: word lookup on Japanese, Copy, Keep the Japanese to the Inbox.
- [P2] Phone composer: 44px × over 72px thumbnails, grown field hides the conversation, Enter can't break a line. Fix: 24px mark with 44px hit area, 6rem cap, ResizeObserver, Enter breaks lines on coarse pointers.
- [P2] Noisy aria-live on the whole log. Fix: hidden status line.

## Persona Red Flags
- Learner on a phone: no newline, hint hidden, thumbnails covered, no lookup.
- Power user: no stop, no copy/keep, no undo.
- First-timer: "From the environment" reads like a bug; one click on New chat erases everything.

## Minor
Auto-scroll yanks readers who scrolled up; image limit only in a tooltip; duplicate privacy copy; intro straggler.
