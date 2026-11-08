import * as THREE from 'three';
import type { Color, PieceType } from '../chess/engine';
import { Animator, angleDelta, ease, lerp } from './animator';
import type { Effects } from './effects';
import type { PieceFactory } from './pieceFactory';

/** World position of a square's centre (a1 at -x,+z; white sits at +z). */
export function squareToWorld(sq: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((sq & 7) - 3.5, 0, 3.5 - (sq >> 3));
}

export const ARCANE: Record<Color, THREE.Color> = {
  w: new THREE.Color(0xffc46b),
  b: new THREE.Color(0xa86bff),
};

/**
 * One animated chess piece. Transform hierarchy:
 *   root  – board position and facing (yaw)
 *   pose  – action animations (move lean, attack strikes, hops)
 *   idle  – procedural idle motion, blended out during actions
 *   model – the meshes
 */
export class PieceView {
  readonly root = new THREE.Group();
  readonly pose = new THREE.Group();
  readonly idle = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly accent: THREE.Mesh;
  square: number;

  private phase = Math.random() * Math.PI * 2;
  private idleWeight = 1;
  private selected = 0;
  private selectedTarget = 0;
  private hover = 0;
  private hoverTarget = 0;
  readonly homeYaw: number;

  constructor(
    readonly type: PieceType,
    readonly color: Color,
    square: number,
    factory: PieceFactory,
    private anim: Animator,
    private fx: Effects,
  ) {
    const { group, body, accent } = factory.create(type, color);
    this.body = body;
    this.accent = accent;
    this.square = square;
    this.root.add(this.pose);
    this.pose.add(this.idle);
    this.idle.add(group);
    this.homeYaw = color === 'w' ? 0 : Math.PI;
    this.root.rotation.y = this.homeYaw;
    squareToWorld(square, this.root.position);
    this.root.userData.piece = this;
    group.traverse((o) => (o.userData.piece = this));
  }

  get accentMaterial(): THREE.MeshStandardMaterial {
    return this.accent.material as THREE.MeshStandardMaterial;
  }

  get bodyMaterial(): THREE.MeshPhysicalMaterial {
    return this.body.material as THREE.MeshPhysicalMaterial;
  }

  setSelected(on: boolean): void {
    this.selectedTarget = on ? 1 : 0;
  }

  setHover(on: boolean): void {
    this.hoverTarget = on ? 1 : 0;
  }

  // ---------------------------------------------------------------------------
  // Idle
  // ---------------------------------------------------------------------------

  update(time: number, dt: number, active: boolean): void {
    const k = 1 - Math.exp(-dt * 10);
    this.selected += (this.selectedTarget - this.selected) * k;
    this.hover += (this.hoverTarget - this.hover) * k;

    const t = time + this.phase;
    const w = this.idleWeight * (active ? 1 : 0.55);
    const i = this.idle;
    i.position.set(0, 0, 0);
    i.rotation.set(0, 0, 0);
    i.scale.set(1, 1, 1);
    switch (this.type) {
      case 'p':
        i.position.y = (Math.sin(t * 1.7) * 0.5 + 0.5) * 0.018 * w;
        i.rotation.x = Math.sin(t * 0.9) * 0.02 * w;
        break;
      case 'n':
        // Restless steed: head nods and shifts weight.
        i.rotation.x = (Math.sin(t * 1.25) * 0.05 + Math.max(0, Math.sin(t * 0.37)) * 0.05) * w;
        i.rotation.z = Math.sin(t * 0.6) * 0.025 * w;
        i.position.y = Math.abs(Math.sin(t * 1.25)) * 0.012 * w;
        break;
      case 'b':
        // Pendulum sway, like a chanting cleric.
        i.rotation.z = Math.sin(t * 0.85) * 0.04 * w;
        i.rotation.x = Math.sin(t * 0.85 * 0.5) * 0.02 * w;
        break;
      case 'r': {
        // Heavy breathing of a stone tower.
        const b = Math.sin(t * 1.05) * 0.5 + 0.5;
        i.scale.set(1 + b * 0.012 * w, 1 - b * 0.012 * w + 0.004, 1 + b * 0.012 * w);
        break;
      }
      case 'q':
        // Levitates and slowly turns, scanning the board.
        i.position.y = (0.035 + Math.sin(t * 1.3) * 0.025) * w;
        i.rotation.y = Math.sin(t * 0.45) * 0.18 * w;
        break;
      case 'k':
        i.position.y = (Math.sin(t * 0.8) * 0.5 + 0.5) * 0.012 * w;
        i.rotation.y = Math.sin(t * 0.35) * 0.06 * w;
        i.scale.setScalar(1 + Math.sin(t * 0.8) * 0.006 * w);
        break;
    }
    // Selection lift + hover.
    i.position.y += this.selected * (0.16 + Math.sin(time * 3) * 0.025) + this.hover * 0.04;
    i.rotation.y += this.selected * Math.sin(time * 1.4) * 0.12;

    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
    const base = this.color === 'w' ? 0.45 : 0.75;
    this.accentMaterial.emissiveIntensity =
      base * (0.75 + pulse * 0.35 * (active ? 1 : 0.5)) + this.selected * 1.6 + this.hover * 0.5;
    this.bodyMaterial.emissive.copy(ARCANE[this.color]).multiplyScalar(this.selected * 0.06 + this.hover * 0.025);
  }

  private async fadeIdle(to: number, duration = 0.18): Promise<void> {
    const from = this.idleWeight;
    await this.anim.tween(duration, (t) => (this.idleWeight = lerp(from, to, t)));
  }

  // ---------------------------------------------------------------------------
  // Turning
  // ---------------------------------------------------------------------------

  yawTowards(target: THREE.Vector3): number {
    const dx = target.x - this.root.position.x;
    const dz = target.z - this.root.position.z;
    if (dx * dx + dz * dz < 1e-6) return this.root.rotation.y;
    return Math.atan2(-dx, -dz);
  }

  async turnTo(yaw: number, duration = 0.22): Promise<void> {
    const from = this.root.rotation.y;
    const d = angleDelta(from, yaw);
    if (Math.abs(d) < 0.01) return;
    await this.anim.tween(duration * (0.5 + Math.abs(d) / Math.PI), (t) => {
      this.root.rotation.y = from + d * t;
    }, ease.inOutQuad);
  }

  turnHome(): Promise<void> {
    return this.turnTo(this.homeYaw, 0.28);
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  /** Moves to a world point with a piece-specific gait. */
  async moveTo(target: THREE.Vector3, opts: { turnBack?: boolean } = {}): Promise<void> {
    const start = this.root.position.clone();
    const dist = start.distanceTo(target);
    if (dist < 1e-3) return;
    await this.fadeIdle(0, 0.12);
    await this.turnTo(this.yawTowards(target));

    if (this.type === 'n') {
      // Leap in a high arc, rearing on take-off and landing heavily.
      await this.anim.tween(0.16, (t) => (this.pose.rotation.x = 0.35 * t), ease.outQuad);
      const dur = 0.45 + dist * 0.07;
      const height = 0.8 + dist * 0.12;
      await this.anim.tween(dur, (t) => {
        this.root.position.lerpVectors(start, target, t);
        this.root.position.y = Math.sin(Math.PI * t) * height;
        this.pose.rotation.x = lerp(0.35, -0.3, t);
      }, ease.inOutQuad);
      this.root.position.copy(target);
      this.fx.dust(target, 1.3);
      await this.anim.tween(0.22, (t) => {
        this.pose.rotation.x = lerp(-0.3, 0, t);
        this.pose.scale.y = 1 - Math.sin(Math.PI * t) * 0.08;
      }, ease.outQuad);
    } else if (this.type === 'q' || this.type === 'k') {
      // Royal glide: rise, float across, settle.
      const rise = this.type === 'q' ? 0.28 : 0.16;
      const dur = 0.4 + dist * 0.12;
      await this.anim.tween(dur, (t) => {
        this.root.position.lerpVectors(start, target, ease.inOutCubic(t));
        this.root.position.y = Math.sin(Math.PI * t) * rise;
        this.pose.rotation.x = -Math.sin(Math.PI * t) * 0.08;
      }, ease.linear);
      this.root.position.copy(target);
      this.fx.dust(target, 0.6);
    } else {
      // March with small hops (pawns, rooks) or a smooth slide (bishops).
      const dur = 0.35 + dist * 0.13;
      const hops = this.type === 'b' ? 0 : Math.max(1, Math.round(dist * 1.5));
      const hopH = this.type === 'r' ? 0.05 : 0.08;
      await this.anim.tween(dur, (t) => {
        this.root.position.lerpVectors(start, target, ease.inOutQuad(t));
        this.root.position.y = hops ? Math.abs(Math.sin(Math.PI * t * hops)) * hopH : Math.sin(Math.PI * t) * 0.05;
        this.pose.rotation.x = -Math.sin(Math.PI * t) * (this.type === 'b' ? 0.12 : 0.1);
      }, ease.linear);
      this.root.position.copy(target);
      this.fx.dust(target, this.type === 'r' ? 1.1 : 0.7);
      await this.anim.tween(0.14, (t) => (this.pose.scale.y = 1 - Math.sin(Math.PI * t) * 0.05));
    }
    this.pose.rotation.set(0, 0, 0);
    this.pose.scale.set(1, 1, 1);
    if (opts.turnBack !== false) await this.turnHome();
    await this.fadeIdle(1, 0.25);
  }

  // ---------------------------------------------------------------------------
  // Attack
  // ---------------------------------------------------------------------------

  /**
   * Plays the strike against `victim`. Resolves when the blow lands, calling
   * `onImpact` at the moment of contact so the victim can shatter.
   */
  async attack(victim: PieceView, onImpact: (dir: THREE.Vector3) => void): Promise<void> {
    const victimPos = victim.root.position.clone();
    await this.fadeIdle(0, 0.12);
    await this.turnTo(this.yawTowards(victimPos));
    const dir = victimPos.clone().sub(this.root.position).setY(0).normalize();
    const p = this.pose;
    const impact = () => onImpact(dir.clone());

    switch (this.type) {
      case 'p': {
        // Wind up, then a quick spear-like thrust.
        await this.anim.tween(0.22, (t) => {
          p.position.z = 0.1 * t;
          p.rotation.x = 0.2 * t;
        }, ease.outQuad);
        await this.anim.tween(0.1, (t) => {
          p.position.z = lerp(0.1, -0.32, t);
          p.rotation.x = lerp(0.2, -0.45, t);
        }, ease.inQuad);
        impact();
        await this.anim.tween(0.25, (t) => {
          p.position.z = lerp(-0.32, 0, t);
          p.rotation.x = lerp(-0.45, 0, t);
        }, ease.outQuad);
        break;
      }
      case 'n': {
        // Rear up on hind legs, then stamp down with the forehooves.
        await this.anim.tween(0.3, (t) => {
          p.rotation.x = 0.6 * t;
          p.position.y = 0.12 * t;
          p.position.z = 0.08 * t;
        }, ease.outCubic);
        await this.anim.wait(0.06);
        await this.anim.tween(0.12, (t) => {
          p.rotation.x = lerp(0.6, -0.5, t);
          p.position.y = lerp(0.12, 0, t);
          p.position.z = lerp(0.08, -0.3, t);
        }, ease.inQuad);
        impact();
        this.fx.dust(this.root.position.clone().addScaledVector(dir, 0.4), 1.2);
        await this.anim.tween(0.3, (t) => {
          p.rotation.x = lerp(-0.5, 0, t);
          p.position.z = lerp(-0.3, 0, t);
        }, ease.outQuad);
        break;
      }
      case 'b': {
        // Tilt aside and cleave diagonally with the mitre, trailing sparks.
        await this.anim.tween(0.24, (t) => {
          p.rotation.z = 0.55 * t;
          p.rotation.x = 0.15 * t;
        }, ease.outQuad);
        await this.anim.tween(0.12, (t) => {
          p.rotation.z = lerp(0.55, -0.6, t);
          p.rotation.x = lerp(0.15, -0.4, t);
          p.position.z = -0.25 * t;
        }, ease.inQuad);
        impact();
        await this.anim.tween(0.3, (t) => {
          p.rotation.z = lerp(-0.6, 0, t);
          p.rotation.x = lerp(-0.4, 0, t);
          p.position.z = lerp(-0.25, 0, t);
        }, ease.outQuad);
        break;
      }
      case 'r': {
        // Rise up and crash down: a siege tower's ground-pound.
        await this.anim.tween(0.32, (t) => {
          p.position.y = 0.55 * t;
          p.rotation.x = 0.12 * t;
        }, ease.outCubic);
        await this.anim.tween(0.12, (t) => {
          p.position.y = lerp(0.55, 0, t);
          p.position.z = -0.25 * t;
          p.rotation.x = lerp(0.12, -0.25, t);
        }, ease.inCubic);
        impact();
        this.fx.shockwave(this.root.position.clone().setY(0.02), ARCANE[this.color], 1.6);
        this.fx.dust(this.root.position.clone(), 1.6);
        await this.anim.tween(0.28, (t) => {
          p.position.z = lerp(-0.25, 0, t);
          p.rotation.x = lerp(-0.25, 0, t);
        }, ease.outQuad);
        break;
      }
      case 'q': {
        // Pirouette while rising, then hurl an arcane bolt.
        await this.anim.tween(0.45, (t) => {
          p.rotation.y = Math.PI * 2 * t;
          p.position.y = 0.3 * t;
        }, ease.inOutQuad);
        p.rotation.y = 0;
        await this.castBolt(victimPos, 0.22);
        impact();
        await this.anim.tween(0.25, (t) => {
          p.position.y = lerp(0.3, 0, t);
          p.rotation.x = -Math.sin(Math.PI * t) * 0.2;
        }, ease.outQuad);
        break;
      }
      case 'k': {
        // A regal, deliberate overhead smite.
        await this.anim.tween(0.34, (t) => {
          p.rotation.x = 0.32 * t;
          p.position.y = 0.1 * t;
        }, ease.outCubic);
        await this.anim.tween(0.13, (t) => {
          p.rotation.x = lerp(0.32, -0.55, t);
          p.position.y = lerp(0.1, 0, t);
          p.position.z = -0.22 * t;
        }, ease.inQuad);
        impact();
        await this.anim.tween(0.32, (t) => {
          p.rotation.x = lerp(-0.55, 0, t);
          p.position.z = lerp(-0.22, 0, t);
        }, ease.outQuad);
        break;
      }
    }
    p.position.set(0, 0, 0);
    p.rotation.set(0, 0, 0);
  }

  private async castBolt(target: THREE.Vector3, duration: number): Promise<void> {
    const from = this.root.position.clone().setY(1.0);
    const to = target.clone().setY(0.5);
    const color = ARCANE[this.color];
    let last = 0;
    await this.anim.tween(duration, (t) => {
      if (t - last < 0.08 && t < 1) return;
      last = t;
      const pos = from.clone().lerp(to, t);
      pos.y += Math.sin(Math.PI * t) * 0.3;
      this.fx.burst(pos, color, 4, 0.5, 0.18, 0, 0.35, 0);
    }, ease.linear);
  }

  /** Victim reaction just before being destroyed. */
  async brace(attackerPos: THREE.Vector3): Promise<void> {
    await this.fadeIdle(0, 0.1);
    await this.turnTo(this.yawTowards(attackerPos), 0.2);
    await this.anim.tween(0.18, (t) => {
      this.pose.rotation.x = 0.12 * t;
      this.pose.scale.y = 1 - 0.04 * t;
    }, ease.outQuad);
  }

  /** Destroys the piece in an explosion of shards. */
  shatter(direction: THREE.Vector3): void {
    this.fx.shatter(this.root, direction, ARCANE[this.color]);
    this.root.visible = false;
    this.root.removeFromParent();
  }

  /** Arrival animation used when a new game begins. */
  async summon(delay: number): Promise<void> {
    this.root.scale.setScalar(0.001);
    this.root.visible = true;
    await this.anim.wait(delay);
    this.fx.burst(this.root.position.clone().setY(0.3), ARCANE[this.color], 6, 0.9, 0.16, 0, 0.6, -1);
    await this.anim.tween(0.5, (t) => {
      this.root.scale.setScalar(Math.max(0.001, t));
      this.pose.position.y = (1 - t) * 0.6;
    }, ease.outBack);
    this.pose.position.y = 0;
  }

  /** Scale out (used for promotion). */
  async vanish(): Promise<void> {
    await this.anim.tween(0.3, (t) => {
      this.root.scale.setScalar(Math.max(0.001, 1 - t));
      this.pose.rotation.y = t * Math.PI * 2;
    }, ease.inBack);
    this.root.removeFromParent();
  }

  /** Topple over (resignation / defeated king alternative). */
  async topple(): Promise<void> {
    await this.fadeIdle(0, 0.2);
    await this.anim.tween(0.9, (t) => {
      this.pose.rotation.z = t * (Math.PI / 2 - 0.08);
      this.pose.position.x = -t * 0.12;
      this.pose.position.y = Math.sin(t * Math.PI) * 0.05;
    }, ease.outBounce);
    this.fx.dust(this.root.position.clone(), 1.2);
  }

  dispose(): void {
    this.root.removeFromParent();
    (this.body.material as THREE.Material).dispose();
    (this.accent.material as THREE.Material).dispose();
  }
}
