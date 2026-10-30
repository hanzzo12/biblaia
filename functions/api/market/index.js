// Cloudflare Pages Function: GET /api/market?location=<ID>&currency=<EUR|USD>
// თხელი შეფუთვა worker/market-worker.js-ზე (იგივე ლოგიკა, რაც Workers-ის გზაზე).
// context.env: APIFY_TOKEN (Secret), MARKET_CACHE (KV binding, სურვილისამებრ), MARKET_* ცვლადები (სურვილისამებრ — ნაგულისხმევები კოდშია).
// Rate limiting binding Pages-ზე არ არის — Worker-ის ლოგიკა მას უსაფრთხოდ ტოვებს.
import { createWorker } from '../../../worker/market-worker.js';

const worker = createWorker();

/** @param {{ request: Request, env: Record<string, unknown> }} context */
export function onRequest(context) {
  return worker.fetch(context.request, context.env || {});
}
