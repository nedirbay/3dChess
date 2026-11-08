/// <reference lib="webworker" />
import { search, type Difficulty } from './ai';

export interface AiRequest {
  id: number;
  fen: string;
  difficulty: Difficulty;
}

export interface AiResponse {
  id: number;
  from: number;
  to: number;
  promotion?: string;
  score: number;
  depth: number;
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, fen, difficulty } = e.data;
  const result = search(fen, difficulty);
  if (!result.move) return;
  const res: AiResponse = {
    id,
    from: result.move.from,
    to: result.move.to,
    promotion: result.move.promotion,
    score: result.score,
    depth: result.depth,
  };
  (self as unknown as Worker).postMessage(res);
};
