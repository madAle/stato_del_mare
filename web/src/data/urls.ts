/**
 * L'unico modulo che conosce gli URL del bucket.
 *
 * Se un domani servisse un intermediario fra il browser e l'archivio, si cambia
 * qui e nient'altro: e' la ragione per cui questo modulo esiste separato invece
 * di comporre le stringhe dove servono.
 */
export const ORIGINE = "https://pub-58d91a839da640f8ab33e576c44b89c8.r2.dev";

export type Tipo = "an" | "fc";

export function urlCatalogo(): string {
  return `${ORIGINE}/catalog.json`;
}

export function urlIndice(variabile: string, tipo: Tipo, mese: string): string {
  return `${ORIGINE}/index/${variabile}/${tipo}/${mese}.json`;
}

export function urlFrame(
  variabile: string,
  tipo: Tipo,
  riferimento: string,
  valido: Date,
): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const chiave =
    `${valido.getUTCFullYear()}-${p(valido.getUTCMonth() + 1)}-${p(valido.getUTCDate())}` +
    `T${p(valido.getUTCHours())}${p(valido.getUTCMinutes())}`;
  return `${ORIGINE}/frames/${variabile}/${tipo}/${riferimento}/${chiave}.bin`;
}

/** Prefisso di tutto cio' che serve alla basemap vettoriale (font, sprite, tile). */
export function urlBasemap(): string {
  return `${ORIGINE}/basemap`;
}

/** Modello di URL dei glifi, col segnaposto che MapLibre sostituisce da solo. */
export function urlGlifi(): string {
  return `${urlBasemap()}/fonts/{fontstack}/{range}.pbf`;
}

export function urlSprite(): string {
  return `${urlBasemap()}/sprites/light`;
}

export function urlPmtiles(): string {
  return `${urlBasemap()}/adriatico.pmtiles`;
}
