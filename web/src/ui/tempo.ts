/**
 * Come si scrive un istante, in un posto solo.
 *
 * Il dato e' riferito a un istante UTC fisso (`ocean_time`, non l'ora locale di
 * chi guarda): due persone in fusi diversi guardano lo stesso frame, quindi si
 * formatta sempre in UTC e lo si dichiara a schermo. Senza la sigla, chi legge
 * assume la propria ora e sbaglia di un'ora o due sul mare in tempesta.
 *
 * Stanno insieme perche' l'orologio del pannello in alto e le etichette della
 * scala in basso devono dire la stessa cosa: due formattatori separati sono il
 * modo in cui due parti dello schermo cominciano a contraddirsi.
 */

const GIORNO_E_ORA = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const SOLO_GIORNO = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const SOLO_ORA = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
});

/** Per esempio "mer 19/08, 09:00 UTC". */
export function istanteEsteso(istante: number): string {
  return `${GIORNO_E_ORA.format(istante)} UTC`;
}

/** Per esempio "mer 19/08", per le tacche di mezzanotte. */
export function soloGiorno(istante: number): string {
  return SOLO_GIORNO.format(istante);
}

/** Per esempio "06:00", per le tacche intermedie. */
export function soloOra(istante: number): string {
  return SOLO_ORA.format(istante);
}

export const ORA_MS = 3_600_000;

/** I passi ammessi, in ore: si sale di qui quando le etichette non ci stanno. */
const SCALA_ORE = [6, 12, 24, 48, 96, 168, 336];

/**
 * Le tacche da disegnare sulla scala.
 *
 * Il passo dipende da due cose, e all'inizio ne guardava una sola. L'ampiezza
 * temporale, perche' una tacca ogni sei ore su un archivio di settimane diventa
 * una riga nera e una al giorno su una finestra di dodici ore non ne mostra
 * nessuna. E **quante etichette ci stanno davvero**, che e' una misura in pixel
 * e non in ore: su un telefono, con l'asse aperto su tutto l'archivio, otto
 * etichette da giorno larghe 55 px finivano in 335 px di scala, una sopra
 * l'altra (visto su iPhone il 2026-08-19). Un filtro che scarta le etichette
 * troppo vicine non basta, perche' lascerebbe buchi irregolari: si allarga il
 * passo, che tiene la scala uniforme.
 *
 * Le tacche cadono su ore tonde UTC, non su multipli dal primo istante
 * dell'asse: una scala che comincia alle 03:00 e segna 09:00, 15:00, 21:00 e'
 * leggibile, una che segna 03:00, 09:00, 15:00 lo e' molto meno.
 *
 * `massimo` e' quante etichette ci stanno. Assente vuol dire "non lo so": si
 * decide con la sola ampiezza, cioe' come prima di questa misura.
 */
export function tacche(
  da: number, a: number, massimo = Number.POSITIVE_INFINITY,
): { istante: number; mezzanotte: boolean }[] {
  const ore = (a - da) / ORA_MS;
  if (!Number.isFinite(ore) || ore <= 0) return [];
  let passoOre = ore <= 36 ? 6 : ore <= 96 ? 12 : ore <= 336 ? 24 : 48;
  while (ore / passoOre > massimo) {
    const piuLargo = SCALA_ORE.find((p) => p > passoOre);
    if (piuLargo === undefined) break;
    passoOre = piuLargo;
  }

  const passo = passoOre * ORA_MS;
  const prima = Math.ceil(da / passo) * passo;
  const trovate: { istante: number; mezzanotte: boolean }[] = [];
  for (let t = prima; t <= a; t += passo) {
    trovate.push({ istante: t, mezzanotte: new Date(t).getUTCHours() === 0 });
  }
  return trovate;
}
