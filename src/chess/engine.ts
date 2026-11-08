/**
 * Complete chess rules engine.
 *
 * Squares are indexed 0..63 with a1 = 0, h1 = 7, a8 = 56, h8 = 63
 * (index = rank * 8 + file).
 *
 * Implements: all piece movement, captures, pawn double-push, en passant,
 * promotion (to any piece), castling on both wings with full legality
 * checks, check / checkmate / stalemate detection, the fifty-move rule,
 * threefold repetition, insufficient material, SAN notation and FEN I/O.
 */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  readonly type: PieceType;
  readonly color: Color;
}

export const FLAG = {
  NORMAL: 0,
  CAPTURE: 1,
  DOUBLE: 2,
  EP: 4,
  CASTLE_K: 8,
  CASTLE_Q: 16,
  PROMO: 32,
} as const;

export interface Move {
  from: number;
  to: number;
  color: Color;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  flags: number;
}

export interface MoveRecord extends Move {
  san: string;
  /** Square of the captured piece (differs from `to` for en passant). */
  captureSquare?: number;
}

export type GameState =
  | 'active'
  | 'checkmate'
  | 'stalemate'
  | 'fifty-move'
  | 'repetition'
  | 'insufficient';

export interface GameStatus {
  state: GameState;
  check: boolean;
  turn: Color;
  /** Winner when state is checkmate. */
  winner?: Color;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const CR_WK = 1;
const CR_WQ = 2;
const CR_BK = 4;
const CR_BQ = 8;

export const fileOf = (sq: number): number => sq & 7;
export const rankOf = (sq: number): number => sq >> 3;
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function sqName(sq: number): string {
  return 'abcdefgh'[sq & 7] + String((sq >> 3) + 1);
}

export function parseSq(name: string): number {
  const f = name.charCodeAt(0) - 97;
  const r = name.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return r * 8 + f;
}

// ---------------------------------------------------------------------------
// Pre-computed attack tables
// ---------------------------------------------------------------------------

const KNIGHT_OFFSETS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_OFFSETS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
/** First four are orthogonal (rook) directions, last four diagonal (bishop). */
const DIRS = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

const KNIGHT_TARGETS: number[][] = [];
const KING_TARGETS: number[][] = [];
/** RAYS[sq][dir] = ordered list of squares walking from sq in direction dir. */
const RAYS: number[][][] = [];

for (let sq = 0; sq < 64; sq++) {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const inside = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;
  KNIGHT_TARGETS[sq] = KNIGHT_OFFSETS.filter(([dx, dy]) => inside(f + dx, r + dy)).map(
    ([dx, dy]) => (r + dy) * 8 + (f + dx),
  );
  KING_TARGETS[sq] = KING_OFFSETS.filter(([dx, dy]) => inside(f + dx, r + dy)).map(
    ([dx, dy]) => (r + dy) * 8 + (f + dx),
  );
  RAYS[sq] = DIRS.map(([dx, dy]) => {
    const ray: number[] = [];
    let x = f + dx;
    let y = r + dy;
    while (inside(x, y)) {
      ray.push(y * 8 + x);
      x += dx;
      y += dy;
    }
    return ray;
  });
}

/** Castling-right mask applied for any move touching a square. */
const CASTLE_MASK = new Array<number>(64).fill(15);
CASTLE_MASK[0] = 15 & ~CR_WQ;
CASTLE_MASK[7] = 15 & ~CR_WK;
CASTLE_MASK[4] = 15 & ~(CR_WK | CR_WQ);
CASTLE_MASK[56] = 15 & ~CR_BQ;
CASTLE_MASK[63] = 15 & ~CR_BK;
CASTLE_MASK[60] = 15 & ~(CR_BK | CR_BQ);

const PIECE_CACHE: Record<string, Piece> = {};
export function piece(type: PieceType, color: Color): Piece {
  const key = color + type;
  return (PIECE_CACHE[key] ??= Object.freeze({ type, color }));
}

interface Undo {
  move: Move;
  captured: Piece | null;
  capSq: number;
  castling: number;
  ep: number;
  halfmove: number;
  fullmove: number;
}

export class Chess {
  board: (Piece | null)[] = new Array(64).fill(null);
  turn: Color = 'w';
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  kings: Record<Color, number> = { w: -1, b: -1 };

  private stack: Undo[] = [];
  /** Public history (moves played via `play`). */
  history: MoveRecord[] = [];
  private keys: string[] = [];

  constructor(fen: string = START_FEN) {
    this.load(fen);
  }

  // -------------------------------------------------------------------------
  // FEN
  // -------------------------------------------------------------------------

  load(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error(`Invalid FEN: ${fen}`);
    this.board = new Array(64).fill(null);
    this.kings = { w: -1, b: -1 };
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error(`Invalid FEN board: ${parts[0]}`);
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (/\d/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toLowerCase() as PieceType;
        if (!'pnbrqk'.includes(type)) throw new Error(`Invalid FEN piece: ${ch}`);
        const sq = rank * 8 + file;
        this.board[sq] = piece(type, color);
        if (type === 'k') this.kings[color] = sq;
        file++;
      }
    }
    this.turn = parts[1] === 'b' ? 'b' : 'w';
    this.castling = 0;
    if (parts[2].includes('K')) this.castling |= CR_WK;
    if (parts[2].includes('Q')) this.castling |= CR_WQ;
    if (parts[2].includes('k')) this.castling |= CR_BK;
    if (parts[2].includes('q')) this.castling |= CR_BQ;
    this.ep = parts[3] === '-' ? -1 : parseSq(parts[3]);
    this.halfmove = parts[4] ? Number(parts[4]) : 0;
    this.fullmove = parts[5] ? Number(parts[5]) : 1;
    this.stack = [];
    this.history = [];
    this.keys = [this.positionKey()];
  }

  fen(): string {
    const rows: string[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[rank * 8 + file];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) row += empty;
        empty = 0;
        row += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let cr = '';
    if (this.castling & CR_WK) cr += 'K';
    if (this.castling & CR_WQ) cr += 'Q';
    if (this.castling & CR_BK) cr += 'k';
    if (this.castling & CR_BQ) cr += 'q';
    return [
      rows.join('/'),
      this.turn,
      cr || '-',
      this.ep >= 0 ? sqName(this.ep) : '-',
      this.halfmove,
      this.fullmove,
    ].join(' ');
  }

  /**
   * Key identifying a position for repetition purposes: placement, side to
   * move, castling rights and en-passant square (only when a capture is
   * actually possible).
   */
  positionKey(): string {
    const f = this.fen().split(' ');
    let ep = '-';
    if (this.ep >= 0 && this.moves().some((m) => m.flags & FLAG.EP)) ep = f[3];
    return `${f[0]} ${f[1]} ${f[2]} ${ep}`;
  }

  get(sq: number): Piece | null {
    return this.board[sq];
  }

  clone(): Chess {
    const c = new Chess();
    c.load(this.fen());
    return c;
  }

  // -------------------------------------------------------------------------
  // Attack detection
  // -------------------------------------------------------------------------

  isAttacked(sq: number, by: Color): boolean {
    const b = this.board;
    const f = fileOf(sq);
    // Pawns
    if (by === 'w') {
      if (f > 0 && sq - 9 >= 0) {
        const p = b[sq - 9];
        if (p && p.color === 'w' && p.type === 'p') return true;
      }
      if (f < 7 && sq - 7 >= 0) {
        const p = b[sq - 7];
        if (p && p.color === 'w' && p.type === 'p') return true;
      }
    } else {
      if (f > 0 && sq + 7 < 64) {
        const p = b[sq + 7];
        if (p && p.color === 'b' && p.type === 'p') return true;
      }
      if (f < 7 && sq + 9 < 64) {
        const p = b[sq + 9];
        if (p && p.color === 'b' && p.type === 'p') return true;
      }
    }
    for (const t of KNIGHT_TARGETS[sq]) {
      const p = b[t];
      if (p && p.color === by && p.type === 'n') return true;
    }
    for (const t of KING_TARGETS[sq]) {
      const p = b[t];
      if (p && p.color === by && p.type === 'k') return true;
    }
    const rays = RAYS[sq];
    for (let d = 0; d < 8; d++) {
      const ray = rays[d];
      for (let i = 0; i < ray.length; i++) {
        const p = b[ray[i]];
        if (!p) continue;
        if (p.color === by) {
          if (p.type === 'q') return true;
          if (d < 4 ? p.type === 'r' : p.type === 'b') return true;
        }
        break;
      }
    }
    return false;
  }

  inCheck(color: Color = this.turn): boolean {
    const k = this.kings[color];
    return k >= 0 && this.isAttacked(k, other(color));
  }

  // -------------------------------------------------------------------------
  // Move generation
  // -------------------------------------------------------------------------

  /** Pseudo-legal moves (may leave own king in check). */
  pseudoMoves(capturesOnly = false): Move[] {
    const moves: Move[] = [];
    const b = this.board;
    const us = this.turn;
    const them = other(us);

    const add = (from: number, to: number, type: PieceType, flags: number, captured?: PieceType) => {
      moves.push({ from, to, color: us, piece: type, flags, captured });
    };
    const addPawn = (from: number, to: number, flags: number, captured?: PieceType) => {
      const r = rankOf(to);
      if (r === 7 || r === 0) {
        for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) {
          moves.push({ from, to, color: us, piece: 'p', flags: flags | FLAG.PROMO, captured, promotion: promo });
        }
      } else {
        add(from, to, 'p', flags, captured);
      }
    };

    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || p.color !== us) continue;
      switch (p.type) {
        case 'p': {
          const dir = us === 'w' ? 8 : -8;
          const startRank = us === 'w' ? 1 : 6;
          const promoRank = us === 'w' ? 7 : 0;
          const one = sq + dir;
          if (!capturesOnly || rankOf(one) === promoRank) {
            if (one >= 0 && one < 64 && !b[one]) {
              addPawn(sq, one, FLAG.NORMAL);
              const two = one + dir;
              if (!capturesOnly && rankOf(sq) === startRank && !b[two]) add(sq, two, 'p', FLAG.DOUBLE);
            }
          }
          const f = fileOf(sq);
          for (const df of [-1, 1]) {
            if (f + df < 0 || f + df > 7) continue;
            const t = one + df;
            if (t < 0 || t >= 64) continue;
            const target = b[t];
            if (target && target.color === them) addPawn(sq, t, FLAG.CAPTURE, target.type);
            else if (t === this.ep) add(sq, t, 'p', FLAG.CAPTURE | FLAG.EP, 'p');
          }
          break;
        }
        case 'n':
        case 'k': {
          const targets = p.type === 'n' ? KNIGHT_TARGETS[sq] : KING_TARGETS[sq];
          for (const t of targets) {
            const target = b[t];
            if (!target) {
              if (!capturesOnly) add(sq, t, p.type, FLAG.NORMAL);
            } else if (target.color === them) add(sq, t, p.type, FLAG.CAPTURE, target.type);
          }
          if (p.type === 'k' && !capturesOnly) this.genCastles(sq, add);
          break;
        }
        default: {
          const d0 = p.type === 'b' ? 4 : 0;
          const d1 = p.type === 'r' ? 4 : 8;
          for (let d = d0; d < d1; d++) {
            for (const t of RAYS[sq][d]) {
              const target = b[t];
              if (!target) {
                if (!capturesOnly) add(sq, t, p.type, FLAG.NORMAL);
                continue;
              }
              if (target.color === them) add(sq, t, p.type, FLAG.CAPTURE, target.type);
              break;
            }
          }
        }
      }
    }
    return moves;
  }

  private genCastles(
    sq: number,
    add: (from: number, to: number, type: PieceType, flags: number) => void,
  ): void {
    const us = this.turn;
    const them = other(us);
    const b = this.board;
    const home = us === 'w' ? 4 : 60;
    if (sq !== home) return;
    const kRight = us === 'w' ? CR_WK : CR_BK;
    const qRight = us === 'w' ? CR_WQ : CR_BQ;
    if (!(this.castling & (kRight | qRight))) return;
    if (this.isAttacked(home, them)) return;
    const rook = (s: number) => {
      const p = b[s];
      return p && p.type === 'r' && p.color === us;
    };
    if (this.castling & kRight && !b[home + 1] && !b[home + 2] && rook(home + 3)) {
      if (!this.isAttacked(home + 1, them) && !this.isAttacked(home + 2, them)) {
        add(home, home + 2, 'k', FLAG.CASTLE_K);
      }
    }
    if (this.castling & qRight && !b[home - 1] && !b[home - 2] && !b[home - 3] && rook(home - 4)) {
      if (!this.isAttacked(home - 1, them) && !this.isAttacked(home - 2, them)) {
        add(home, home - 2, 'k', FLAG.CASTLE_Q);
      }
    }
  }

  /** All fully legal moves for the side to move. */
  moves(capturesOnly = false): Move[] {
    const us = this.turn;
    const legal: Move[] = [];
    for (const m of this.pseudoMoves(capturesOnly)) {
      this.make(m);
      if (!this.isAttacked(this.kings[us], other(us))) legal.push(m);
      this.unmake();
    }
    return legal;
  }

  movesFrom(sq: number): Move[] {
    return this.moves().filter((m) => m.from === sq);
  }

  // -------------------------------------------------------------------------
  // Make / unmake (fast, internal; used by search and legality checks)
  // -------------------------------------------------------------------------

  make(m: Move): void {
    const b = this.board;
    const us = m.color;
    const moving = b[m.from]!;
    let capSq = m.to;
    if (m.flags & FLAG.EP) capSq = m.to + (us === 'w' ? -8 : 8);
    const captured = b[capSq];
    this.stack.push({
      move: m,
      captured,
      capSq,
      castling: this.castling,
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
    });

    b[capSq] = null;
    b[m.from] = null;
    b[m.to] = m.promotion ? piece(m.promotion, us) : moving;

    if (m.flags & FLAG.CASTLE_K) {
      b[m.to - 1] = b[m.to + 1];
      b[m.to + 1] = null;
    } else if (m.flags & FLAG.CASTLE_Q) {
      b[m.to + 1] = b[m.to - 2];
      b[m.to - 2] = null;
    }
    if (moving.type === 'k') this.kings[us] = m.to;

    this.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
    this.ep = m.flags & FLAG.DOUBLE ? (m.from + m.to) >> 1 : -1;
    this.halfmove = moving.type === 'p' || captured ? 0 : this.halfmove + 1;
    if (us === 'b') this.fullmove++;
    this.turn = other(us);
  }

  unmake(): Move | null {
    const u = this.stack.pop();
    if (!u) return null;
    const m = u.move;
    const b = this.board;
    const us = m.color;
    b[m.from] = m.promotion ? piece('p', us) : b[m.to];
    b[m.to] = null;
    b[u.capSq] = u.captured;
    if (m.flags & FLAG.CASTLE_K) {
      b[m.to + 1] = b[m.to - 1];
      b[m.to - 1] = null;
    } else if (m.flags & FLAG.CASTLE_Q) {
      b[m.to - 2] = b[m.to + 1];
      b[m.to + 1] = null;
    }
    if (m.piece === 'k') this.kings[us] = m.from;
    this.castling = u.castling;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
    this.fullmove = u.fullmove;
    this.turn = us;
    return m;
  }

  // -------------------------------------------------------------------------
  // Public game API
  // -------------------------------------------------------------------------

  /** Finds the legal move matching from/to(/promotion). */
  findMove(from: number, to: number, promotion?: PieceType): Move | undefined {
    return this.moves().find(
      (m) => m.from === from && m.to === to && (!m.promotion || m.promotion === (promotion ?? 'q')),
    );
  }

  /** Plays a legal move and records it in history. */
  play(m: Move): MoveRecord {
    const legal = this.moves();
    const match = legal.find(
      (x) => x.from === m.from && x.to === m.to && x.promotion === m.promotion,
    );
    if (!match) throw new Error(`Illegal move ${sqName(m.from)}${sqName(m.to)}`);
    const san = this.san(match, legal);
    const record: MoveRecord = { ...match, san };
    if (match.flags & FLAG.CAPTURE) {
      record.captureSquare = match.flags & FLAG.EP ? match.to + (match.color === 'w' ? -8 : 8) : match.to;
    }
    this.make(match);
    this.history.push(record);
    this.keys.push(this.positionKey());
    return record;
  }

  /** Plays a move given in SAN (e.g. "Nf3", "O-O", "exd8=Q+"). */
  playSan(san: string): MoveRecord {
    const clean = san.replace(/[+#?!]/g, '');
    const legal = this.moves();
    const m = legal.find((x) => this.san(x, legal).replace(/[+#]/g, '') === clean);
    if (!m) throw new Error(`Illegal SAN move: ${san}`);
    return this.play(m);
  }

  /** Takes back the last move played via `play`. */
  undo(): MoveRecord | null {
    const rec = this.history.pop();
    if (!rec) return null;
    this.unmake();
    this.keys.pop();
    return rec;
  }

  san(m: Move, legal: Move[] = this.moves()): string {
    let s: string;
    if (m.flags & FLAG.CASTLE_K) s = 'O-O';
    else if (m.flags & FLAG.CASTLE_Q) s = 'O-O-O';
    else {
      const capture = (m.flags & FLAG.CAPTURE) !== 0;
      if (m.piece === 'p') {
        s = (capture ? 'abcdefgh'[fileOf(m.from)] + 'x' : '') + sqName(m.to);
        if (m.promotion) s += '=' + m.promotion.toUpperCase();
      } else {
        const rivals = legal.filter(
          (x) => x.piece === m.piece && x.to === m.to && x.from !== m.from && !x.promotion,
        );
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some((x) => fileOf(x.from) === fileOf(m.from));
          const sameRank = rivals.some((x) => rankOf(x.from) === rankOf(m.from));
          if (!sameFile) dis = 'abcdefgh'[fileOf(m.from)];
          else if (!sameRank) dis = String(rankOf(m.from) + 1);
          else dis = sqName(m.from);
        }
        s = m.piece.toUpperCase() + dis + (capture ? 'x' : '') + sqName(m.to);
      }
    }
    this.make(m);
    if (this.inCheck()) s += this.moves().length === 0 ? '#' : '+';
    this.unmake();
    return s;
  }

  isInsufficientMaterial(): boolean {
    const minors: { type: PieceType; color: Color; sq: number }[] = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (!p || p.type === 'k') continue;
      if (p.type === 'p' || p.type === 'r' || p.type === 'q') return false;
      minors.push({ type: p.type, color: p.color, sq });
    }
    if (minors.length <= 1) return true;
    // Only bishops, all on the same square colour -> no mate possible.
    if (minors.every((m) => m.type === 'b')) {
      const shade = (sq: number) => (fileOf(sq) + rankOf(sq)) & 1;
      const s0 = shade(minors[0].sq);
      return minors.every((m) => shade(m.sq) === s0);
    }
    return false;
  }

  isThreefoldRepetition(): boolean {
    const current = this.keys[this.keys.length - 1];
    let count = 0;
    for (const k of this.keys) if (k === current) count++;
    return count >= 3;
  }

  status(): GameStatus {
    const check = this.inCheck();
    const hasMoves = this.moves().length > 0;
    const turn = this.turn;
    if (!hasMoves) {
      return check
        ? { state: 'checkmate', check, turn, winner: other(turn) }
        : { state: 'stalemate', check, turn };
    }
    if (this.isInsufficientMaterial()) return { state: 'insufficient', check, turn };
    if (this.halfmove >= 100) return { state: 'fifty-move', check, turn };
    if (this.isThreefoldRepetition()) return { state: 'repetition', check, turn };
    return { state: 'active', check, turn };
  }

  /** Counts leaf nodes to the given depth (move generator verification). */
  perft(depth: number): number {
    if (depth === 0) return 1;
    const moves = this.moves();
    if (depth === 1) return moves.length;
    let n = 0;
    for (const m of moves) {
      this.make(m);
      n += this.perft(depth - 1);
      this.unmake();
    }
    return n;
  }
}
