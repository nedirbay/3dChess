import type { Color, MoveRecord, PieceType } from '../chess/engine';
import type { Difficulty } from '../chess/ai';
import { GLYPH, icon, type IconName } from './icons';

export type Mode = 'ai' | 'local';
export type Destination = 'play' | 'moves' | 'settings' | 'rules';

export interface Settings {
  mode: Mode;
  side: Color;
  difficulty: Difficulty;
  sound: boolean;
  hints: boolean;
  autoflip: boolean;
  bloom: boolean;
  shadows: boolean;
  speed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'ai',
  side: 'w',
  difficulty: 'adept',
  sound: true,
  hints: true,
  autoflip: false,
  bloom: true,
  shadows: true,
  speed: 1,
};

const STORAGE_KEY = 'wizards-chess-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export interface UiHandlers {
  newGame(): void;
  undo(): void;
  resign(): void;
  flip(): void;
  centerCamera(): void;
  settingsChanged(s: Settings, key: keyof Settings): void;
  /** Horizontal screen space (px) covered by the rail + open sheet. */
  layoutChanged(leftInset: number): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const DEST_TITLES: Record<Destination, string> = {
  play: 'Play',
  moves: 'Moves',
  settings: 'Settings',
  rules: 'Rules',
};
const DEST_ICONS: Record<Destination, IconName> = {
  play: 'play',
  moves: 'moves',
  settings: 'settings',
  rules: 'rules',
};

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME: Record<Color, string> = { w: 'Marble', b: 'Obsidian' };

export class Ui {
  readonly settings: Settings;
  private dest: Destination | null = null;
  private snackTimer = 0;

  constructor(private h: UiHandlers) {
    this.settings = loadSettings();

    // Icons
    document.querySelector('.nav__brand')!.innerHTML = icon('sparkle', 26);
    document.querySelectorAll<HTMLButtonElement>('.nav__item').forEach((b) => {
      const d = b.dataset.dest as Destination;
      b.querySelector('.nav__indicator')!.innerHTML = icon(DEST_ICONS[d]);
      b.addEventListener('click', () => this.toggleDest(d));
    });
    $('sheet-close').innerHTML = icon('close');
    $('sheet-close').addEventListener('click', () => this.closeSheet());
    $('new-game').innerHTML = `${icon('refresh')}New game`;
    $('undo').innerHTML = `${icon('undo')}Undo`;
    $('resign').innerHTML = `${icon('flag')}Resign`;
    $('q-undo').innerHTML = icon('undo');
    $('q-flip').innerHTML = icon('flip');
    $('q-center').innerHTML = icon('center');

    $('new-game').addEventListener('click', () => h.newGame());
    $('undo').addEventListener('click', () => h.undo());
    $('q-undo').addEventListener('click', () => h.undo());
    $('resign').addEventListener('click', () => h.resign());
    $('q-flip').addEventListener('click', () => h.flip());
    $('q-center').addEventListener('click', () => h.centerCamera());

    this.bindSegmented('mode', 'mode');
    this.bindSegmented('side', 'side');
    this.bindSegmented('difficulty', 'difficulty');
    this.bindSwitch('opt-sound', 'sound');
    this.bindSwitch('opt-hints', 'hints');
    this.bindSwitch('opt-autoflip', 'autoflip');
    this.bindSwitch('opt-bloom', 'bloom');
    this.bindSwitch('opt-shadows', 'shadows');

    const speed = $<HTMLInputElement>('opt-speed');
    speed.value = String(this.settings.speed);
    $('speed-out').textContent = `${this.settings.speed.toFixed(1)}×`;
    speed.addEventListener('input', () => {
      this.settings.speed = Number(speed.value);
      $('speed-out').textContent = `${this.settings.speed.toFixed(1)}×`;
      this.persist('speed');
    });
    this.syncAiFields();
    window.addEventListener('resize', () => this.emitLayout());
  }

  private persist(key: keyof Settings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.h.settingsChanged(this.settings, key);
  }

  private bindSegmented(id: string, key: 'mode' | 'side' | 'difficulty'): void {
    const root = $(id);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
    const sync = () =>
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === this.settings[key])));
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        if (this.settings[key] === b.dataset.value) return;
        (this.settings as unknown as Record<string, string>)[key] = b.dataset.value!;
        sync();
        if (key === 'mode') this.syncAiFields();
        this.persist(key);
      }),
    );
    sync();
  }

  private bindSwitch(id: string, key: 'sound' | 'hints' | 'autoflip' | 'bloom' | 'shadows'): void {
    const input = $<HTMLInputElement>(id);
    input.checked = this.settings[key];
    input.addEventListener('change', () => {
      this.settings[key] = input.checked;
      this.persist(key);
    });
  }

  private syncAiFields(): void {
    document.querySelectorAll<HTMLElement>('[data-ai-only]').forEach((el) => {
      el.hidden = this.settings.mode !== 'ai';
    });
  }

  // -------------------------------------------------------------------------
  // Navigation (single level: one rail, four destinations, one sheet)
  // -------------------------------------------------------------------------

  toggleDest(d: Destination): void {
    if (this.dest === d) this.closeSheet();
    else this.openDest(d);
  }

  openDest(d: Destination): void {
    this.dest = d;
    $('sheet-title').textContent = DEST_TITLES[d];
    document.querySelectorAll<HTMLElement>('.sheet__section').forEach((s) => {
      s.classList.toggle('is-active', s.dataset.section === d);
    });
    document.querySelectorAll<HTMLButtonElement>('.nav__item').forEach((b) => {
      if (b.dataset.dest === d) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const sheet = $('sheet');
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    if (d === 'moves') this.scrollMoves();
    this.emitLayout();
  }

  /** Reports how much of the left edge is covered so the 3D view can re-centre. */
  emitLayout(): void {
    const compact = window.innerWidth <= 720;
    const inset = compact ? 0 : 80 + (this.dest ? 352 : 0);
    document.getElementById('app')!.style.setProperty('--view-inset', `${inset}px`);
    this.h.layoutChanged(inset);
  }

  closeSheet(): void {
    this.dest = null;
    const sheet = $('sheet');
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.nav__item').forEach((b) => b.removeAttribute('aria-current'));
    this.emitLayout();
  }

  get sheetOpen(): boolean {
    return this.dest !== null;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  setStatus(text: string, alert = false): void {
    const el = $('status-text');
    el.textContent = text;
    el.classList.toggle('is-alert', alert);
  }

  setTurn(turn: Color | null): void {
    $('player-w').classList.toggle('is-active', turn === 'w');
    $('player-b').classList.toggle('is-active', turn === 'b');
  }

  setPlayerLabels(mode: Mode, human: Color): void {
    const label = (c: Color) => (mode === 'ai' ? (c === human ? `${NAME[c]} · You` : `${NAME[c]} · Wizard`) : NAME[c]);
    for (const c of ['w', 'b'] as Color[]) {
      const el = $(`player-${c}`);
      el.lastChild!.textContent = label(c);
    }
  }

  setThinking(on: boolean): void {
    $('thinking').hidden = !on;
  }

  setUndoEnabled(on: boolean): void {
    ($('undo') as HTMLButtonElement).disabled = !on;
    ($('q-undo') as HTMLButtonElement).disabled = !on;
  }

  setResignEnabled(on: boolean): void {
    ($('resign') as HTMLButtonElement).disabled = !on;
  }

  setHistory(history: MoveRecord[]): void {
    const list = $('movelist');
    list.innerHTML = '';
    for (let i = 0; i < history.length; i += 2) {
      const li = document.createElement('li');
      const w = history[i];
      const b = history[i + 1];
      const last = history.length - 1;
      li.innerHTML =
        `<span class="num">${i / 2 + 1}.</span>` +
        `<span class="ply${i === last ? ' is-last' : ''}">${w.san}</span>` +
        `<span class="ply${i + 1 === last ? ' is-last' : ''}">${b ? b.san : ''}</span>`;
      list.appendChild(li);
    }
    $('moves-empty').hidden = history.length > 0;
    this.scrollMoves();

    // Captured pieces & material balance.
    const taken: Record<Color, PieceType[]> = { w: [], b: [] };
    for (const r of history) if (r.captured) taken[r.color].push(r.captured);
    const order = 'qrbnp';
    const score = (c: Color) => taken[c].reduce((s, t) => s + VALUE[t], 0);
    for (const c of ['w', 'b'] as Color[]) {
      const enemy: Color = c === 'w' ? 'b' : 'w';
      const sorted = [...taken[c]].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      $(`cap-${c}`).textContent = sorted.map((t) => GLYPH[enemy + t]).join('');
      const adv = score(c) - score(enemy);
      $(`adv-${c}`).textContent = adv > 0 ? `+${adv}` : '';
    }
  }

  private scrollMoves(): void {
    const section = document.querySelector<HTMLElement>('[data-section="moves"]');
    if (section) section.scrollTop = section.scrollHeight;
  }

  snackbar(msg: string, ms = 2600): void {
    const el = $('snackbar');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(this.snackTimer);
    this.snackTimer = window.setTimeout(() => el.classList.remove('is-visible'), ms);
  }

  // -------------------------------------------------------------------------
  // Dialogs
  // -------------------------------------------------------------------------

  askPromotion(color: Color): Promise<PieceType | null> {
    const dialog = $<HTMLDialogElement>('promo-dialog');
    const box = $('promo-options');
    box.innerHTML = '';
    return new Promise((resolve) => {
      const choices: [PieceType, string][] = [
        ['q', 'Queen'],
        ['r', 'Rook'],
        ['b', 'Bishop'],
        ['n', 'Knight'],
      ];
      let done = false;
      const finish = (v: PieceType | null) => {
        if (done) return;
        done = true;
        dialog.close();
        resolve(v);
      };
      for (const [t, name] of choices) {
        const b = document.createElement('button');
        b.innerHTML = `<span>${GLYPH[color + t]}</span>${name}`;
        b.addEventListener('click', () => finish(t));
        box.appendChild(b);
      }
      dialog.addEventListener('cancel', () => finish(null), { once: true });
      dialog.showModal();
      (box.firstElementChild as HTMLElement).focus();
    });
  }

  showGameOver(title: string, body: string, kind: 'win' | 'draw'): Promise<'new' | 'review'> {
    const dialog = $<HTMLDialogElement>('over-dialog');
    $('over-icon').innerHTML = icon(kind === 'win' ? 'trophy' : 'handshake', 32);
    $('over-title').textContent = title;
    $('over-body').textContent = body;
    return new Promise((resolve) => {
      const done = (v: 'new' | 'review') => {
        dialog.close();
        $('over-new').removeEventListener('click', onNew);
        $('over-review').removeEventListener('click', onReview);
        resolve(v);
      };
      const onNew = () => done('new');
      const onReview = () => done('review');
      $('over-new').addEventListener('click', onNew);
      $('over-review').addEventListener('click', onReview);
      dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
        done('review');
      }, { once: true });
      dialog.showModal();
    });
  }

  get dialogOpen(): boolean {
    return !!document.querySelector('dialog[open]');
  }

  hideLoader(): void {
    $('loader').classList.add('is-hidden');
    setTimeout(() => $('loader').remove(), 1000);
  }
}
