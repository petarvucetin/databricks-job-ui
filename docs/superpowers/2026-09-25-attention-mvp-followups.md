# Attention MVP follow-ups

Deferred findings from the task reviews and the final whole-branch review (branch attention-mvp). None blocks merge.

- Task 1: minor (deferred): three identical Sans files could be one @font-face with font-weight: 100 700.
- Task 1: minor (deferred): unstyled .shell wrapper div.
- Task 2: minor (deferred): hours are unpadded in dur/durLive (100h 05m) — by design.
- Task 3: minor (deferred): generateRuns() is one ~120-line function (plan-mandated port); refactor once prototype parity no longer matters.
- Task 4: minor (deferred): since has no upper bound (Number.isSafeInteger) — matters once live source takes client input.
- Task 5: minor (deferred): long single-line bodies in rowView.ts (plan-mandated formatting); no comment marking historyMarks LCG constants.
- Task 7: minor (deferred): no fall-back (25h) DST test; eslint-disable comments added around beforeAll/afterAll in timeline.test.ts — check why in final review.
- Task 7: minor (deferred): countByBucket is O(runs x buckets).
- Task 8: minor (deferred): out-of-range column/cube guards untested; report miscounted tests (7 not 9).
- Task 9: minor (deferred): RunRow click is mouse-only (no keyboard/role); 2 react/no-array-index-key warnings (fixed-order arrays); CHAIN_CLASS p->q naming.
- Task 10: minor (deferred): menu trigger lacks aria-haspopup/aria-expanded; search input has no aria-label.
- Task 11: minor (deferred): drag helper's local 'end' shadows the end prop; slider handles lack aria-valuemin/max/valuetext; unbound-method eslint-disable in Timeline.test.tsx.
- Task 12: minor (deferred): reference-label setting not synced across tabs.
- Task 13: minor (deferred): in the reference block the absolutely positioned "11" badge crowds the big NOW number.
- Ruling: final review Minor 2 remainder (React.memo rows, nowMs only to live rows, cap reset) and Minor 4 (badge from data.source, plan-mandated and true today) deferred — cost if wrong: re-render cost only with many 'more' clicks; badge wrong only once a live source exists.
- Parked — mock-run cache keeps one data set per tzOffset (up to 1681 keys) — Ruling: acceptable for the mock only (real clients send ~1-2 offsets); bound it or drop it when the live source lands — cost if wrong: memory growth if someone scripts many offsets against a mock deploy.
- Final: minor (deferred): DEFAULT_TZ_OFFSET_MIN duplicated in generateRuns.ts and mockRunSource.ts.
