// Worker-ის შესასვლელი წერტილი. მხოლოდ default export — workerd დასახელებულ export-ებს entrypoint-ებად თვლის.
// ლოგიკა და ტესტირებადი დამხმარეები: ./market-worker.js
import { createWorker } from './market-worker.js';

export default createWorker();
