import { describe, expect, it } from 'vitest';
import { Chess, START_FEN, parseSq } from '../src/chess/engine';

// Reference perft counts from https://www.chessprogramming.org/Perft_Results
const PERFT: [string, string, number[]][] = [
  ['start', START_FEN, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];

describe('perft', () => {
  for (const [name, fen, counts] of PERFT) {
    counts.forEach((expected, i) => {
      it(`${name} depth ${i + 1} = ${expected}`, () => {
        expect(new Chess(fen).perft(i + 1)).toBe(expected);
      });
    });
  }
});

describe('rules', () => {
  it('detects fool\'s mate', () => {
    const c = new Chess();
    for (const s of ['f3', 'e5', 'g4', 'Qh4#']) c.playSan(s);
    const st = c.status();
    expect(st.state).toBe('checkmate');
    expect(st.winner).toBe('b');
    expect(c.history.at(-1)!.san).toBe('Qh4#');
  });

  it('castles both sides and forbids castling through check', () => {
    const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const sans = c.moves().map((m) => c.san(m));
    expect(sans).toContain('O-O');
    expect(sans).toContain('O-O-O');
    c.playSan('O-O');
    expect(c.get(parseSq('g1'))?.type).toBe('k');
    expect(c.get(parseSq('f1'))?.type).toBe('r');
    // f8 attacked by rook on f1 -> black may only castle queenside
    const blackSans = c.moves().map((m) => c.san(m));
    expect(blackSans).not.toContain('O-O');
    expect(blackSans).toContain('O-O-O');
    c.undo();
    expect(c.fen()).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  });

  it('cannot castle out of check or after rook moved', () => {
    const c = new Chess('r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1');
    expect(c.moves().some((m) => m.piece === 'k' && Math.abs(m.to - m.from) === 2)).toBe(false);
    const d = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    d.playSan('Rh2');
    d.playSan('Ke7');
    d.playSan('Rh1');
    d.playSan('Ke8');
    expect(d.moves().map((m) => d.san(m))).not.toContain('O-O');
    expect(d.moves().map((m) => d.san(m))).toContain('O-O-O');
  });

  it('handles en passant', () => {
    const c = new Chess();
    for (const s of ['e4', 'a6', 'e5', 'd5']) c.playSan(s);
    const rec = c.playSan('exd6');
    expect(rec.captureSquare).toBe(parseSq('d5'));
    expect(c.get(parseSq('d5'))).toBeNull();
  });

  it('promotes with SAN and disambiguates', () => {
    const c = new Chess('8/P7/8/8/8/8/k7/4K2N w - - 0 1');
    const rec = c.playSan('a8=N');
    expect(c.get(parseSq('a8'))?.type).toBe('n');
    expect(rec.san).toBe('a8=N');
    const d = new Chess('8/2k5/8/R7/8/8/4K3/R6R w - - 0 1');
    expect(d.moves().map((m) => d.san(m))).toContain('Rad1');
    expect(d.moves().map((m) => d.san(m))).toContain('R1a3');
    expect(d.moves().map((m) => d.san(m))).toContain('R5a3');
  });

  it('detects stalemate and draws', () => {
    expect(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status().state).toBe('stalemate');
    expect(new Chess('7k/8/6K1/8/8/8/8/5B2 b - - 0 1').status().state).toBe('insufficient');
    expect(new Chess('7k/8/6K1/8/8/8/8/5R2 b - - 100 80').status().state).toBe('fifty-move');
    const c = new Chess();
    for (const s of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) c.playSan(s);
    expect(c.status().state).toBe('repetition');
  });
});

import { search } from '../src/chess/ai';

describe('ai', () => {
  it('finds mate in one', () => {
    const r = search('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'archmage');
    expect(r.move && new Chess('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1').san(r.move)).toBe('Ra8#');
  });
  it('wins a hanging queen', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1';
    const r = search(fen, 'adept');
    expect(new Chess(fen).san(r.move!)).toBe('Bxg5');
  });
});
