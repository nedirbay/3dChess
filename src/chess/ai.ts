import { Chess, FLAG, type Move, type PieceType } from './engine';

/**
 * A compact alpha-beta searcher with iterative deepening, quiescence search,
 * MVV-LVA move ordering and piece-square-table evaluation.
 */

export type Difficulty = 'novice' | 'adept' | 'archmage';

export const DIFFICULTY: Record<Difficulty, { depth: number; timeMs: number; noise: number }> = {
  novice: { depth: 1, timeMs: 300, noise: 90 },
  adept: { depth: 3, timeMs: 900, noise: 12 },
  archmage: { depth: 6, timeMs: 2200, noise: 0 },
};

const VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables, written from White's perspective with a8 first.
const PST: Record<PieceType, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

const MATE = 100000;

/** Static evaluation from the side-to-move's perspective. */
export function evaluate(c: Chess): number {
  let score = 0;
  let nonPawn = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = c.board[sq];
    if (p && p.type !== 'p' && p.type !== 'k') nonPawn += VALUE[p.type];
  }
  const endgame = nonPawn <= 2600;
  for (let sq = 0; sq < 64; sq++) {
    const p = c.board[sq];
    if (!p) continue;
    const r = sq >> 3;
    const f = sq & 7;
    const idx = p.color === 'w' ? (7 - r) * 8 + f : r * 8 + f;
    const table = p.type === 'k' && endgame ? KING_END : PST[p.type];
    const v = VALUE[p.type] + table[idx];
    score += p.color === 'w' ? v : -v;
  }
  return c.turn === 'w' ? score : -score;
}

function orderScore(m: Move, pv?: Move): number {
  if (pv && m.from === pv.from && m.to === pv.to && m.promotion === pv.promotion) return 1e6;
  let s = 0;
  if (m.flags & FLAG.CAPTURE) s += 10 * VALUE[m.captured ?? 'p'] - VALUE[m.piece] + 1000;
  if (m.promotion) s += VALUE[m.promotion] + 800;
  return s;
}

class Timeout extends Error {}

export interface SearchResult {
  move: Move | null;
  score: number;
  depth: number;
  nodes: number;
}

export function search(fen: string, difficulty: Difficulty, rng: () => number = Math.random): SearchResult {
  const cfg = DIFFICULTY[difficulty];
  const c = new Chess(fen);
  const deadline = performance.now() + cfg.timeMs;
  let nodes = 0;

  const quiesce = (alpha: number, beta: number, qdepth: number): number => {
    nodes++;
    const stand = evaluate(c);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qdepth <= 0) return alpha;
    const caps = c.moves(true).sort((a, b) => orderScore(b) - orderScore(a));
    for (const m of caps) {
      c.make(m);
      const score = -quiesce(-beta, -alpha, qdepth - 1);
      c.unmake();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const negamax = (depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
    if (depth <= 0) return quiesce(alpha, beta, 6);
    const moves = c.moves();
    if (moves.length === 0) return c.inCheck() ? -MATE + ply : 0;
    if (c.halfmove >= 100) return 0;
    moves.sort((a, b) => orderScore(b) - orderScore(a));
    for (const m of moves) {
      c.make(m);
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      c.unmake();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const rootMoves = c.moves();
  if (rootMoves.length === 0) return { move: null, score: 0, depth: 0, nodes };

  let best: Move = rootMoves[0];
  let bestScore = -Infinity;
  let completed = 0;

  for (let depth = 1; depth <= cfg.depth; depth++) {
    try {
      const scored: { m: Move; s: number }[] = [];
      rootMoves.sort((a, b) => orderScore(b, best) - orderScore(a, best));
      let alpha = -Infinity;
      for (const m of rootMoves) {
        c.make(m);
        // With noise we need exact-ish scores for every root move, so use a full window.
        const window = cfg.noise > 0 ? -Infinity : alpha;
        const s = -negamax(depth - 1, -Infinity, -window, 1);
        c.unmake();
        scored.push({ m, s });
        if (s > alpha) alpha = s;
      }
      const noisy = scored.map(({ m, s }) => ({ m, s: s + (rng() * 2 - 1) * cfg.noise }));
      noisy.sort((a, b) => b.s - a.s);
      best = noisy[0].m;
      bestScore = scored.find((x) => x.m === best)!.s;
      completed = depth;
      if (Math.abs(bestScore) > MATE - 100) break;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      // Restore the board: unwind any partially made moves.
      while (c.unmake()) {
        /* unwind */
      }
      break;
    }
    if (performance.now() > deadline) break;
  }
  return { move: best, score: bestScore, depth: completed, nodes };
}
