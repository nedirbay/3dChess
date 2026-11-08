# Wizard's Chess 3D

A playable 3D wizard's chess duel set inside a dark Gothic cathedral. Marble and
obsidian pieces breathe, march, strike and shatter. The game follows the full
FIDE rules and has a minimalist Material Design 3 interface.

## Features

- **Full chess rules**: legal move generation, check, checkmate, stalemate,
  castling on both sides (it cannot pass through, start in or land in check),
  en passant, promotion to any piece, threefold repetition, the fifty-move
  rule and insufficient material. Moves are recorded in SAN. Perft tests check
  the move generator against standard reference positions.
- **32 sculpted pieces**: veined white marble against glossy iridescent
  obsidian. Each piece has a gold or violet arcane accent.
- **Per-piece animations**
  - *Idle*: pawns bob, knights nod and shift their weight, bishops sway,
    rooks breathe, queens levitate and scan the board, kings turn slowly.
  - *Move*: pawns and rooks march in small hops, bishops glide, knights leap
    in an arc, and the queen and king float.
  - *Attack*: pawns thrust like a spear, knights rear and stamp, bishops
    cleave sideways, rooks rise and ground-pound with a shockwave, queens spin
    and fire an arcane bolt, kings smite overhead.
  - *Shatter*: the victim's own mesh splits into Voronoi-clustered shards.
    The shards fly apart, bounce off the board and the dais, and fade away
    with sparks, dust and a flash of light. A checkmated king shatters, and a
    resigning king topples over.
- **Gothic cathedral**: clustered pillars, pointed arcades, rib vaults,
  stained-glass lancets, two rose windows with light shafts, flickering
  candelabra, drifting dust motes, fog and bloom.
- **Wizard AI**: alpha-beta search with iterative deepening and quiescence,
  running in a Web Worker. There are three strengths: Novice, Adept and
  Archmage. A local two-player mode is also available.
- **Single-level navigation**: one navigation rail (a bottom bar on phones)
  with four destinations: Play, Moves, Settings and Rules. Each opens one
  sheet. Material 3 segmented buttons, switches, dialogs and a snackbar.
- Sound effects are synthesized live with Web Audio, with a cathedral reverb.
  The project needs no external assets because all textures are generated
  procedurally.

## Controls

| Action | Input |
| --- | --- |
| Select / move | Click a piece, then a highlighted square |
| Orbit / zoom | Drag / scroll or pinch |
| Undo | `Ctrl`+`Z` |
| New game | `N` |
| Flip view | `F` |
| Deselect / close panel | `Esc` |

## Development

```bash
npm install
npm run dev        # start the dev server
npm test           # rules + AI tests (perft, castling, en passant, mates, draws)
npm run build      # type-check and build to dist/
```

## Project layout

```
src/
  chess/engine.ts      rules engine (move gen, make/unmake, SAN, FEN, game status)
  chess/ai.ts          alpha-beta search + evaluation
  chess/ai.worker.ts   runs the search off the main thread
  scene/stage.ts       renderer, camera, lighting, bloom, camera moves
  scene/cathedral.ts   procedural Gothic architecture, candles, light shafts
  scene/board.ts       board slab, square highlights, move markers
  scene/pieceFactory.ts  piece geometry and marble / obsidian materials
  scene/pieceView.ts   per-piece idle, move, attack and destruction animations
  scene/boardView.ts   choreographs moves, captures, castling, promotion
  scene/effects.ts     shatter physics, sparks, dust, shockwaves, flashes
  game/game.ts         game controller (input, flow, AI, undo, game over)
  ui/ui.ts             Material 3 interface
```
