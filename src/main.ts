import './style.css';
import { Game } from './game/game';

function showFatal(message: string): void {
  const loader = document.getElementById('loader');
  if (loader) loader.querySelector('p')!.textContent = message;
  loader?.querySelector('.loader__ring')?.remove();
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Let the loader paint before the (synchronous) scene construction starts.
requestAnimationFrame(() =>
  setTimeout(() => {
    if (!webglAvailable()) {
      showFatal('This duel needs WebGL. Please use a browser with hardware acceleration enabled.');
      return;
    }
    try {
      const game = new Game(document.getElementById('scene')!);
      if (new URLSearchParams(location.search).has('debug')) {
        (window as unknown as { game: Game }).game = game;
        game.maxStep = 0.25;
      }
      void game.start();
    } catch (err) {
      console.error(err);
      showFatal('The cathedral failed to load. See the console for details.');
    }
  }, 30),
);
