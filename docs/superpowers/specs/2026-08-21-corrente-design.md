# La corrente disegnata, design

Data: 2026-08-21 · Stato: **approvato, da implementare**.

Estende la spec principale (`2026-08-13-stato-del-mare-design.md`, sezione 7) su
un punto che quella lasciava aperto: la corrente. È il **primo campo vettoriale**
e la prima grandezza disegnabile a due campi, quindi scioglie un vincolo che
`STATO.md` registrava da tre giorni.

Le decisioni portano il motivo e cosa costano se sono sbagliate, come tutte le
altre di questo progetto: senza quelle due righe verrebbero rimesse in
discussione da zero.

## 1. Cosa si vede

Una grandezza nel selettore, `corrente (media sulla colonna)`, che disegna due
cose insieme:

- il **colore** dal modulo della velocità, con la tavolozza `speed` e la scala da
  0 a 0,4 m/s;
- il **verso** da scie animate, cioè l'animazione a particelle che già esiste per
  la direzione dell'onda, con il disegno a scia invece che a cresta.

Le due metà si consegnano insieme. La metà utile di una corrente è il verso: il
colore da solo dice quanto forte ma non da che parte, che è la domanda di chi
entra o esce da un porto. E condividono l'idraulica dei due campi, quindi
separarle raddoppierebbe il lavoro di integrazione invece di dimezzarlo.

## 2. Il dato, e cosa **non** cambia

`ubar` e `vbar` sono in archivio dal primo run: m/s, scala 0,001, offset 0,
tavolozza `speed` dichiarata dal catalogo, passo **orario** come l'onda (non ogni
dieci minuti come il livello del mare).

Vengono da `his_2dcur`, cioè la velocità **barotropica**, mediata sulla colonna
d'acqua. Non è la corrente di superficie. Vedi la sezione 8: è una scelta
esplicita, con i numeri.

**`src/data/` non cambia di una riga**, e questa è una proprietà del design, non
una coincidenza: `leggiIndice` e `urlFrame` prendono un **id di campo**, che è
il livello giusto, e `Prefetcher` e `CacheFrame` sono già per campo. Il fan out
sta in chi li chiama.

- **L'asse dei tempi si legge sul primo campo.** Misurato il 2026-08-21: `ubar` e
  `vbar` hanno le **stesse ore**, 288 in analisi e 336 in previsione, in
  entrambi i mesi disponibili. Motivo: sono scritti dallo stesso file
  (`his_2dcur`) nello stesso giro, quindi non possono divergere se non per un
  guasto a metà scrittura. Costo se è sbagliato: un frame compagno mancante è un
  **buco**, e il percorso "senza dato" esiste già e disegna niente invece di
  disegnare un numero inventato.
- **Un prefetcher per campo**, ognuno col suo spazio di chiavi, invece di un
  prefetcher che sa contare fino a due. Motivo: la chiave della cache porta già
  la variabile (decisione 76 della SPA, scritta per non servire fotogrammi
  dell'onda come se fossero secondi), quindi due prefetcher non possono
  confondersi. "L'ora è pronta" diventa "tutti i campi sono pronti". Costo se è
  sbagliato: due richieste in volo invece di una, sullo stesso numero di byte.

## 3. Il nodo dell'id, e come si scioglie

Oggi `App` trova la variabile del catalogo così: `variabili.find(v => v.id ===
grandezza.id)`. Per la corrente non esiste nessuna variabile con id `corrente`,
quindi `scelta` sarebbe `undefined` e l'app si fermerebbe sul ramo di
caricamento. È il vincolo che `STATO.md` chiamava "da sciogliere prima della
corrente".

Si scioglie con una frase: **l'id nell'URL è quello della grandezza, gli id
verso il bucket sono quelli dei campi.**

- `?var=corrente` resta l'id della grandezza, come già fa oggi;
- scala e offset vengono dal **primo campo** (0,001 e 0, identici per i due:
  verificato nel catalogo);
- la tavolozza viene dalla grandezza, non dal campo, perché è una scelta di resa;
- gli URL di indice e fotogramma prendono l'id di **ogni** campo.

Costo se è sbagliato: la scala di un campo applicata all'altro darebbe una
velocità sbagliata di un fattore, cioè numeri plausibili e falsi. Per questo il
test end to end di coerenza (sezione 7) confronta il numero a schermo col valore
calcolato a mano **dai due frame veri**, e non con sé stesso.

## 4. Il colore: quattro texture, e l'ordine conta

`LivelloCampo` oggi tiene due texture intere, l'ora e l'ora dopo, e interpola nel
tempo dentro lo shader. Per la corrente ne tiene **quattro**: due componenti per
due istanti.

Nello shader, in **questo** ordine:

1. si interpola nel tempo ogni componente, con la logica che c'è già;
2. si prende `length(vec2(u, v))`.

**Non l'ordine opposto**, ed è il punto da non sbagliare: mescolare i moduli
sbaglia proprio all'inversione di marea, dove una componente passa da +0,3 a
-0,3 e il valore vero a metà è 0 mentre la media dei moduli dà 0,3. Il principio
è già scritto in `ui/grandezze.ts` ("un vettore si media in cartesiane e non in
modulo e angolo") e questa è la sua prima applicazione a un campo disegnato.

Costo se è sbagliato: una corrente che non si annulla mai, cioè un mare che
sembra sempre in movimento anche a stanca. Non si vede come un errore: si vede
come un mare diverso.

**La dissolvenza resta accesa.** Al contrario del periodo, che prende 17 valori
discreti e per cui interpolare inventa dati che il modello non produce, una
corrente è continua nel tempo: interpolarla è lecito, e la dissolvenza serve
all'occhio mentre il tempo scorre.

## 5. Il verso: scie, non creste

L'onda si disegna come **cresta** perché l'acqua non viaggia, viaggia la cresta
(decisione 94). Per la corrente è l'esatto opposto: **l'acqua viaggia davvero**
lungo la traiettoria, quindi la scia è l'idioma onesto, ed è lo stesso motivo per
cui è quello giusto sulle mappe di vento. Il codice della scia si recupera da git
(è stato tolto in `a09da47`, il commit delle creste).

Tre cose da tenere separate, perché ognuna può essere sbagliata in silenzio:

- **la direzione è `atan2(v, u)`, senza mezzo giro.** `Dwave` dichiara la
  direzione *da cui* l'onda viene e per questo le creste vanno girate; `ubar` e
  `vbar` sono componenti della velocità, cioè dicono già dove l'acqua **va**.
  Costo se è sbagliato: una corrente disegnata al contrario, che è la cosa più
  dannosa che questa mappa può fare a chi la usa per uscire in barca;
- **la velocità è il modulo, e non va inventata dalla fisica.** Per l'onda la
  velocità viene da `c = g T / 2 pi` perché il dato dà il periodo e non la
  celerità; qui il dato **è** la velocità. Costo se è sbagliato: velocità
  relative false, cioè un gradiente che nel mare non c'è;
- **la correzione di Mercatore resta**, identica al caso dell'onda: un metro di
  mappa vale `cos(latitudine)` metri di mare, e fra Bari e Trieste il fattore
  cambia del 9 per cento.

Il motore si generalizza: oggi `velocitaInCelle` prende (seno, coseno, periodo) e
ne ricava celle al secondo; gli serve una seconda sorgente che parte da (u, v).
Resta una funzione pura in `map/particelle.ts`, con i suoi test, e resta l'unico
posto dove queste tre cose vivono.

Il fattore comune di velocità a schermo va **ritarato**, perché è accoppiato alla
taglia della marca (decisione 96, imparata con le creste): una scia di 40 px e una
cresta di 18 non si muovono bene alla stessa velocità. Il test che lega i due
numeri va esteso alla scia.

### Le due animazioni possono stare insieme, e non è un incidente

Con la corrente selezionata, le sue scie fanno parte del layer, sempre accese:
colore e verso sono le due metà della stessa grandezza. L'interruttore
"direzione dell'onda" però resta **abilitato**, quindi si può avere a schermo
scie della corrente **e** creste dell'onda insieme.

Si lascia, deliberatamente. Il motivo è la ragione per cui le creste esistono:
cresta e scia sono forme diverse **per non potersi confondere**, e la
combinazione dice una cosa che nessuna delle due dice da sola, cioè che la
corrente ti spinge a sud mentre l'onda arriva da est. È esattamente la domanda di
chi esce in barca, ed è l'unico posto dell'applicazione dove due grandezze si
confrontano nello stesso istante.

**Costo, dichiarato**: due sistemi di particelle a 60 fps invece di uno, e uno
schermo affollato. Chi non lo vuole spegne l'onda, che è un click. Da rimettere
in discussione se le due animazioni insieme fanno scendere i fotogrammi su un
telefono: si misura, non si indovina.

## 6. Il valore sotto il dito

Legge **due** campi e combina, con lo stesso ordine della sezione 4: interpolare
le componenti, poi il modulo. `valoreCorrente` non si tocca; accanto ci va la
versione vettoriale, così entrambe restano pure e provabili senza browser.

Il numero non porta gradi Douglas (`haStatoDelMare` è già solo per l'altezza
d'onda) e si scrive col passo **0,01 m/s**, cioè due decimali: un centimetro al
secondo è precisione che il dato ha, e la mediana misurata è 0,057 m/s, quindi un
passo più grosso schiaccerebbe la metà del mare su due soli valori.

## 7. I test

- **Puri, in `map/particelle.ts`**: il verso da (u, v) senza mezzo giro (una
  corrente verso est dà `i` che cresce), la velocità che **è** il modulo, la
  correzione di latitudine, e `null` dove il dato non c'è.
- **Puro, sull'ordine dell'interpolazione**: il caso dell'inversione, che il modo
  sbagliato non passa. Con u che va da +0,3 a -0,3 e v nullo, a metà ora il
  valore è 0 e non 0,3. Questo test è il motivo per cui la sezione 4 esiste.
- **End to end, il più forte**: si copia `coerenza.spec.ts`, che è il test che
  vale più di tutti nella suite. Scarica i **due** frame veri dal bucket, calcola
  `hypot(u, v) * scala` sulla cella di Nausicaa 2 a mano, e lo confronta col
  numero sotto il dito, con tolleranza mezzo passo di scrittura. Se questa catena
  regge (bucket, due indici, due decodifiche, proiezione, interpolazione,
  modulo), regge tutto.
- **End to end, di resa**: `?var=corrente` disegna davvero (il livello dichiara i
  suoi vertici e la sua diagnosi, come le creste), la legenda dice `0,4 m/s`, il
  numero non porta lo stato del mare, le isolinee restano spente e il loro
  interruttore disabilitato, le scie si muovono.

## 8. Cosa resta fuori, dichiarato

**La corrente di superficie.** Chiesto il 2026-08-21 "non abbiamo i dati
puntuali?". Li abbiamo, come sorgente, e in parte li scarichiamo già. I numeri,
misurati quel giorno:

| file | analisi | previsione |
| --- | --- | --- |
| `his_2dcur` (mediata sulla colonna) | 24,8 MB/giorno | 68,6 MB |
| `his_cur` (3D, 30 livelli sigma) | 672 MB/giorno | 2,0 GB |

Il 3D di **analisi** lo scarichiamo già ogni giorno, per i profili verticali
sulle stazioni: estrarne il livello di superficie come raster costerebbe **zero
scaricamento in più**, più il tempo di ingestione e circa 70 MB al giorno di
archivio. Il 3D di **previsione** no, e sono 2 GB al giorno.

**Perché non adesso**: se si ingerisse la superficie solo per l'analisi, la mappa
avrebbe un layer che si ferma a ieri mentre tutto il resto prevede 72 ore, che è
peggio di non averlo. E il lavoro lato SPA (due campi per ora) è identico nei due
casi, quindi non è lavoro buttato.

**Perché la mediata non è comunque un errore**: in un portocanale come quello di
Comacchio, dove il flusso è ben mescolato e lo guida il gradiente di livello, la
barotropica è **esattamente** la grandezza giusta. È un cattivo surrogato per una
barca in superficie d'estate, quando l'acqua è stratificata e il primo metro lo
muove il vento. Per questo il nome a schermo lo dice.

**Da rimettere in discussione quando**: qualcuno usa la mappa per navigare
davvero, o quando l'archivio di previsione 3D diventa accessibile a un costo
diverso.

**Una lacuna trovata e non chiusa**: la scelta di prendere `ubar/vbar` da
`his_2dcur` invece del 3D **non ha un motivo scritto** in nessuna delle 34
decisioni dell'ingestore. Guardando le dimensioni era quasi certamente lo spazio,
ma è una ricostruzione, non una fonte. Questa sezione è il motivo scritto, in
ritardo di otto giorni.

**Comacchio** (punto 9 di `STATO.md`) resta un'altra cosa: vuole due incognite
da stimare con mezza giornata in barca, e non si sblocca disegnando un campo.

## 9. I numeri misurati, per non rimisurarli

Otto ore sparse su tutto l'archivio di analisi (2026-08-09 a 2026-08-19),
1.349.696 valori di mare, modulo di `hypot(ubar, vbar)`:

| percentile | m/s |
| --- | --- |
| 50 | 0,057 |
| 75 | 0,093 |
| 90 | 0,134 |
| 95 | 0,163 |
| 99 | 0,241 |
| 99,9 | 0,338 |
| massimo | 0,607 |

Il 43,7 per cento del mare sta sotto 0,05 m/s e il 78,3 sotto 0,10.

**La cima della legenda è 0,4 m/s.** Copre il 99,9 per cento del misurato con
margine e satura sopra. La tabella diceva 1 m/s, che era un segnaposto mai
misurato: con quella scala il 78 per cento dell'Adriatico cadrebbe nel primo
decimo della rampa, cioè la mappa sarebbe di un colore solo. Scartato anche 0,3,
che userebbe meglio la rampa d'agosto ma saturerebbe proprio dove la corrente
conta.

**Costo se è sbagliato**: sopra 0,4 satura, e un evento di bora d'inverno lo
supererà. È lo stesso limite dichiarato per la scala del periodo e per quella
della marea, e come quelli **va rivisto con un inverno di dati**: agosto è il mese
più calmo dell'anno e questi numeri lo dicono.
