import * as THREE from 'three';
import { FLAG, type Color, type MoveRecord, type Piece, type PieceType } from '../chess/engine';
import type { Animator } from './animator';
import type { Effects } from './effects';
import type { PieceFactory } from './pieceFactory';
import { ARCANE, PieceView, squareToWorld } from './pieceView';

export interface MoveHooks {
  onAttack?: () => void;
  onShatter?: () => void;
  onLand?: () => void;
}

/** Owns the 3D pieces and turns engine moves into choreographed sequences. */
export class BoardView {
  readonly group = new THREE.Group();
  private pieces = new Map<number, PieceView>();
  private graveyard = new Set<PieceView>();

  constructor(
    private factory: PieceFactory,
    private anim: Animator,
    private fx: Effects,
  ) {}

  at(sq: number): PieceView | undefined {
    return this.pieces.get(sq);
  }

  all(): PieceView[] {
    return [...this.pieces.values()];
  }

  private spawn(type: PieceType, color: Color, sq: number): PieceView {
    const v = new PieceView(type, color, sq, this.factory, this.anim, this.fx);
    this.group.add(v.root);
    this.pieces.set(sq, v);
    return v;
  }

  /** Rebuilds all pieces from a board array, optionally with a summoning wave. */
  async setup(board: (Piece | null)[], summon = false): Promise<void> {
    for (const v of this.pieces.values()) v.dispose();
    for (const v of this.graveyard) v.dispose();
    this.pieces.clear();
    this.graveyard.clear();
    const spawned: PieceView[] = [];
    board.forEach((p, sq) => {
      if (p) spawned.push(this.spawn(p.type, p.color, sq));
    });
    if (!summon) return;
    await Promise.all(
      spawned.map((v) => {
        const rank = v.square >> 3;
        const file = v.square & 7;
        const row = v.color === 'w' ? rank : 7 - rank;
        return v.summon(row * 0.18 + Math.abs(file - 3.5) * 0.05);
      }),
    );
  }

  /** Animates a move already applied to the engine. */
  async play(rec: MoveRecord, hooks: MoveHooks = {}): Promise<void> {
    const mover = this.pieces.get(rec.from);
    if (!mover) return;
    this.pieces.delete(rec.from);
    const target = squareToWorld(rec.to);

    // Captures: approach, strike, shatter, then advance onto the square.
    if (rec.captureSquare !== undefined) {
      const victim = this.pieces.get(rec.captureSquare);
      this.pieces.delete(rec.captureSquare);
      this.pieces.set(rec.to, mover);
      mover.square = rec.to;
      if (victim) {
        const vPos = victim.root.position.clone();
        const from = mover.root.position.clone();
        const toVictim = vPos.clone().sub(from).setY(0);
        const dist = toVictim.length();
        const reach = mover.type === 'n' ? 0.9 : 0.85;
        const bracing = victim.brace(from);
        if (dist > reach + 0.2) {
          const approach = from.clone().addScaledVector(toVictim.normalize(), dist - reach);
          await mover.moveTo(approach, { turnBack: false });
        }
        await bracing;
        hooks.onAttack?.();
        await mover.attack(victim, (dir) => {
          victim.shatter(dir);
          this.graveyard.add(victim);
          hooks.onShatter?.();
        });
        await this.anim.wait(0.12);
      }
      await mover.moveTo(target);
      hooks.onLand?.();
    } else if (rec.flags & (FLAG.CASTLE_K | FLAG.CASTLE_Q)) {
      const kingSide = (rec.flags & FLAG.CASTLE_K) !== 0;
      const rookFrom = kingSide ? rec.to + 1 : rec.to - 2;
      const rookTo = kingSide ? rec.to - 1 : rec.to + 1;
      const rook = this.pieces.get(rookFrom);
      this.pieces.set(rec.to, mover);
      mover.square = rec.to;
      const kingMove = mover.moveTo(target);
      if (rook) {
        this.pieces.delete(rookFrom);
        this.pieces.set(rookTo, rook);
        rook.square = rookTo;
        await this.anim.wait(0.18);
        await rook.moveTo(squareToWorld(rookTo));
      }
      await kingMove;
      hooks.onLand?.();
    } else {
      this.pieces.set(rec.to, mover);
      mover.square = rec.to;
      await mover.moveTo(target);
      hooks.onLand?.();
    }

    if (rec.promotion) {
      const pos = squareToWorld(rec.to);
      this.fx.burst(pos.clone().setY(0.6), ARCANE[rec.color], 30, 2.2, 0.14, 0, 1, -1.5);
      this.fx.flash(pos, ARCANE[rec.color], 14, 0.7);
      this.fx.shockwave(pos.clone().setY(0.02), ARCANE[rec.color], 1.2);
      await mover.vanish();
      mover.dispose();
      const promoted = this.spawn(rec.promotion, rec.color, rec.to);
      await promoted.summon(0);
    }
  }

  /** Dramatic end for a defeated king. */
  async defeat(sq: number, mode: 'shatter' | 'topple'): Promise<void> {
    const king = this.pieces.get(sq);
    if (!king) return;
    if (mode === 'topple') {
      await king.topple();
      return;
    }
    await king.brace(king.root.position.clone().add(new THREE.Vector3(0, 0, king.color === 'w' ? -1 : 1)));
    await this.anim.wait(0.25);
    this.pieces.delete(sq);
    king.shatter(new THREE.Vector3(0, 0.6, 0));
    this.graveyard.add(king);
  }

  update(time: number, dt: number, turn: Color): void {
    for (const v of this.pieces.values()) v.update(time, dt, v.color === turn);
  }

  /** Pieces' meshes for ray picking. */
  pickables(): THREE.Object3D[] {
    return [...this.pieces.values()].map((v) => v.root);
  }
}
