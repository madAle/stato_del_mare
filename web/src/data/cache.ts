/**
 * LRU misurata in byte, non in numero di frame.
 *
 * Un frame pesa 153 KB in rete ma 1,4 MB decodificato: contare i frame
 * significherebbe non sapere quanta memoria si sta occupando, e sbagliare di
 * un fattore dieci. Budget predefinito 200 MB, cioe' circa 140 frame.
 */
export class CacheFrame {
  private mappa = new Map<string, Int16Array>();
  private byte = 0;

  constructor(private budgetByte = 200 * 1024 * 1024) {}

  get byteUsati(): number {
    return this.byte;
  }

  get quanti(): number {
    return this.mappa.size;
  }

  prendi(chiave: string): Int16Array | undefined {
    const trovato = this.mappa.get(chiave);
    if (trovato === undefined) return undefined;
    // rimettere in coda: Map conserva l'ordine di inserimento, quindi il primo
    // elemento e' sempre il meno recente
    this.mappa.delete(chiave);
    this.mappa.set(chiave, trovato);
    return trovato;
  }

  metti(chiave: string, dato: Int16Array): void {
    // Un frame piu' grande del budget non entra, e soprattutto non si porta
    // dietro l'intera cache svuotandola per poi non entrarci lo stesso.
    if (dato.byteLength > this.budgetByte) return;
    if (this.mappa.has(chiave)) this.togli(chiave);
    this.mappa.set(chiave, dato);
    this.byte += dato.byteLength;
    while (this.byte > this.budgetByte) {
      const menoRecente = this.mappa.keys().next();
      if (menoRecente.done) break;
      this.togli(menoRecente.value);
    }
  }

  private togli(chiave: string): void {
    const dato = this.mappa.get(chiave);
    if (dato === undefined) return;
    this.byte -= dato.byteLength;
    this.mappa.delete(chiave);
  }
}
