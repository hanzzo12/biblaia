// PDF-ის ფონტები: Noto Sans Georgian (OFL) — WOFF ფაილები @fontsource-დან, ჩაშენებული build-ისას.
// WOFF (zlib) → TrueType ბრაუზერში DecompressionStream-ით; WOFF2 (brotli) არ გამოიყენება.
import geoR from '../../../node_modules/@fontsource/noto-sans-georgian/files/noto-sans-georgian-georgian-400-normal.woff' with { type: 'bytes' };
import geoB from '../../../node_modules/@fontsource/noto-sans-georgian/files/noto-sans-georgian-georgian-700-normal.woff' with { type: 'bytes' };
import latR from '../../../node_modules/@fontsource/noto-sans-georgian/files/noto-sans-georgian-latin-400-normal.woff' with { type: 'bytes' };
import latB from '../../../node_modules/@fontsource/noto-sans-georgian/files/noto-sans-georgian-latin-700-normal.woff' with { type: 'bytes' };
import { woffToFont } from './sfnt.js';

let loaded = null;
/** @returns {Promise<{ geo: any, geoBold: any, lat: any, latBold: any }>} */
export function loadPdfFonts() {
  if (!loaded) {
    loaded = Promise.all([woffToFont(geoR, 'NotoSansGeorgian'), woffToFont(geoB, 'NotoSansGeorgian-Bold'), woffToFont(latR, 'NotoSansGeorgianLatin'), woffToFont(latB, 'NotoSansGeorgianLatin-Bold')])
      .then(([geo, geoBold, lat, latBold]) => ({ geo, geoBold, lat, latBold }));
    loaded.catch(() => { loaded = null; });
  }
  return loaded;
}
