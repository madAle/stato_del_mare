import maplibregl, { type Map as MappaLibre, type Marker } from "maplibre-gl";

/**
 * Il punto osservato, piantato sulla mappa.
 *
 * Esiste per un difetto che si vede solo a dito: su un touch non c'e' il
 * passaggio del puntatore, quindi si tocca, il numero compare, si toglie il
 * dito e quel numero si riferisce a un punto che non si e' piu' in grado di
 * indicare. Peggio, `mouseout` non scatta mai sul tocco: il valore resta a
 * schermo, orfano, e continua pure ad aggiornarsi nel tempo.
 *
 * La cosa che rende corretto questo oggetto e' una sola: **il segno e'
 * ancorato a una coordinata geografica, non a un punto dello schermo**. Un
 * marcatore di MapLibre lo tiene attaccato a quel `lngLat` mentre la mappa si
 * trascina e si ingrandisce. Se fosse ancorato ai pixel, trascinando la mappa
 * il numero cambierebbe in silenzio il posto a cui si riferisce, ed e' la
 * stessa famiglia di difetti (qualcosa che afferma piu' di quello che sa) che
 * questo progetto ha gia' pagato quattro volte.
 *
 * Vive in `src/map/` e non conosce React, come tutto questo strato: chi lo usa
 * riceve gli eventi attraverso `alTolto` e legge `posizione`.
 */
export class Segnaposto {
  private marcatore: Marker | null = null;
  private etichetta: HTMLElement | null = null;

  /** Chiamato quando chi guarda toglie il punto toccandolo. */
  alTolto: (() => void) | null = null;

  constructor(private readonly mappa: MappaLibre) {}

  /** Dove sta il punto, o null se non ce n'e' uno. */
  get posizione(): { lng: number; lat: number } | null {
    if (!this.marcatore) return null;
    const p = this.marcatore.getLngLat();
    return { lng: p.lng, lat: p.lat };
  }

  /** Pianta il punto, o lo sposta se c'e' gia'. */
  metti(lng: number, lat: number): void {
    if (!this.marcatore) {
      const elemento = document.createElement("div");
      elemento.className = "segnaposto";
      elemento.title = "Togli il punto";
      elemento.setAttribute("data-testid", "segnaposto");
      elemento.setAttribute("role", "button");
      elemento.setAttribute("aria-label", "Punto osservato: toccare per toglierlo");

      const croce = document.createElement("div");
      croce.className = "segnaposto-croce";
      elemento.appendChild(croce);

      // L'anello e' un elemento vero e non uno pseudo-elemento perche' deve
      // poter essere misurato: `getBoundingClientRect` da' la scatola davvero
      // usata, mentre su uno pseudo-elemento si puo' solo ricostruirla dagli
      // stili dichiarati, cioe' assumendo il modello di scatola invece di
      // leggerlo. E' assumendolo che il segno e' finito 2 px fuori centro.
      const anello = document.createElement("div");
      anello.className = "segnaposto-anello";
      anello.setAttribute("data-testid", "anello-segnaposto");
      elemento.appendChild(anello);

      this.etichetta = document.createElement("div");
      this.etichetta.className = "segnaposto-valore";
      this.etichetta.setAttribute("data-testid", "valore-segnaposto");
      elemento.appendChild(this.etichetta);

      // stopPropagation, se no il click sul segno arriva anche alla mappa, che
      // lo interpreta come "pianta qui" e rimette subito il punto appena tolto.
      elemento.addEventListener("click", (e) => {
        e.stopPropagation();
        this.togli();
        this.alTolto?.();
      });

      // "center": la croce va centrata sulla coordinata, se no il punto
      // osservato non e' quello che si vede indicato.
      this.marcatore = new maplibregl.Marker({ element: elemento, anchor: "center" });
      this.marcatore.setLngLat([lng, lat]).addTo(this.mappa);
      return;
    }
    this.marcatore.setLngLat([lng, lat]);
  }

  /** Il valore scritto accanto al segno. Stringa vuota per non scrivere niente. */
  scrivi(testo: string): void {
    if (!this.etichetta) return;
    this.etichetta.textContent = testo;
    this.etichetta.classList.toggle("vuota", testo === "");
  }

  togli(): void {
    this.marcatore?.remove();
    this.marcatore = null;
    this.etichetta = null;
  }
}
