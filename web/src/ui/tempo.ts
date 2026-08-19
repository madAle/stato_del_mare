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

/**
 * Le tacche da disegnare sulla scala, scelte in base a quanto tempo copre.
 *
 * Il passo si adatta all'ampiezza perche' una tacca ogni sei ore su un archivio
 * di settimane diventa una riga nera, e una al giorno su una finestra di dodici
 * ore non ne mostra nessuna. Le tacche cadono su ore tonde UTC, non su
 * multipli dal primo istante dell'asse: una scala che comincia alle 03:00 e
 * segna 09:00, 15:00, 21:00 e' leggibile, una che segna 03:00, 09:00, 15:00
 * lo e' molto meno.
 */
export function tacche(da: number, a: number): { istante: number; mezzanotte: boolean }[] {
  const ore = (a - da) / ORA_MS;
  if (!Number.isFinite(ore) || ore <= 0) return [];
  const passoOre = ore <= 36 ? 6 : ore <= 96 ? 12 : ore <= 336 ? 24 : 48;

  const passo = passoOre * ORA_MS;
  const prima = Math.ceil(da / passo) * passo;
  const trovate: { istante: number; mezzanotte: boolean }[] = [];
  for (let t = prima; t <= a; t += passo) {
    trovate.push({ istante: t, mezzanotte: new Date(t).getUTCHours() === 0 });
  }
  return trovate;
}
