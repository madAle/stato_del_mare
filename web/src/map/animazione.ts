import type { CacheFrame } from "../data/cache";
import type { Ora } from "../data/indice";
import { PASSO_MS } from "../data/indice";
import type { Prefetcher } from "../data/prefetch";
import { inquadra, oraPiuVicina } from "../data/sorgente";
import type { LivelloCampo } from "./campo";

/**
 * Ore di simulazione per secondo reale, alla prima pressione di "riproduci".
 *
 * Esportata perche' i bottoni della velocita' devono evidenziare quella che il
 * ciclo sta gia' usando: finche' il numero stava scritto due volte, in due file
 * diversi, cambiarne uno solo faceva dire ai bottoni una cosa e al ciclo
 * un'altra, senza che niente se ne accorgesse.
 *
 * Due ore al secondo e non quattro: a quattro, le 120 ore della finestra
 * iniziale scorrono in mezzo minuto, ed e' troppo veloce per seguire una
 * mareggiata che entra.
 */
export const VELOCITA_PREDEFINITA = 2;

export type StatoRiproduzione = "ferma" | "in riproduzione" | "in attesa di dati";

/**
 * Una cella leggibile che tiene sempre il valore corrente.
 *
 * E' la stessa forma di un RefObject di React ({ current: T }), scelta apposta:
 * cosi' MapView.tsx puo' passare qui dentro i propri useRef senza che questo
 * modulo importi mai "react" (vietato in src/map, vedi vincoli.test.ts). Un
 * test puo' passare un oggetto letterale identico, senza React.
 */
export type Leggibile<T> = { readonly current: T };

export type OpzioniAnimazione = {
  /**
   * Letti da un ref aggiornato a ogni render di App, non un valore fisso preso
   * al montaggio: App ricrea l'asse e il prefetcher quando i dati cambiano
   * (per esempio un refetch di React Query dopo che la scheda torna in
   * primo piano), ma Animazione vive per tutta la vita della mappa, creata
   * una volta sola. Senza questa indirezione, l'animazione avrebbe continuato
   * a lavorare per sempre sull'asse e il prefetcher del primo montaggio,
   * mentre lo scrubber (che rilegge le prop a ogni render di React) sarebbe
   * passato in silenzio a quelli nuovi: due assi diversi, mai riconciliati.
   */
  asse: Leggibile<Ora[]>;
  prefetcher: Leggibile<Prefetcher>;
  cache: CacheFrame;
  /**
   * Se fra un'ora e l'altra si puo' interpolare. Assente vale "si'".
   *
   * Falso per le grandezze che il modello non produce continue: il periodo di
   * picco prende 17 valori in tutto (la griglia delle frequenze di SWAN), e
   * fonderne due darebbe un periodo che il modello non puo' generare.
   */
  dissolvenza?: Leggibile<boolean>;
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
  private oreAlSecondo = VELOCITA_PREDEFINITA;
  private stato: StatoRiproduzione = "ferma";
  private ultimoRapporto = 0;
  private ultimoFotogramma = 0;
  private richiesta: number | null = null;
  private rapportoInSospeso: number | null = null;
  // Distingue una programmazione del rapporto in coda dalla successiva: senza
  // un token, un vecchio giro rimasto in coda (cancelAnimationFrame non lo
  // toglie sempre, per esempio nei test) consegnerebbe un rapporto doppio.
  private tokenRapporto = 0;
  // L'indice per cui l'ultima assicuraFinestra() e' stata avviata: senza,
  // ogni chiamata di vaiA con la stessa ora (per esempio un rapporto
  // ridondante, o piu' eventi di trascinamento fermi sullo stesso punto)
  // ricalcolerebbe e richiederebbe di nuovo la finestra da capo.
  private ultimoIndiceAssicurato: number | null = null;
  // Stesso ruolo di tokenRapporto ma per la finestra: se arriva un vaiA piu'
  // recente prima che la richiesta precedente sia arrivata, il ridisegno di
  // quella vecchia va scartato, altrimenti un salto rapido dello scrubber
  // potrebbe disegnare per ultimo un fotogramma superato.
  private tokenFinestra = 0;

  constructor(private livello: LivelloCampo, private opzioni: OpzioniAnimazione) {}

  vaiA(istante: number): void {
    this.istante = istante;
    // Disegna subito con quello che c'e' gia' in cache (puo' non esserci
    // niente): senza aspettare la finestra sotto, un salto su un'ora gia'
    // vicina ad altre visitate resta reattivo.
    this.disegna();
    // Non forzato: vaiA viene chiamato a ripetizione mentre si trascina lo
    // scrubber, e forzare qui scavalcherebbe il limite dei dieci rapporti al
    // secondo esattamente nel punto (il trascinamento) dove servirebbe di
    // piu', riportando React alla frequenza del puntatore invece che a 10 Hz.
    this.riporta(false);
    this.assicuraFinestra();
  }

  /**
   * Chiede da sola il fotogramma dell'istante corrente (e il successivo, se
   * serve per l'interpolazione), e ridisegna appena arriva.
   *
   * Prima di questa funzione, l'unico punto che chiedeva dati alla rete era
   * chiediAvanti(), chiamato solo dentro il ciclo di riproci(): aprire
   * l'applicazione, o trascinare lo scrubber, senza mai premere "riproduci",
   * non caricava mai niente. disegna() si fermava in silenzio (il fotogramma
   * non e' in cache) e la mappa restava senza campo per sempre: chi apriva
   * un link pensava che non ci fosse dato, non che nessuno l'avesse chiesto.
   *
   * assicura() e' asincrona, vaiA no: il ridisegno per forza arriva dopo,
   * quando la promessa si risolve.
   */
  private assicuraFinestra(): void {
    const asse = this.opzioni.asse.current;
    const prefetcher = this.opzioni.prefetcher.current;
    const q = inquadra(asse, this.istante);
    if (!q) return;
    const i = asse.indexOf(q.prima);

    // Non richiedere una finestra nuova per la stessa ora: il prefetcher
    // deduplica gia' i singoli fotogrammi, ma senza questo controllo ogni
    // chiamata ridondante di vaiA (un rapporto strozzato, piu' eventi di
    // trascinamento fermi sullo stesso punto) ripeterebbe comunque il giro.
    if (i === this.ultimoIndiceAssicurato) return;
    this.ultimoIndiceAssicurato = i;

    const mioToken = ++this.tokenFinestra;
    // Solo il fotogramma che serve per disegnare SUBITO l'istante corrente
    // (quello prima, e quello dopo se c'e' per interpolare) decide quando
    // ridisegnare: aspettare l'intera finestra di dieci ore pensata per la
    // riproduzione continua farebbe sembrare un salto dello scrubber molto
    // piu' lento di quanto serva davvero.
    const contoImmediato = q.dopo ? 1 : 0;
    void prefetcher.assicura(asse, i, 1, contoImmediato).then(() => {
      // Un salto piu' recente ha gia' superato questo: applicarlo ora
      // disegnerebbe un fotogramma vecchio sopra uno piu' nuovo.
      if (mioToken !== this.tokenFinestra) return;
      this.disegna();
      this.riporta(false);
    });

    // In parallelo, senza bloccare il ridisegno sopra: la finestra piu'
    // ampia in entrambe le direzioni, cosi' uno scrubbing successivo vicino
    // a questo punto trova gia' pronto anche quello, non solo il fotogramma
    // appena richiesto.
    void prefetcher.assicura(asse, i, 1);
    if (i > 0) void prefetcher.assicura(asse, i, -1);
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
    // Fermi si sta sempre su un'ora. Il dato e' orario: fra due ore la mappa
    // mostra una dissolvenza, che serve all'occhio mentre il tempo scorre ma
    // non e' un istante che il modello abbia mai calcolato. Restarci fermi
    // vorrebbe dire lasciare a schermo, a tempo indefinito, un fotogramma
    // costruito dal disegno e non dal mare, con un'ora accanto che promette
    // una precisione che non esiste.
    this.istante = this.oraPiuVicina(this.istante);
    this.disegna();
    this.riporta(true);
  }

  /** L'ora dell'asse piu' vicina a un istante, o l'istante stesso se l'asse e' vuoto. */
  private oraPiuVicina(istante: number): number {
    const asse = this.opzioni.asse.current;
    if (asse.length === 0) return istante;
    let migliore = asse[0].istante;
    let distanza = Math.abs(istante - migliore);
    for (const ora of asse) {
      const d = Math.abs(istante - ora.istante);
      if (d < distanza) {
        distanza = d;
        migliore = ora.istante;
      }
    }
    return migliore;
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
    // Invalida una assicuraFinestra() eventualmente in volo: senza, il suo
    // .then() potrebbe ridisegnare (o riportare il tempo a chi ascolta)
    // dopo che questa istanza e' gia' stata smontata.
    this.tokenFinestra++;
  }

  private avanza(adesso: number): void {
    const asse = this.opzioni.asse.current;
    const trascorso = adesso - this.ultimoFotogramma;
    this.ultimoFotogramma = adesso;

    const grezzo = this.istante + (trascorso / 1000) * this.oreAlSecondo * PASSO_MS;
    // Il riavvolgimento va calcolato PRIMA di interrogare inquadra/pronto: se
    // si interroga su "grezzo" quando questo e' oltre l'ultimo istante,
    // inquadra torna null (fuori intervallo) e il controllo di prontezza va
    // in cortocircuito senza aver mai guardato il fotogramma vero, cioe'
    // quello iniziale su cui si sta per riavvolgere.
    const ultimo = asse.at(-1);
    const prossimo = ultimo && grezzo > ultimo.istante ? asse[0].istante : grezzo;
    const q = inquadra(asse, prossimo);

    // Se il frame che servirebbe non c'e' ancora, il tempo NON avanza. Saltare
    // fotogrammi su un'animazione meteorologica falsa la percezione del
    // fenomeno, mentre una pausa breve si legge per quello che e'.
    if (q && !this.opzioni.prefetcher.current.pronto(q.prima)) {
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
    if (i >= 0) void this.opzioni.prefetcher.current.assicura(this.opzioni.asse.current, i, 1);
  }

  private indiceCorrente(): number {
    const asse = this.opzioni.asse.current;
    const q = inquadra(asse, this.istante);
    if (!q) return -1;
    return asse.indexOf(q.prima);
  }

  private disegna(): void {
    const prefetcher = this.opzioni.prefetcher.current;
    const grezza = inquadra(this.opzioni.asse.current, this.istante);
    if (!grezza) return;
    // Le grandezze che il modello non produce continue non si fondono: si
    // mostra l'ora piu' vicina, se no lo shader inventa valori che il modello
    // non ha calcolato (vedi `oraPiuVicina`).
    const q = this.opzioni.dissolvenza?.current === false ? oraPiuVicina(grezza) : grezza;
    const chiaveA = prefetcher.chiave(q.prima);
    const a = this.opzioni.cache.prendi(chiaveA);
    if (!a) return;
    const chiaveB = q.dopo ? prefetcher.chiave(q.dopo) : null;
    const b = chiaveB ? this.opzioni.cache.prendi(chiaveB) ?? null : null;
    // La chiave di B viaggia solo insieme al dato vero: se b e' null (il
    // fotogramma dopo non c'e' ancora in cache) il livello deve vedere
    // "nessun B" e non la chiave di un fotogramma che non ha ricevuto.
    this.livello.imposta(a, chiaveA, b, b ? chiaveB : null, b ? q.frazione : 0);
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
