# Poker Training — Recreation Notes

Notes from playing 247freepoker.com to use as a v1 base for the training site.

## Game Type
- **Texas Hold'em**, single table, 5 seats (You + 4 named AI bots: Einstein, Grace, Ada, Hedy).
- $1 / $2 blinds, $1,000 starting stack for every seat.
- Dealer button rotates clockwise each hand; blinds posted automatically.
- Persistent save: on reload, dialog offers **Resume** (current stacks + difficulty) or **New Game**.

## Match Flow
1. Landing page → **PLAY** / **GAMES** / **Record** (high score).
2. Resume dialog (if save exists) → New Game or Resume.
3. **Select a Level** carousel — single difficulty visible at a time, left/right arrows to change. Observed level: **Expert** (others likely Easy / Medium / Hard).
4. Table view begins; hands deal automatically and proceed until **( Press anywhere to continue )** prompt between hands.
5. Showdown screen shows winner, hand name (e.g. "2 Pair"), **"Big Win!" $X** banner, plus the 5 board cards with the **winning two** highlighted and losing cards dimmed.
6. **Record** ($ high-water mark) updates after each hand.

## Per-Hand Sequence (matches standard Hold'em)
- Deal hole cards → preflop betting.
- Flop (3 cards) → betting.
- Turn (4th card) → betting.
- River (5th card) → betting.
- Showdown OR last-player-standing.

## Action UI
Three buttons fixed at the bottom of the screen, label changes by context:
- **Fold** | **Call** / **Check** (auto-swaps based on whether there's a bet to call) | **Raise**.
- **Raise** opens a horizontal **slider** with current bet amount in a tooltip above the handle, a back arrow on the left to cancel, and **OK** on the right to confirm.
- Slider min appears to be a min-raise increment; max is your stack (all-in).

## Table Layout (top-down)
```
              [chip stack]
              [pot $X]
 [Einstein]                [Grace]
   cards                    cards
   stack                    stack
   chips                    chips

 [Ada]      [You + cards]     [Hedy + D]
   stack    stack             stack
   chips    chips             chips

            [ Fold | Call/Check | Raise ]
```
- Each seat shows: name plate, stack in red banner, two face-down cards (face-up for You), per-player chip stack, and a speech bubble for their last action ("Call", "Check", "Fold", "Raise $14").
- **D** chip marks the dealer.
- Pot total is shown above the community-card row.
- Community cards appear horizontally in the middle as each street deals.

## Visual / Audio Cues
- Speech bubbles linger so you can read each opponent's last action.
- A sound toggle (speaker icon) sits top-right; mute persists.
- Chips animate from player → pot when a bet is committed.
- A subtle dashed ring highlights whose turn it is (visible around "You" while acting).
- Showdown dims folded cards and the dead community cards; the 2 cards that make the winning hand pop.

## Minimal MVP Feature List (port targets)
1. **Card / deck model**: 52-card deck, shuffle, deal hole + 5 board.
2. **Hand evaluator** (5-of-7 best). Pure function so it can be unit-tested.
3. **Betting engine**: post blinds, action order, min-raise rule, side pots, all-in.
4. **State machine** per hand: PreFlop → Flop → Turn → River → Showdown.
5. **Table renderer**: seats, chips, pot, board, hole cards, dealer button, turn indicator, speech bubbles.
6. **Action bar**: Fold / Check-Call / Raise + bet-sizing slider with min-raise / pot / all-in shortcuts.
7. **Bot opponents**: name + avatar + a pluggable decision function (start dead-simple: tight call/check, raise on top pair+).
8. **Hand-end overlay**: hand name, winner, pot $, winning-card highlights, "press anywhere to continue".
9. **Persistence**: localStorage for stacks, difficulty, and high-score (their "Record").
10. **Difficulty levels**: swap the bot decision functions per level.

## Things 247freepoker.com Does NOT Have (training-site upgrades to add)
- No coaching / equity feedback — every hand is silent.
- No hand-history review.
- No GTO or range-based hints.
- No "show what would have happened if you'd folded/called/raised" replay.
- No spot trainer (preflop chart drill, river decision drill, etc.).
- No hand-strength meter while playing.
- No notes per opponent.

These are the natural differentiators for a *training* site versus a casual recreation.

## Recommended v1 Build Order
1. Deck + hand evaluator (pure, tested).
2. Headless betting engine + state machine.
3. Static table UI rendering a fixed game state.
4. Wire UI to engine; play through one full hand vs. one dummy bot.
5. Add 3 more bots + difficulty slot.
6. Bet-sizing slider + showdown overlay + persistence.
7. Layer in the first training feature (suggested: post-hand equity readout — "you had 38% equity on the turn").

## Stack / Naming Conventions Worth Stealing
- Friendly named bots beat "Player 2 / Player 3" for engagement.
- Red banner under cards for stack, yellow banner for "You" — instantly readable.
- Single high-score number ("Record") gives a long-term goal with zero ceremony.
