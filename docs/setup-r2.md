# Configurazione manuale del bucket

Da fare una volta sola, circa quindici minuti. Servono due account, entrambi
senza carta di credito.

## 1. Cloudflare R2

1. Creare un account su dash.cloudflare.com e attivare R2.
2. Creare un bucket, per esempio `stato-del-mare`.
3. In **Settings**, abilitare **Public access** tramite `r2.dev` oppure
   collegare un dominio. Serve perche' la SPA legge i frame direttamente dal
   browser, senza passare da un backend.
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
   vincolo, visto che ogni run scarica circa 1,9 GB. Le credenziali stanno
   nei secret e restano private in ogni caso.
2. In **Settings > Secrets and variables > Actions** aggiungere:
   `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

## 3. Primo giro

Dalla scheda Actions, lanciare **Ingestione ADRIAC** a mano con `dry_run`
attivo: stampa il piano senza scrivere niente. Se l'elenco dei file ha senso,
rilanciare senza `dry_run`.

Il primo run e' piu' lento degli altri perche' costruisce l'indice di
ricampionamento e lo carica sul bucket come `static/regrid_index.npz`. I run
successivi lo riscaricano da li'.

Quel file non e' un dettaglio di prestazioni: e' la memoria di come era fatta
la griglia ARPAE l'ultima volta. Serve a far scattare la guardia se il dominio
cambia. **Non cancellarlo dal bucket**: senza, ogni run ricostruirebbe l'indice
dal file corrente, che coincide sempre con se stesso, e una riconfigurazione
del modello passerebbe inosservata riempiendo l'archivio di valori nel posto
sbagliato.
