# Poker Training — house style

A casual recreation of 247freepoker.com, slowly evolving into a poker *training*
tool. Single-table No-Limit Hold'em vs. AI bots. Pure client-side; no backend yet.

## Stack
- TypeScript (strict, `noUncheckedIndexedAccess` on) + Vite + Vitest.
- Vanilla DOM rendering, hand-rolled CSS with design tokens (`src/styles/tokens.css`).
- No framework, no UI library, no CSS framework. If we reach for one, we lost.
- `localStorage` is the only persistence layer for now.

## Layout
```
src/
  engine/       pure poker logic — no DOM, no I/O, no globals
                (incl. equity.ts Monte-Carlo/exact equity, odds.ts pot-odds/EV math,
                 positions.ts blind/position derivation)
  bots/         AI personalities; each is `(ctx) => Action`. skill.ts maps the
                1-10 difficulty to a SkillProfile the bot reads.
  analysis/     hand recording + leak detection. recorder.ts snapshots each
                decision (external observer over getState — engine stays pure),
                record.ts is the immutable HandRecord, decision.ts grades each
                decision, leaks.ts flags mistakes, stats.ts aggregates HUD stats,
                index.ts exposes analyzeHand().
  ui/           DOM rendering + event wiring (table, setup, dashboard, replay,
                analysisPanel)
  persistence/  thin localStorage wrappers (save.ts = config/stacks/record,
                history.ts = capped 1000-hand ring buffer)
  styles/       design tokens + hand-rolled CSS
tests/          vitest; covers engine + analysis end-to-end (unit + integration)
```

## House rules
- **Engine is pure.** No `window`, no `Math.random` outside the seeded RNG, no
  DOM imports. Bots receive a `BotView` struct, not the full state, so they
  can't cheat by reading opponents' hole cards.
- **Comments explain *why*.** Not what — names should already say what. A
  comment that just restates the next line gets deleted on sight.
- **Functions stay short.** Aim for under 30 lines. If a function grows past
  that, extract a named helper instead of adding sub-sections via blank lines.
- **Types are load-bearing.** `noUncheckedIndexedAccess` is on, so array
  access returns `T | undefined`. Handle the `undefined` — don't `as T!` it
  away unless you've just bounds-checked.
- **No `any` outside test fixtures.** Prefer `unknown` and narrow.
- **Integration-first testing.** The evaluator and betting engine get unit
  tests because they're combinatorial. Everything else gets covered by a
  smoke test that plays a full deterministic hand.
- **No late reflows.** Theme/sound prefs resolve in a pre-paint script in
  `index.html` so the first frame is correct.

## Anti-patterns to avoid
- `window.confirm()` / `alert()` — use the in-game overlay component.
- Direct `localStorage.setItem` outside `persistence/`. The persistence layer
  is the single chokepoint.
- "Just store this on the player object" — engine state is the source of
  truth; the UI subscribes, never the other way around.
- Side effects inside reducers / state transitions.
- Animations that block input. Action UI must be responsive even mid-deal.

## In v2 (the training layer)
- Configurable table: 2-9 players, difficulty 1-10.
- Watch the runout after folding (spectate). Cards stay hidden during play; at
  hand end showdown hands auto-reveal and each folded seat gets a per-player
  "Reveal cards" button (no session-wide reveal toggle).
- Every hand recorded, graded, and leak-checked. Per-hand coaching panel
  ("you had no business there", "won on a fold not merit", "false security"),
  lifetime HUD stats + archetype, and a hand-history browser with review.

## Not yet (intentional)
- Multi-table, networking, tournament structures.
- Full GTO/solver EV-loss vs ranges (we lead with exact hindsight-vs-actual
  equity + a heuristic decision grade; range modelling is a future upgrade).
- Accounts, auth, server.
