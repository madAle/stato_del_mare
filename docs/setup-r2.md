# Configurazione manuale del bucket

Da fare una volta sola, circa quindici minuti. Servono due account. Nessuno
dei due richiede un pagamento per quello che facciamo qui, ma Cloudflare in
alcuni casi chiede comunque un metodo di pagamento registrato per abilitare
R2, anche sul piano gratuito.

## 1. Cloudflare R2

1. Creare un account su dash.cloudflare.com e attivare R2.
2. Creare un bucket, per esempio `stato-del-mare`.
3. In **Settings**, abilitare **Public access** collegando un dominio. (Cloudflare
   documenta `r2.dev` come endpoint di testing, non per traffico di produzione.)
   Serve perche' la SPA legge i frame direttamente dal browser, senza passare
   da un backend.
4. Sempre in Settings, impostare la policy CORS:

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

   Senza CORS il browser rifiuta le `fetch` verso il bucket.
5. In **R2 > Manage API Tokens** creare un token con permessi di lettura e
   scrittura sul bucket. Annotare Access Key ID, Secret Access Key e
   l'endpoint, che ha la forma
   `https://<account_id>.r2.cloudflarestorage.com`.

Il piano gratuito e' 10 GB di storage, 1 milione di scritture e 10 milioni di
letture al mese, con egress illimitato e senza scadenza. Questo progetto
scrive circa 800 oggetti al giorno, quindi resta due ordini di grandezza sotto
i limiti sulle operazioni. Lo storage si esaurisce verso il terzo mese e
mezzo, poi il costo e' di circa 40 centesimi al mese a fine primo anno.

## 2. GitHub

1. Rendere il repository **pubblico**. Su repo pubblici i minuti di Actions
   sono illimitati; su repo privati i 2.000 mensili gratuiti diventano un
   vincolo, visto che il primo run di ogni giornata scarica circa 1,9 GB. (Il
   secondo run costa quasi nulla: confronta dimensione e data di modifica alla
   sorgente e scarica solo cio' che e' cambiato.) Le credenziali stanno nei
   secret e restano private in ogni caso.
2. In **Settings > Secrets and variables > Actions** aggiungere:
   `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

## 3. Primo giro

Dalla scheda Actions, lanciare **Ingestione ADRIAC** a mano con `dry_run`
attivo: stampa il piano senza scrivere niente. Se l'elenco dei file ha senso,
rilanciare senza `dry_run`. (Le esecuzioni pianificate (`schedule`) partono solo
quando il file del workflow sia gia' presente nel branch di default del
repository. Fino allora, solo i trigger manuali funzionano.)

Il primo run e' piu' lento degli altri perche' costruisce l'indice di
ricampionamento e lo carica sul bucket come `static/regrid_index.npz`. I run
successivi lo riscaricano da li'.

Quel file non e' un dettaglio di prestazioni: e' la memoria di come era fatta
la griglia ARPAE l'ultima volta. Serve a far scattare la guardia se il dominio
cambia. **Non cancellarlo dal bucket**: senza, ogni run ricostruirebbe l'indice
dal file corrente, che coincide sempre con se stesso, e una riconfigurazione
del modello passerebbe inosservata riempiendo l'archivio di valori nel posto
sbagliato.

Se un run fallisce, il messaggio in testa al log (dopo il titolo) spiega se il
problema e' self-healing ("Ritentabile") o se richiede intervento umano ("Serve
intervento umano").
