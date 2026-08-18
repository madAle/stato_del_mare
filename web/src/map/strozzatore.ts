/**
 * Limita a un tanto al secondo le chiamate a chi ascolta, senza perdere
 * l'ultimo valore.
 *
 * Nato per il valore sotto il mouse: mousemove non e' aggregato dal browser,
 * e su schermi allineati al refresh arriva a 60 e piu' eventi al secondo.
 * Consegnarli tutti a React ridisegnerebbe l'albero a quella stessa
 * frequenza, cioe' esattamente il vincolo che questa architettura esiste per
 * rispettare (vedi Animazione.riporta, che fa lo stesso per il tempo).
 *
 * Uno strozzatore "a bordo iniziale" (consegna e poi ignora tutto per la
 * finestra) perderebbe per sempre l'ultimo valore di una raffica, cioe'
 * l'ultima posizione del mouse prima che si fermi: chi guarda vedrebbe il
 * valore di un punto che il mouse ha gia' lasciato. Qui l'ultimo valore
 * arriva sempre, alla chiusura della finestra.
 */
export type Strozzatore<T> = {
  invia(valore: T): void;
  /** Annulla una consegna in coda: da chiamare allo smontaggio. */
  distruggi(): void;
};

export function creaStrozzatore<T>(
  consegna: (valore: T) => void,
  passoMs = 100,
): Strozzatore<T> {
  let ultimaConsegna = -Infinity;
  let inSospeso: { valore: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const consegnaOra = (valore: T) => {
    ultimaConsegna = Date.now();
    inSospeso = null;
    consegna(valore);
  };

  return {
    invia(valore: T) {
      const adesso = Date.now();
      if (adesso - ultimaConsegna >= passoMs) {
        // Un valore in coda diventa superato dal momento che se ne consegna
        // uno piu' recente per la via diretta: il timer che lo consegnerebbe
        // non serve piu'.
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        consegnaOra(valore);
        return;
      }
      inSospeso = { valore };
      if (timer === null) {
        const resto = passoMs - (adesso - ultimaConsegna);
        timer = setTimeout(() => {
          timer = null;
          // Puo' essere gia' stato consumato da una consegna diretta nel
          // frattempo (per esempio se lo si annulla e riusa fra due chiamate).
          if (inSospeso) consegnaOra(inSospeso.valore);
        }, resto);
      }
    },
    distruggi() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      inSospeso = null;
    },
  };
}
