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
  private rapportoInSospeso: number | null = null;
  // Distingue una programmazione del rapporto in coda dalla successiva: senza
  // un token, un vecchio giro rimasto in coda (cancelAnimationFrame non lo
  // toglie sempre, per esempio nei test) consegnerebbe un rapporto doppio.
  private tokenRapporto = 0;

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
      // Se avanza() ha chiamato alTempo e chi ascolta ha richiamato pausa()
      // (o distruggi()) in modo sincrono, richiesta e' gia' stata azzerata:
      // rischedulare comunque qui farebbe ripartire un ciclo che chi ha
      // chiamato pausa() crede di aver fermato.
      if (this.richiesta !== null) this.richiesta = requestAnimationFrame(passo);
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
    // pausa() forza gia' un rapporto, che annulla la coda: annullarla di
    // nuovo qui e' esplicito e non dipende da quella catena di chiamate, se
    // in futuro pausa() cambiasse non lascerebbe un timer vivo dopo lo
    // smontaggio.
    this.annullaRapportoInSospeso();
  }

  private avanza(adesso: number): void {
    const trascorso = adesso - this.ultimoFotogramma;
    this.ultimoFotogramma = adesso;

    const grezzo = this.istante + (trascorso / 1000) * this.oreAlSecondo * PASSO_MS;
    // Il riavvolgimento va calcolato PRIMA di interrogare inquadra/pronto: se
    // si interroga su "grezzo" quando questo e' oltre l'ultimo istante,
    // inquadra torna null (fuori intervallo) e il controllo di prontezza va
    // in cortocircuito senza aver mai guardato il fotogramma vero, cioe'
    // quello iniziale su cui si sta per riavvolgere.
    const ultimo = this.opzioni.asse.at(-1);
    const prossimo = ultimo && grezzo > ultimo.istante ? this.opzioni.asse[0].istante : grezzo;
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
    this.istante = prossimo;
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
    if (!forza && adesso - this.ultimoRapporto < passo) {
      // Strozzato, ma non perso: senza mettersi in coda, un rapporto che cade
      // qui e non seguito da nessun altro (per esempio l'ultimo vaiA di un
      // trascinamento dello scrubber, a riproduzione ferma) non arriverebbe
      // mai, perche' da fermi non gira nessun ciclo che lo recuperi. Chi
      // ascolta resterebbe con l'ora vecchia a tempo indefinito.
      this.programmaRapportoInSospeso(this.ultimoRapporto + passo);
      return;
    }
    this.annullaRapportoInSospeso();
    this.ultimoRapporto = adesso;
    this.alTempo(this.istante, this.stato);
  }

  /** Consegna l'ultimo valore alla chiusura della finestra di throttle. */
  private programmaRapportoInSospeso(scadenza: number): void {
    this.annullaRapportoInSospeso(); // sostituisce un eventuale rapporto gia' in coda
    const mioToken = this.tokenRapporto;
    const controlla = () => {
      // Un giro precedente rimasto in coda (annulla non lo toglie sempre,
      // vedi il commento sul campo tokenRapporto): se il token non combacia
      // piu', questo giro e' superato e non deve fare niente.
      if (mioToken !== this.tokenRapporto) return;
      if (performance.now() >= scadenza) {
        this.rapportoInSospeso = null;
        this.riporta(true);
        return;
      }
      this.rapportoInSospeso = requestAnimationFrame(controlla);
    };
    this.rapportoInSospeso = requestAnimationFrame(controlla);
  }

  private annullaRapportoInSospeso(): void {
    if (this.rapportoInSospeso !== null) cancelAnimationFrame(this.rapportoInSospeso);
    this.rapportoInSospeso = null;
    this.tokenRapporto++;
  }
}
