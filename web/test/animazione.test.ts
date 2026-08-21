import { beforeEach, describe, expect, it, vi } from "vitest";
import { CacheFrame } from "../src/data/cache";
import type { Ora } from "../src/data/indice";
import { Prefetcher } from "../src/data/prefetch";
import { Animazione } from "../src/map/animazione";
import type { ComponenteFrame } from "../src/map/campo";

const asse: Ora[] = Array.from({ length: 24 }, (_, i) => ({
  istante: Date.UTC(2026, 7, 15, i),
  tipo: "an" as const,
  riferimento: "20260815",
}));

/** Un finto livello che registra cosa gli e' stato chiesto di disegnare. */
function livelloFinto() {
  const chiamate: { frazione: number; haB: boolean; voci: number }[] = [];
  return {
    chiamate,
    imposta(componenti: ComponenteFrame[], frazione: number) {
      chiamate.push({ frazione, haB: componenti[0].b !== null, voci: componenti.length });
    },
  };
}

let adesso = 0;
let attivita: FrameRequestCallback[] = [];

beforeEach(() => {
  adesso = 0;
  attivita = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    attivita.push(cb);
    return attivita.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => adesso });
});

/** Fa passare il tempo simulando fotogrammi a 60 Hz. */
function avanza(ms: number) {
  const passi = Math.round(ms / 16.67);
  for (let i = 0; i < passi; i++) {
    adesso += 16.67;
    const daEseguire = attivita;
    attivita = [];
    for (const cb of daEseguire) cb(adesso);
  }
}

describe("animazione", () => {
  it("riporta il tempo al massimo dieci volte al secondo", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, "hwave", async () => new Int16Array(10), 12);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const riportati: number[] = [];

    const a = new Animazione(livello as never, { asse: { current: asse }, prefetcherCampi: { current: [p] }, cache });
    a.alTempo = (istante) => riportati.push(istante);
    a.vaiA(asse[0].istante);
    a.impostaVelocita(1);
    a.riproduci();
    avanza(1000);

    // a 60 fotogrammi al secondo il ciclo gira circa 60 volte, ma chi ascolta
    // sente al massimo 10 volte: e' la riga che tiene React fuori dai 60 fps
    expect(riportati.length).toBeLessThanOrEqual(11);
    expect(riportati.length).toBeGreaterThan(5);
    expect(livello.chiamate.length).toBeGreaterThan(30);
  });

  it("si mette in attesa invece di saltare fotogrammi", async () => {
    const cache = new CacheFrame();
    // solo le prime due ore sono caricabili
    const p = new Prefetcher(cache, "hwave", async (ora: Ora) => {
      if (ora.istante > asse[1].istante) throw new Error("non disponibile");
      return new Int16Array(10);
    }, 2);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const stati: string[] = [];

    const a = new Animazione(livello as never, { asse: { current: asse }, prefetcherCampi: { current: [p] }, cache });
    a.alTempo = (_i, stato) => stati.push(stato);
    a.vaiA(asse[0].istante);
    a.impostaVelocita(4);
    a.riproduci();
    avanza(2000);

    // Saltare fotogrammi su un'animazione meteorologica falsa la percezione del
    // fenomeno; una pausa breve si legge per quello che e'.
    expect(stati).toContain("in attesa di dati");
    expect(stati).not.toContain("ferma");
  });

  it("dentro un buco non chiede l'interpolazione", async () => {
    const bucato: Ora[] = [asse[0], asse[1], { ...asse[10] }];
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, "hwave", async () => new Int16Array(10), 5);
    await p.assicura(bucato, 0, 1);
    const livello = livelloFinto();

    const a = new Animazione(livello as never, { asse: { current: bucato }, prefetcherCampi: { current: [p] }, cache });
    a.vaiA(bucato[1].istante + 1_800_000); // mezz'ora dentro il buco
    expect(livello.chiamate.at(-1)).toEqual({ frazione: 0, haB: false, voci: 1 });
  });

  it("il rapporto strozzato in vaiA arriva comunque, in coda", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, "hwave", async () => new Int16Array(10), 5);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const riportati: number[] = [];

    const a = new Animazione(livello as never, { asse: { current: asse }, prefetcherCampi: { current: [p] }, cache });
    a.alTempo = (istante) => riportati.push(istante);
    a.vaiA(asse[0].istante);
    a.vaiA(asse[1].istante); // seconda chiamata nella stessa finestra di 100 ms

    // senza una coda, questo rapporto si perderebbe per sempre: da fermi non
    // gira nessun ciclo rAF che lo recuperi, e l'etichetta dell'ora resterebbe
    // quella vecchia a tempo indefinito
    expect(riportati).toEqual([]);
    avanza(150);

    expect(riportati).toEqual([asse[1].istante]);
  });

  it("pausa() chiamata da dentro alTempo ferma davvero il ciclo", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, "hwave", async () => new Int16Array(10), 12);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    let chiamate = 0;

    // passoRapportoMs a zero: ogni rapporto passa subito, cosi' il conteggio
    // misura solo se il ciclo rAF si ferma davvero, senza l'interferenza
    // della coda dei rapporti strozzati.
    const a = new Animazione(livello as never, {
      asse: { current: asse }, prefetcherCampi: { current: [p] }, cache, passoRapportoMs: 0,
    });
    // pausa() forza a sua volta un rapporto: senza il controllo sullo stato
    // qui, quel rapporto rientrerebbe in questa stessa funzione all'infinito.
    // Il caso vero che si vuole coprire e' un solo pausa() richiamato da
    // dentro un rapporto di riproduzione in corso, non una chiamata ricorsiva
    // a se stessa.
    a.alTempo = (_i, stato) => {
      chiamate++;
      if (stato === "in riproduzione") a.pausa();
    };
    a.vaiA(asse[0].istante);
    a.impostaVelocita(1);
    a.riproduci();
    avanza(1000);

    // senza la guardia su richiesta, passo() rischedula comunque: in un
    // secondo simulato il ciclo girerebbe circa 60 volte, con pausa()
    // richiamata a ogni giro, anche se il primo pausa() dovrebbe averlo
    // fermato per sempre
    expect(chiamate).toBeLessThanOrEqual(6);
  });

  it("vaiA assicura da solo il fotogramma, e ridisegna quando arriva", async () => {
    // A differenza di tutti i test sopra, qui non c'e' nessun
    // p.assicura(...) manuale prima di vaiA: e' esattamente il caso reale
    // dell'apertura dell'app o di un salto dello scrubber, dove prima di
    // questa correzione la cache restava vuota per sempre (disegna() si
    // fermava in silenzio, e la mappa restava senza campo finche' non si
    // premeva "riproduci").
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, "hwave", carica, 5);
    const livello = livelloFinto();

    const a = new Animazione(livello as never, { asse: { current: asse }, prefetcherCampi: { current: [p] }, cache });
    a.vaiA(asse[3].istante);

    // Sincrono: il dato non c'e' ancora, vaiA non puo' aspettare assicura().
    expect(livello.chiamate).toEqual([]);

    // assicura() e' asincrona: aspetta che si risolva, poi il ridisegno deve
    // essere arrivato da solo.
    await vi.waitFor(() => expect(livello.chiamate.length).toBeGreaterThan(0));
    expect(p.pronto(asse[3])).toBe(true);
  });

  it("vaiA sullo stesso indice non rilancia una nuova richiesta", async () => {
    // La finestra dedica gia' la propria deduplica ai singoli fotogrammi
    // (cache e richieste in volo), ma qui si controlla che vaiA stesso non
    // richiami assicura() a ogni chiamata quando l'ora scelta non e'
    // cambiata: altrimenti ogni evento di trascinamento sullo stesso punto
    // (o un rapporto ridondante) ricalcolerebbe la finestra da capo.
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, "hwave", carica, 5);
    const assicura = vi.spyOn(p, "assicura");
    const livello = livelloFinto();

    const a = new Animazione(livello as never, { asse: { current: asse }, prefetcherCampi: { current: [p] }, cache });
    a.vaiA(asse[3].istante);
    await vi.waitFor(() => expect(livello.chiamate.length).toBeGreaterThan(0));
    const chiamateDopoPrimoVaiA = assicura.mock.calls.length;

    a.vaiA(asse[3].istante); // stessa ora, per esempio un rapporto ridondante
    a.vaiA(asse[3].istante);
    expect(assicura.mock.calls.length).toBe(chiamateDopoPrimoVaiA);
  });

  it("segue un asse nuovo scritto nello stesso ref, senza bisogno di una nuova istanza", async () => {
    // Come MapView.tsx: App ricrea l'asse quando i dati cambiano (per
    // esempio un refetch di React Query), ma Animazione vive per tutta la
    // vita della mappa. Se leggesse un valore fisso preso alla costruzione
    // invece del ref, continuerebbe a lavorare per sempre sull'asse
    // originale mentre lo scrubber (che rilegge le prop a ogni render)
    // passerebbe in silenzio a quello nuovo.
    const cache = new CacheFrame();
    const carica = vi.fn(async () => new Int16Array(10));
    const p = new Prefetcher(cache, "hwave", carica, 5);
    const livello = livelloFinto();

    const asseRef = { current: asse.slice(0, 2) }; // solo le prime due ore
    const a = new Animazione(livello as never, {
      asse: asseRef, prefetcherCampi: { current: [p] }, cache,
    });

    // Un istante fuori dall'asse iniziale (di due sole ore): inquadra torna
    // null, quindi vaiA non disegna niente.
    a.vaiA(asse[5].istante);
    expect(livello.chiamate).toEqual([]);

    // Lo stesso ref, riscritto con l'asse esteso: nessuna nuova Animazione.
    asseRef.current = asse;
    a.vaiA(asse[5].istante);
    await vi.waitFor(() => expect(livello.chiamate.length).toBeGreaterThan(0));
    expect(p.pronto(asse[5])).toBe(true);
  });

  it("il riavvolgimento controlla la prontezza del fotogramma 0 prima di dichiararsi in riproduzione", async () => {
    const corto: Ora[] = [asse[0], asse[1]];
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, "hwave", async (ora: Ora) => {
      if (ora.istante === corto[0].istante) throw new Error("fotogramma 0 non disponibile");
      return new Int16Array(10);
    }, 5);
    await p.assicura(corto, 1, 1); // si carica solo l'ultimo fotogramma
    const livello = livelloFinto();
    const stati: string[] = [];

    const a = new Animazione(livello as never, {
      asse: { current: corto }, prefetcherCampi: { current: [p] }, cache, passoRapportoMs: 0,
    });
    a.alTempo = (_i, stato) => stati.push(stato);
    a.vaiA(corto[1].istante);
    a.impostaVelocita(1);
    a.riproduci();
    avanza(20);

    expect(stati).toContain("in attesa di dati");
    expect(stati).not.toContain("in riproduzione");
  });
});

describe("fermi si sta sempre su un'ora", () => {
  it("la pausa si aggancia all'ora piu' vicina", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, "hwave", async () => new Int16Array(10), 12);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const riportati: number[] = [];

    const a = new Animazione(livello as never, { asse: { current: asse }, prefetcherCampi: { current: [p] }, cache });
    a.alTempo = (istante) => riportati.push(istante);
    // un istante a 40 minuti dentro l'ora, cioe' piu' vicino all'ora dopo
    a.vaiA(asse[3].istante + 40 * 60_000);
    a.pausa();

    // Il dato e' orario: fermarsi fra due ore vorrebbe dire mostrare per sempre
    // una dissolvenza, cioe' un istante che il modello non ha mai calcolato.
    expect(riportati.at(-1)).toBe(asse[4].istante);
  });

  it("su un'ora esatta la pausa non sposta niente", async () => {
    const cache = new CacheFrame();
    const p = new Prefetcher(cache, "hwave", async () => new Int16Array(10), 12);
    await p.assicura(asse, 0, 1);
    const livello = livelloFinto();
    const riportati: number[] = [];

    const a = new Animazione(livello as never, { asse: { current: asse }, prefetcherCampi: { current: [p] }, cache });
    a.alTempo = (istante) => riportati.push(istante);
    a.vaiA(asse[5].istante);
    a.pausa();

    expect(riportati.at(-1)).toBe(asse[5].istante);
  });
});

describe("una grandezza a piu' campi (la corrente, spenta oggi ma gia' cablata)", () => {
  it("non disegna finche' non sono pronti TUTTI i campi, non solo il primo", () => {
    // E' il rischio scritto nel commento su u_haB in campo.ts: se disegna()
    // procedesse col primo campo pronto e ignorasse gli altri, un campo
    // vettoriale mostrerebbe una componente vera e una vecchia (o vuota),
    // cioe' un modulo plausibile e sbagliato.
    //
    // Il dato si mette in cache con `cache.metti` e non con `p.assicura`: vaiA
    // avvia da solo un prefetch di sfondo sul PRIMO campo (assicuraFinestra
    // guarda solo quello, vedi il commento in OpzioniAnimazione), e con
    // `assicura` in mezzo un `await` gli darebbe il tempo di completarsi,
    // popolando anche l'ora dopo di ubar prima che questo test possa
    // guardare lo stato che vuole controllare.
    const cache = new CacheFrame();
    const ubar = new Prefetcher(cache, "ubar", async () => new Int16Array(10), 5);
    const vbar = new Prefetcher(cache, "vbar", async () => new Int16Array(10), 5);
    cache.metti(ubar.chiave(asse[0]), new Int16Array(10)); // solo ubar e' pronto
    const livello = livelloFinto();

    const a = new Animazione(livello as never, {
      asse: { current: asse }, prefetcherCampi: { current: [ubar, vbar] }, cache,
    });
    a.vaiA(asse[0].istante);

    expect(livello.chiamate).toEqual([]);

    cache.metti(vbar.chiave(asse[0]), new Int16Array(10)); // ora anche vbar e' pronto
    a.vaiA(asse[0].istante); // stesso istante: disegna() rilegge la cache da capo

    // Ne' ubar ne' vbar hanno l'ora dopo: haB e' falso e la frazione e' zero,
    // ma la cosa che questo test prova e' voci:2, cioe' che disegna() non si
    // e' fermato al primo campo pronto.
    expect(livello.chiamate.at(-1)).toEqual({ frazione: 0, haB: false, voci: 2 });
  });

  it("la dissolvenza vale solo se OGNI campo ha l'ora dopo, non solo il primo", () => {
    // Un vettore con una componente ferma su un'ora sola e l'altra a meta'
    // sarebbe fatto di due istanti diversi: e' lo stesso principio della
    // guardia su u_haB, applicato qui a quale frazione passare al livello.
    const cache = new CacheFrame();
    const ubar = new Prefetcher(cache, "ubar", async () => new Int16Array(10), 5);
    const vbar = new Prefetcher(cache, "vbar", async () => new Int16Array(10), 5);
    cache.metti(ubar.chiave(asse[0]), new Int16Array(10));
    cache.metti(ubar.chiave(asse[1]), new Int16Array(10)); // ubar: ora 0 E ora 1
    cache.metti(vbar.chiave(asse[0]), new Int16Array(10)); // vbar: SOLO l'ora 0
    const livello = livelloFinto();

    const a = new Animazione(livello as never, {
      asse: { current: asse }, prefetcherCampi: { current: [ubar, vbar] }, cache,
    });
    // Trenta minuti dentro l'ora: se la frazione non fosse azzerata dalla
    // guardia, qui varrebbe circa 0,5 (meta' strada verso l'ora dopo), non
    // zero. E' quel valore diverso da zero che questo test esclude.
    a.vaiA(asse[0].istante + 30 * 60_000);

    // Entrambi hanno il fotogramma A, quindi disegna() procede; ubar ha anche
    // B (haB riflette componenti[0], cioe' ubar). Ma vbar non ha B: se la
    // frazione fosse quella naturale (~0,5) si interpolerebbe ubar verso
    // l'ora dopo mentre vbar resta fermo sull'ora prima, un vettore fatto di
    // due istanti diversi.
    expect(livello.chiamate.at(-1)).toEqual({ frazione: 0, haB: true, voci: 2 });
  });
});
