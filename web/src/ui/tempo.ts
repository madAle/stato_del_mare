/**
 * Come si scrive un istante, in un posto solo.
 *
 * **Nell'ora dell'Adriatico** (deciso il 2026-08-21, prima era UTC). Chi guarda
 * il mare per sapere se domattina si esce confronta l'ora con l'orologio che ha
 * al polso, e una sottrazione da fare a mente e' una sottrazione che qualcuno
 * sbagliera'.
 *
 * Il fuso e' **fisso a Europe/Rome**, non quello della macchina che disegna. Il
 * dato e' riferito a un istante assoluto (`ocean_time`), quindi lo stesso
 * fotogramma deve leggersi con la stessa ora da Roma, da New York e da Tokyo: se
 * il fuso venisse dal browser, uno screenshot o un link condiviso direbbero cose
 * diverse a chi li apre, e dall'estero l'ora scritta non sarebbe piu' quella del
 * mare. Ha una seconda conseguenza, sui test: fissato il fuso, le stringhe non
 * dipendono dalla macchina, e restano uguali in CI, che gira a UTC.
 *
 * **La sigla resta.** Era la ragione per cui UTC funzionava (senza, chi legge
 * assume il proprio fuso e sbaglia di un'ora o due sul mare in tempesta), e vale
 * identica adesso: "CEST" dice quale ora e', "11:00" da solo no. Cambia da se'
 * fra ora legale e ora solare.
 *
 * Stanno insieme perche' l'orologio del pannello in alto e le etichette della
 * scala in basso devono dire la stessa cosa: due formattatori separati sono il
 * modo in cui due parti dello schermo cominciano a contraddirsi.
 */

/** L'ora del mare di cui si parla. Un posto solo, per la ragione qui sopra. */
const FUSO = "Europe/Rome";

const GIORNO_E_ORA = new Intl.DateTimeFormat("it-IT", {
  timeZone: FUSO,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // La sigla la scrive Intl, non noi: "CEST" d'estate e "CET" d'inverno, senza
  // che nessuno debba sapere quando cade l'ultima domenica di marzo.
  timeZoneName: "short",
});

const SOLO_GIORNO = new Intl.DateTimeFormat("it-IT", {
  timeZone: FUSO,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const SOLO_ORA = new Intl.DateTimeFormat("it-IT", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Le parti dell'orologio locale, per fare i conti sulle tacche.
 *
 * `Date.getTimezoneOffset()` non va: darebbe il fuso della macchina, che e'
 * quello di chi guarda solo per caso e in CI e' Greenwich.
 */
const PARTI = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/**
 * L'orologio locale di un istante, espresso come se fosse UTC.
 *
 * Serve per ragionare in ore tonde di chi legge: in questo spazio la mezzanotte
 * e' un multiplo esatto di 24 ore e le sei del mattino di sei, cosa che
 * sull'istante vero non e' mai vera.
 */
function orologio(istante: number): number {
  const p: Record<string, number> = {};
  for (const parte of PARTI.formatToParts(istante)) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * L'istante vero di un orologio locale: l'inverso di `orologio`.
 *
 * Due passaggi e non uno: lo scarto si stima sull'orologio (che di scarto non ne
 * sa niente, quindi lo si legge un'ora o due prima del vero), poi si ricalcola
 * sull'istante ottenuto.
 *
 * **Il secondo passaggio, oggi, non cambia nessun risultato, e questo e'
 * misurato**: togliendolo, i test dell'ora legale restano verdi. Il motivo e'
 * che i due passaggi si separano solo per un orologio che cade **dentro l'ora
 * che il cambio di primavera salta** (le 02:00 dell'ultima domenica di marzo,
 * che quel giorno non esiste), e i passi di `SCALA_ORE` sono tutti multipli di
 * sei ore: una tacca cade alle 00, 06, 12 o 18, mai alle 02. Resta qui perche'
 * il giorno che qualcuno aggiunge un passo di un'ora o di tre, una tacca in
 * quell'ora ci finisce, e la differenza sarebbe una tacca all'01:00 su una
 * scala che dice di segnare ore tonde: un difetto che si vede una notte
 * all'anno, cioe' che non si trova mai.
 *
 * Il residuo, dichiarato: nell'ora che il cambio salta o ripete un orologio non
 * identifica un istante solo, e non c'e' scelta giusta. Con due passaggi
 * l'orologio inesistente cade sull'ora dopo, che e' la convenzione consueta.
 */
function istanteDi(orologioLocale: number): number {
  const stima = orologio(orologioLocale) - orologioLocale;
  return orologioLocale - (orologio(orologioLocale - stima) - (orologioLocale - stima));
}

/** Per esempio "mer 19/08, 11:00 CEST". */
export function istanteEsteso(istante: number): string {
  return GIORNO_E_ORA.format(istante);
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
const GIORNO_MS = 24 * ORA_MS;

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
 * Le tacche cadono su ore tonde **locali**, non su multipli dal primo istante
 * dell'asse: una scala che comincia alle 03:00 e segna 09:00, 15:00, 21:00 e'
 * leggibile, una che segna 03:00, 09:00, 15:00 lo e' molto meno. Tonde per chi
 * legge e non per Greenwich: con le tacche calcolate in UTC e le etichette
 * scritte in locale, la scala segnerebbe 05:00, 11:00, 17:00 e la mezzanotte
 * cadrebbe sulla tacca delle 02:00.
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
  const trovate: { istante: number; mezzanotte: boolean }[] = [];
  // Si conta sull'orologio locale e si torna all'istante vero a ogni tacca:
  // e' l'unico modo perche' l'ora tonda resti tonda anche dopo un cambio d'ora.
  for (let l = Math.ceil(orologio(da) / passo) * passo; ; l += passo) {
    const istante = istanteDi(l);
    if (istante > a) break;
    if (istante >= da) trovate.push({ istante, mezzanotte: l % GIORNO_MS === 0 });
  }
  return trovate;
}
