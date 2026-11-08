import * as THREE from 'three';
import { Chess, START_FEN, other, type Color, type Move, type MoveRecord } from '../chess/engine';
import type { AiRequest, AiResponse } from '../chess/ai.worker';
import { Animator } from '../scene/animator';
import { Board } from '../scene/board';
import { BoardView } from '../scene/boardView';
import { Cathedral, groundHeight } from '../scene/cathedral';
import { Effects } from '../scene/effects';
import { PieceFactory } from '../scene/pieceFactory';
import type { PieceView } from '../scene/pieceView';
import { Stage } from '../scene/stage';
import { Ui, type Settings } from '../ui/ui';
import { Sfx } from './audio';

const NAME: Record<Color, string> = { w: 'Marble', b: 'Obsidian' };

/** Connects the rules engine, the 3D scene, the AI worker and the UI. */
export class Game {
  private chess = new Chess();
  private stage: Stage;
  private anim = new Animator();
  private fx: Effects;
  private board = new Board();
  private view: BoardView;
  private cathedral: Cathedral;
  private ui: Ui;
  private sfx = new Sfx();
  private worker: Worker;

  /** Active game setup (settings changes apply from the next game). */
  private mode: Settings['mode'] = 'ai';
  private human: Color = 'w';
  private selected = -1;
  private hovered: PieceView | null = null;
  private busy = false;
  private thinking = false;
  private over = false;
  private aiRequest = 0;
  private viewSide: Color = 'w';
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;
  private timer = new THREE.Timer();
  private elapsed = 0;
  /** Largest simulation step per frame (raised by the debug hook for slow renderers). */
  maxStep = 0.05;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.cathedral = new Cathedral();
    this.stage.scene.add(this.cathedral.group, this.board.group);
    this.fx = new Effects(this.stage.scene, groundHeight);
    const factory = new PieceFactory();
    this.view = new BoardView(factory, this.anim, this.fx);
    this.stage.scene.add(this.view.group);

    this.ui = new Ui({
      newGame: () => void this.newGame(),
      undo: () => this.undo(),
      resign: () => void this.resign(),
      flip: () => this.flip(),
      centerCamera: () => void this.stage.viewFrom(this.viewSide, 0.9),
      settingsChanged: (s, key) => this.applySettings(s, key),
      layoutChanged: (inset) => this.stage.setLeftInset(inset),
    });
    this.ui.emitLayout();

    this.worker = new Worker(new URL('../chess/ai.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<AiResponse>) => this.onAiMove(e.data);

    this.mode = this.ui.settings.mode;
    this.human = this.ui.settings.side;
    this.applySettings(this.ui.settings);
    this.bindInput();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    await this.view.setup(this.chess.board, false);
    this.warmUpShaders();
    for (const p of this.view.all()) p.root.visible = false;
    this.ui.hideLoader();
    this.loop();
    const human = this.humanSide();
    this.viewSide = human;
    this.ui.setPlayerLabels(this.mode, human);
    this.ui.setStatus('The pieces awaken…');
    this.busy = true;
    const intro = this.stage.intro(human);
    await this.anim.wait(1.4);
    this.sfx.arcane();
    await this.view.setup(this.chess.board, true);
    await intro;
    this.busy = false;
    this.refresh();
    if (window.innerWidth >= 1100) this.ui.openDest('play');
    this.maybeAiMove();
  }

  /** Compiles every material variant up-front so the first capture doesn't hitch. */
  private warmUpShaders(): void {
    const temp: THREE.Object3D[] = [];
    for (const p of this.view.all().slice(0, 32)) {
      for (const mesh of [p.body, p.accent]) {
        const mat = (mesh.material as THREE.Material).clone();
        mat.transparent = true;
        mat.side = THREE.DoubleSide;
        const m = new THREE.Mesh(mesh.geometry, mat);
        m.position.set(0, -50, 0);
        temp.push(m);
      }
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending }));
    temp.push(sprite);
    this.stage.scene.add(...temp);
    this.stage.renderer.compile(this.stage.scene, this.stage.camera);
    this.stage.scene.remove(...temp);
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), this.maxStep);
    this.elapsed += dt;
    this.anim.update(dt);
    this.fx.update(dt * this.anim.speed);
    this.cathedral.update(this.elapsed, dt);
    this.view.update(this.elapsed, dt, this.chess.turn);
    this.board.update(this.elapsed);
    this.stage.render(dt);
  };

  private humanSide(): Color {
    return this.mode === 'ai' ? this.human : 'w';
  }

  private isHumanTurn(): boolean {
    return this.mode === 'local' || this.chess.turn === this.human;
  }

  private canInteract(): boolean {
    return !this.busy && !this.over && !this.thinking && this.isHumanTurn() && !this.ui.dialogOpen;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  private applySettings(s: Settings, key?: keyof Settings): void {
    this.sfx.enabled = s.sound;
    this.anim.speed = s.speed;
    this.stage.bloomEnabled = s.bloom;
    if (!key || key === 'shadows') this.stage.setShadows(s.shadows);
    if (key === 'hints') this.refreshSelection();
    if (key === 'mode' || key === 'side') {
      if (this.chess.history.length === 0 && !this.busy && !this.over) {
        // Nothing played yet: adopt the new setup immediately.
        void this.newGame();
      } else {
        this.ui.snackbar('Applies when you start a new game');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.stage.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.downAt) return;
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      this.downAt = null;
      if (moved > 6) return;
      const sq = this.pick(e);
      if (sq >= 0) void this.onSquare(sq);
      else this.deselect();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const sq = this.pick(e);
      this.updateHover(sq);
    });
    canvas.addEventListener('pointerleave', () => this.updateHover(-1));

    window.addEventListener('keydown', (e) => {
      if (this.ui.dialogOpen) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'BUTTON') && e.key !== 'Escape') {
        if (!(e.key === 'z' && (e.ctrlKey || e.metaKey))) return;
      }
      if (e.key === 'Escape') {
        if (this.selected >= 0) this.deselect();
        else this.ui.closeSheet();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.undo();
      } else if (e.key === 'n' || e.key === 'N') {
        void this.newGame();
      } else if (e.key === 'f' || e.key === 'F') {
        this.flip();
      }
    });
  }

  private pick(e: PointerEvent): number {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const hits = this.raycaster.intersectObjects(this.view.pickables(), true);
    for (const h of hits) {
      const piece = h.object.userData.piece as PieceView | undefined;
      if (piece) return piece.square;
    }
    const planeHit = this.raycaster.intersectObject(this.board.pickPlane, false)[0];
    return planeHit ? Board.worldToSquare(planeHit.point) : -1;
  }

  private updateHover(sq: number): void {
    const canvas = this.stage.renderer.domElement;
    const piece = sq >= 0 ? this.view.at(sq) : undefined;
    const interactive = this.canInteract();
    const ownPiece = interactive && piece && piece.color === this.chess.turn;
    const target = interactive && this.selected >= 0 && this.chess.movesFrom(this.selected).some((m) => m.to === sq);
    if (this.hovered && this.hovered !== piece) this.hovered.setHover(false);
    this.hovered = ownPiece ? piece! : null;
    this.hovered?.setHover(true);
    this.board.setHover(target ? sq : -1);
    canvas.style.cursor = ownPiece || target ? 'pointer' : 'default';
  }

  private async onSquare(sq: number): Promise<void> {
    if (!this.canInteract()) {
      if (this.thinking) this.ui.snackbar('The wizard is pondering…');
      return;
    }
    const piece = this.chess.get(sq);
    if (this.selected >= 0) {
      const options = this.chess.movesFrom(this.selected).filter((m) => m.to === sq);
      if (options.length) {
        let move: Move | undefined = options[0];
        if (options.length > 1) {
          const promo = await this.ui.askPromotion(this.chess.turn);
          if (!promo) return;
          move = options.find((m) => m.promotion === promo);
        }
        if (move) await this.execute(move);
        return;
      }
      if (sq === this.selected) {
        this.deselect();
        return;
      }
    }
    if (piece && piece.color === this.chess.turn) {
      this.select(sq);
    } else {
      if (this.selected >= 0 && piece) this.ui.snackbar('That move is not allowed');
      this.deselect();
    }
  }

  private select(sq: number): void {
    this.view.at(this.selected)?.setSelected(false);
    this.selected = sq;
    this.view.at(sq)?.setSelected(true);
    this.sfx.tick();
    this.refreshSelection();
    if (this.chess.movesFrom(sq).length === 0) this.ui.snackbar('That piece has no legal moves');
  }

  private deselect(): void {
    this.view.at(this.selected)?.setSelected(false);
    this.selected = -1;
    this.refreshSelection();
  }

  private refreshSelection(): void {
    this.board.setSelected(this.selected);
    if (this.selected >= 0 && this.ui.settings.hints) {
      this.board.setMarks(
        this.chess.movesFrom(this.selected).map((m) => ({ to: m.to, capture: m.captured !== undefined })),
      );
    } else this.board.setMarks([]);
  }

  // ---------------------------------------------------------------------------
  // Moves
  // ---------------------------------------------------------------------------

  private async execute(move: Move): Promise<void> {
    this.deselect();
    this.updateHover(-1);
    this.busy = true;
    this.ui.setUndoEnabled(false);
    const rec = this.chess.play(move);
    this.board.setLastMove([rec.from, rec.to]);
    this.board.setCheck(-1);
    this.ui.setTurn(null);
    this.ui.setStatus(`${NAME[rec.color]}: ${rec.san}`);
    this.ui.setHistory(this.chess.history);

    await this.view.play(rec, {
      onAttack: () => this.sfx.swing(),
      onShatter: () => {
        this.sfx.shatter();
        this.stage.shake(0.12);
      },
      onLand: () => this.sfx.thud(rec.piece === 'r' || rec.piece === 'k' ? 1.2 : 0.8),
    });
    if (rec.promotion) this.sfx.arcane();

    this.busy = false;
    const status = this.chess.status();
    if (status.state !== 'active') {
      await this.finish(status.state, rec);
      return;
    }
    this.refresh();
    if (status.check) this.sfx.bell();

    if (this.mode === 'local' && this.ui.settings.autoflip) {
      this.viewSide = this.chess.turn;
      await this.stage.viewFrom(this.viewSide, 1.1);
    }
    this.maybeAiMove();
  }

  private maybeAiMove(): void {
    if (this.over || this.busy || this.thinking) return;
    if (this.mode !== 'ai' || this.chess.turn === this.human) return;
    this.thinking = true;
    this.ui.setThinking(true);
    this.ui.setUndoEnabled(this.chess.history.length > 0);
    this.ui.setStatus(`The ${NAME[this.chess.turn]} wizard is thinking…`);
    const req: AiRequest = { id: ++this.aiRequest, fen: this.chess.fen(), difficulty: this.ui.settings.difficulty };
    this.aiStarted = performance.now();
    this.worker.postMessage(req);
  }

  private aiStarted = 0;

  private onAiMove(res: AiResponse): void {
    if (res.id !== this.aiRequest || !this.thinking) return;
    // Keep a short, deliberate pause so instant replies don't feel abrupt.
    const delay = Math.max(0, 450 - (performance.now() - this.aiStarted));
    window.setTimeout(() => {
      if (res.id !== this.aiRequest || !this.thinking) return;
      this.thinking = false;
      this.ui.setThinking(false);
      const move = this.chess.findMove(res.from, res.to, res.promotion as Move['promotion']);
      if (move) void this.execute(move);
      else this.refresh();
    }, delay);
  }

  private cancelAi(): void {
    this.aiRequest++;
    this.thinking = false;
    this.ui.setThinking(false);
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  private refresh(): void {
    const status = this.chess.status();
    const turn = this.chess.turn;
    this.ui.setTurn(this.over ? null : turn);
    this.ui.setHistory(this.chess.history);
    this.board.setCheck(status.check && !this.over ? this.chess.kings[turn] : -1);
    const last = this.chess.history.at(-1);
    this.board.setLastMove(last ? [last.from, last.to] : null);
    this.ui.setUndoEnabled(this.chess.history.length > 0 && !this.busy);
    this.ui.setResignEnabled(!this.over && this.chess.history.length > 0);
    if (this.over) return;
    const who =
      this.mode === 'ai'
        ? turn === this.human
          ? 'Your move'
          : `${NAME[turn]} wizard to move`
        : `${NAME[turn]} to move`;
    if (status.check) this.ui.setStatus(`Check! ${who}`, true);
    else this.ui.setStatus(this.chess.history.length ? who : `${who} — select a piece`);
  }

  private async finish(state: string, last?: MoveRecord): Promise<void> {
    this.over = true;
    this.cancelAi();
    this.ui.setTurn(null);
    this.board.setMarks([]);
    let title: string;
    let body: string;
    let kind: 'win' | 'draw' = 'draw';
    const moves = Math.ceil(this.chess.history.length / 2);
    switch (state) {
      case 'checkmate': {
        const loser = this.chess.turn;
        const winner = other(loser);
        title = 'Checkmate';
        body = `${NAME[winner]} triumphs in ${moves} move${moves === 1 ? '' : 's'}. ${last ? `Final blow: ${last.san}.` : ''}`;
        kind = 'win';
        this.board.setCheck(this.chess.kings[loser]);
        this.ui.setStatus(`Checkmate — ${NAME[winner]} wins`, true);
        this.sfx.bell(true);
        this.busy = true;
        await this.view.defeat(this.chess.kings[loser], 'shatter');
        this.sfx.shatter();
        this.stage.shake(0.2);
        await this.anim.wait(1.2);
        this.busy = false;
        break;
      }
      case 'resign': {
        const loser = this.resigning!;
        title = `${NAME[other(loser)]} wins`;
        body = `${NAME[loser]} resigned after ${moves} move${moves === 1 ? '' : 's'}.`;
        kind = 'win';
        this.ui.setStatus(`${NAME[loser]} resigned`, true);
        this.busy = true;
        await this.view.defeat(this.chess.kings[loser], 'topple');
        this.sfx.thud(1.4);
        await this.anim.wait(0.6);
        this.busy = false;
        break;
      }
      case 'stalemate':
        title = 'Stalemate';
        body = `${NAME[this.chess.turn]} has no legal move but is not in check. The duel is drawn.`;
        break;
      case 'repetition':
        title = 'Draw by repetition';
        body = 'The same position arose three times.';
        break;
      case 'fifty-move':
        title = 'Draw — fifty-move rule';
        body = 'Fifty moves passed without a capture or pawn move.';
        break;
      default:
        title = 'Draw — insufficient material';
        body = 'Neither side has enough force left to deliver checkmate.';
    }
    if (kind === 'draw') {
      this.ui.setStatus(title);
      this.sfx.bell(true);
    }
    this.refresh();
    this.ui.setUndoEnabled(state !== 'resign' && this.chess.history.length > 0);
    const choice = await this.ui.showGameOver(title, body, kind);
    if (choice === 'new') await this.newGame();
  }

  private resigning: Color | null = null;

  private async resign(): Promise<void> {
    if (this.over || this.busy || this.chess.history.length === 0) return;
    this.cancelAi();
    this.deselect();
    this.resigning = this.mode === 'ai' ? this.human : this.chess.turn;
    await this.finish('resign');
  }

  async newGame(): Promise<void> {
    if (this.busy) {
      this.ui.snackbar('Wait for the current move to finish');
      return;
    }
    this.cancelAi();
    this.deselect();
    this.over = false;
    this.resigning = null;
    this.mode = this.ui.settings.mode;
    this.human = this.ui.settings.side;
    this.chess.load(START_FEN);
    this.fx.clear();
    this.board.clearAll();
    this.ui.setHistory([]);
    this.ui.setPlayerLabels(this.mode, this.humanSide());
    this.busy = true;
    this.ui.setStatus('The pieces awaken…');
    const side = this.humanSide();
    const cam = this.stage.viewFrom(side, 1.2);
    this.viewSide = side;
    this.sfx.arcane();
    await this.view.setup(this.chess.board, true);
    await cam;
    this.busy = false;
    this.refresh();
    this.maybeAiMove();
  }

  private undo(): void {
    if (this.busy) return;
    if (this.chess.history.length === 0) {
      this.ui.snackbar('Nothing to undo');
      return;
    }
    const wasResigned = this.over && this.resigning !== null;
    if (wasResigned) return;
    this.cancelAi();
    this.deselect();
    this.chess.undo();
    if (this.mode === 'ai') {
      // Return the turn to the human.
      while (this.chess.turn !== this.human && this.chess.history.length) this.chess.undo();
    }
    this.over = false;
    this.fx.clear();
    void this.view.setup(this.chess.board, false);
    this.refresh();
    this.ui.snackbar('Move taken back');
    this.maybeAiMove();
  }

  private flip(): void {
    this.viewSide = other(this.viewSide);
    void this.stage.viewFrom(this.viewSide, 1.2);
  }

  /** Test / debugging hooks (exposed on window when the URL has ?debug). */
  debug() {
    return {
      chess: this.chess,
      play: (san: string) => {
        const legal = this.chess.moves();
        const m = legal.find((x) => this.chess.san(x, legal).replace(/[+#]/g, '') === san.replace(/[+#]/g, ''));
        if (m) void this.execute(m);
        return !!m;
      },
      busy: () => this.busy || this.thinking,
      select: (sq: number) => this.select(sq),
      camera: this.stage.camera,
      controls: this.stage.controls,
    };
  }
}
