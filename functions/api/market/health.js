// Cloudflare Pages Function: GET /api/market/health — კონფიგურაციის მდგომარეობა (ტოკენის მნიშვნელობის გარეშე).
import { createWorker } from '../../../worker/market-worker.js';

const worker = createWorker();

/** @param {{ request: Request, env: Record<string, unknown> }} context */
export function onRequest(context) {
  return worker.fetch(context.request, context.env || {});
}
