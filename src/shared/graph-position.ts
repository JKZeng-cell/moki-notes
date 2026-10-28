import { z } from 'zod';
export const GraphPosition = z.object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }).strict();
export type GraphPoint = z.infer<typeof GraphPosition>;
export type GraphPositions = Record<string, GraphPoint>;
export function moveGraphPoint(origin: GraphPoint, dx: number, dy: number, scale: number): GraphPoint {
  return { x: Math.max(-100000, Math.min(100000, origin.x + dx * scale)), y: Math.max(-100000, Math.min(100000, origin.y + dy * scale)) };
}
