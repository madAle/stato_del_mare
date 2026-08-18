import type { CacheFrame } from "../data/cache";
import type { Ora } from "../data/indice";
import { PASSO_MS } from "../data/indice";
import type { Prefetcher } from "../data/prefetch";
import { inquadra } from "../data/sorgente";
import type { LivelloCampo } from "./campo";

export type StatoRiproduzione = "ferma" | "in riproduzione" | "in attesa di dati";

export type OpzioniAnimazione = {
  asse: Ora[];
  prefetcher: Prefetcher;
  cache: CacheFrame;
  /** Ogni quanto, al massimo, si riporta il tempo a chi ascolta. */
  passoRapportoMs?: number;
};

export class Animazione {
  /**
   * Chi ascolta il tempo corrente, chiamato al massimo dieci volte al secondo.
   *
   * E' il confine fra i due mondi: dentro si gira a 60 fotogrammi al secondo,
   * fuori c'e' React, che a 60 fps ricostruirebbe l'albero sessanta volte al
   * secondo per muovere un cursore di due pixel.
   */
  alTempo: (istante: number, stato: StatoRiproduzione) => void = () => {};

  private istante = 0;
  private oreAlSecondo = 4;
  private stato: StatoRiproduzione = "ferma";
  private ultimoRapporto = 0;
  private ultimoFotogramma = 0;
  private richiesta: number | null = null;

  constructor(private livello: LivelloCampo, private opzioni: OpzioniAnimazione) {}

  vaiA(istante: number): void {
    this.istante = istante;
    this.disegna();
    // Non forzato: vaiA viene chiamato a ripetizione mentre si trascina lo
    // scrubber, e forzare qui scavalcherebbe il limite dei dieci rapporti al
    // secondo esattamente nel punto (il trascinamento) dove servirebbe di
    // piu', riportando React alla frequenza del puntatore invece che a 10 Hz.
    this.riporta(false);
  }

  riproduci(): void {
    if (this.richiesta !== null) return;
    this.stato = "in riproduzione";
    this.ultimoFotogramma = performance.now();
    const passo = (adesso: number) => {
      this.avanza(adesso);
      this.richiesta = requestAnimationFrame(passo);
    };
    this.richiesta = requestAnimationFrame(passo);
  }

  pausa(): void {
    if (this.richiesta !== null) cancelAnimationFrame(this.richiesta);
    this.richiesta = null;
    this.stato = "ferma";
    this.riporta(true);
  }

  impostaVelocita(oreAlSecondo: number): void {
    this.oreAlSecondo = oreAlSecondo;
  }

  distruggi(): void {
    this.pausa();
  }

  private avanza(adesso: number): void {
    const trascorso = adesso - this.ultimoFotogramma;
    this.ultimoFotogramma = adesso;

    const prossimo = this.istante + (trascorso / 1000) * this.oreAlSecondo * PASSO_MS;
    const q = inquadra(this.opzioni.asse, prossimo);

    // Se il frame che servirebbe non c'e' ancora, il tempo NON avanza. Saltare
    // fotogrammi su un'animazione meteorologica falsa la percezione del
    // fenomeno, mentre una pausa breve si legge per quello che e'.
    if (q && !this.opzioni.prefetcher.pronto(q.prima)) {
      this.stato = "in attesa di dati";
      this.riporta(false);
      this.chiediAvanti();
      return;
    }

    this.stato = "in riproduzione";
    const ultimo = this.opzioni.asse.at(-1);
    this.istante = ultimo && prossimo > ultimo.istante ? this.opzioni.asse[0].istante : prossimo;
    this.disegna();
    this.riporta(false);
    this.chiediAvanti();
  }

  private chiediAvanti(): void {
    const i = this.indiceCorrente();
    if (i >= 0) void this.opzioni.prefetcher.assicura(this.opzioni.asse, i, 1);
  }

  private indiceCorrente(): number {
    const q = inquadra(this.opzioni.asse, this.istante);
    if (!q) return -1;
    return this.opzioni.asse.indexOf(q.prima);
  }

  private disegna(): void {
    const q = inquadra(this.opzioni.asse, this.istante);
    if (!q) return;
    const a = this.opzioni.cache.prendi(this.opzioni.prefetcher.chiave(q.prima));
    if (!a) return;
    const b = q.dopo
      ? this.opzioni.cache.prendi(this.opzioni.prefetcher.chiave(q.dopo)) ?? null
      : null;
    this.livello.imposta(a, b, b ? q.frazione : 0);
  }

  private riporta(forza: boolean): void {
    const adesso = performance.now();
    const passo = this.opzioni.passoRapportoMs ?? 100;
    if (!forza && adesso - this.ultimoRapporto < passo) return;
    this.ultimoRapporto = adesso;
    this.alTempo(this.istante, this.stato);
  }
}
