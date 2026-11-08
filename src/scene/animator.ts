/** Frame-driven tween scheduler. All game animations run through here so a
 * single speed multiplier controls them and they stay in sync with render. */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t: number) => {
    const c1 = 1.70158;
    return (c1 + 1) * t * t * t - c1 * t * t;
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

interface Task {
  elapsed: number;
  duration: number;
  step: (t: number) => void;
  ease: Ease;
  resolve: () => void;
}

export class Animator {
  /** Global speed multiplier for gameplay animations. */
  speed = 1;
  private tasks = new Set<Task>();

  tween(duration: number, step: (t: number) => void, easing: Ease = ease.inOutQuad): Promise<void> {
    return new Promise((resolve) => {
      if (duration <= 0) {
        step(1);
        resolve();
        return;
      }
      step(easing(0));
      this.tasks.add({ elapsed: 0, duration, step, ease: easing, resolve });
    });
  }

  wait(duration: number): Promise<void> {
    return this.tween(duration, () => {}, ease.linear);
  }

  update(dt: number): void {
    const scaled = dt * this.speed;
    for (const task of [...this.tasks]) {
      task.elapsed += scaled;
      const t = Math.min(1, task.elapsed / task.duration);
      task.step(task.ease(t));
      if (t >= 1) {
        this.tasks.delete(task);
        task.resolve();
      }
    }
  }

  /** Completes every running tween immediately. */
  finishAll(): void {
    for (const task of [...this.tasks]) {
      task.step(task.ease(1));
      task.resolve();
    }
    this.tasks.clear();
  }

  get busy(): boolean {
    return this.tasks.size > 0;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Shortest signed angular difference b - a in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
