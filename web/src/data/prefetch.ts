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
    private carica: (ora: Ora) => Promise<Int16Array>,
    private avanti = 10,
  ) {}

  chiave(ora: Ora): string {
    return `${ora.tipo}/${ora.riferimento}/${ora.istante}`;
  }

  pronto(ora: Ora): boolean {
    return this.cache.ha(this.chiave(ora));
  }

  get inVolo(): number {
    return this.inCorso.size;
  }

  async assicura(asse: Ora[], indice: number, direzione: 1 | -1): Promise<void> {
    const richieste: Promise<void>[] = [];
    for (let k = 0; k <= this.avanti; k++) {
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
