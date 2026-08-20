/**
 * I fotogrammi che il worker delle isolinee tiene da parte.
 *
 * Sta qui, fuori dal worker, per la stessa ragione del calcolo: dentro non c'e'
 * modo di provarlo senza aprire un browser, ed e' proprio qui che stava il
 * difetto per cui **le isolinee smettevano di aggiornarsi scorrendo il tempo**
 * (misurato: alla seconda passata di trascinamento, 22 richieste su 26
 * tornavano "manca").
 *
 * Il difetto era di **contabilita' fra due processi**: il thread principale
 * teneva un elenco di cosa il worker conosce e non lo sfoltiva mai, mentre il
 * worker buttava via i fotogrammi piu' vecchi per non tenersi in casa decine di
 * megabyte. Dopo un po' di scorrimento quell'elenco diceva "li ho gia' mandati
 * tutti" mentre il worker non ne aveva quasi nessuno: ogni richiesta tornava
 * "manca" e ogni giro era buttato.
 *
 * Due regole lo tengono onesto, e la seconda vale quanto la prima:
 *
 * 1. chi butta via un fotogramma **lo dice**, invece di lasciare che l'altro se
 *    ne accorga fallendo;
 * 2. usare un fotogramma lo rende recente. Senza, l'ora che si sta guardando
 *    veniva sfrattata dalle ore che le scorrevano accanto, che e' esattamente
 *    il contrario di quello che serve.
 */
export class Ricordo {
  private mappa = new Map<string, Int16Array>();

  constructor(private readonly tenuti: number) {}

  /** Mette via un fotogramma. Restituisce le chiavi buttate per fargli posto. */
  metti(chiave: string, dati: Int16Array): string[] {
    this.mappa.delete(chiave);
    this.mappa.set(chiave, dati);
    const buttate: string[] = [];
    while (this.mappa.size > this.tenuti) {
      const piuVecchia = this.mappa.keys().next().value;
      if (piuVecchia === undefined) break;
      this.mappa.delete(piuVecchia);
      buttate.push(piuVecchia);
    }
    return buttate;
  }

  /** Prende un fotogramma e lo rende il piu' recente. */
  prendi(chiave: string): Int16Array | null {
    const dati = this.mappa.get(chiave);
    if (!dati) return null;
    this.mappa.delete(chiave);
    this.mappa.set(chiave, dati);
    return dati;
  }

  svuota(): void {
    this.mappa.clear();
  }

  get quanti(): number {
    return this.mappa.size;
  }
}
