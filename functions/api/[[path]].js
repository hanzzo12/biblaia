// Pages Function: ყველა სხვა /api/* → JSON 404 (და არა index.html). კონკრეტული მარშრუტები (market, market/health) უპირატესია.
import { createWorker } from '../../worker/market-worker.js';

const worker = createWorker();

/** @param {{ request: Request, env: Record<string, unknown> }} context */
export function onRequest(context) {
  return worker.fetch(context.request, context.env || {});
}
