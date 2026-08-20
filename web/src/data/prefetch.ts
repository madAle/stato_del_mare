import type { CacheFrame } from "./cache";
import type { Ora } from "./indice";

/**
 * Tiene piena la finestra davanti al cursore, nella direzione in cui si va.
 *
 * A 4 fotogrammi al secondo servono circa 600 KB/s di rete. Se il buffer si
 * svuota **la riproduzione si mette in pausa**, non salta fotogrammi: su
 * un'animazione meteorologica saltare falsa la percezione del fenomeno, mentre
 * una pausa breve si legge per quello che e'. Chi decide di fermarsi e' il
 * ciclo di animazione (Task 12); questo modulo gli dice solo cosa e' pronto.
 */
export class Prefetcher {
  private inCorso = new Map<string, Promise<void>>();

  constructor(
    private cache: CacheFrame,
    /**
     * La variabile che questo prefetcher scarica. Serve **nella chiave**, non
     * solo nell'URL: la cache dei fotogrammi e' una sola e sopravvive al cambio
     * di variabile (e' un `useMemo` senza dipendenze, come dev'essere: buttarla
     * a ogni cambio farebbe riscaricare tutto tornando indietro). Senza la
     * variabile nella chiave, passando da altezza d'onda a periodo la cache
     * servirebbe i fotogrammi dell'onda come se fossero secondi: numeri
     * plausibili e sbagliati, senza nessun errore da nessuna parte. Finche' si
     * disegnava una variabile sola il difetto dormiva.
     */
    private variabile: string,
    private carica: (ora: Ora) => Promise<Int16Array>,
    private avanti = 10,
  ) {}

  chiave(ora: Ora): string {
    return `${this.variabile}/${ora.tipo}/${ora.riferimento}/${ora.istante}`;
  }

  pronto(ora: Ora): boolean {
    return this.cache.ha(this.chiave(ora));
  }

  get inVolo(): number {
    return this.inCorso.size;
  }

  /**
   * `conteggio` e' opzionale e di default vale la finestra costruita nel
   * costruttore (pensata per la riproduzione continua). Chi ha bisogno solo
   * del fotogramma corrente subito, per esempio un salto dello scrubber che
   * deve ridisegnare appena arriva il dato e non aspettare dieci ore di
   * lookahead, puo' chiederne uno piu' piccolo qui.
   */
  async assicura(asse: Ora[], indice: number, direzione: 1 | -1, conteggio = this.avanti): Promise<void> {
    const richieste: Promise<void>[] = [];
    for (let k = 0; k <= conteggio; k++) {
      const i = indice + k * direzione;
      if (i < 0 || i >= asse.length) break;
      richieste.push(this.uno(asse[i]));
    }
    await Promise.all(richieste);
  }

  private uno(ora: Ora): Promise<void> {
    const chiave = this.chiave(ora);
    if (this.cache.ha(chiave)) return Promise.resolve();
    const gia = this.inCorso.get(chiave);
    if (gia) return gia;

    const promessa = this.carica(ora)
      .then((dato) => {
        this.cache.metti(chiave, dato);
      })
      .catch(() => {
        // Un frame che non arriva non e' un guasto dell'applicazione: la rete
        // cade. Non si registra il fallimento in modo permanente, se no il
        // frame resterebbe buco per tutta la sessione anche quando la rete
        // torna; il giro successivo riprova.
      })
      .finally(() => {
        this.inCorso.delete(chiave);
      });

    this.inCorso.set(chiave, promessa);
    return promessa;
  }
}
