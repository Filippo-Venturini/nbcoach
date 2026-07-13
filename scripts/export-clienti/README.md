# Export foto e diete dei clienti — eseguibile standalone

Un singolo file da doppio clic che scarica sul disco tutte le foto e le diete
dei clienti dai bucket Supabase, organizzate in cartelle per **nome cliente**.
È **incrementale** (scarica solo i file nuovi) e **non cancella** nulla da Supabase.

Il PT non installa niente: riceve il binario già compilato + il file `.env`.
La compilazione la fa una volta chi sviluppa (vedi **BUILD.md**).

## Struttura dell'export

```
FitCoach-Backup/
  Mario Rossi/
    foto/2026-05-01_1714560000000.jpg
    diete/2026-05-01_Definizione maggio.pdf
  Giulia Bianchi/
    foto/...
    diete/...
```

## Configurazione (file .env)

Copia `.env.example` in `.env`, nella stessa cartella dell'eseguibile, e compila:
- `SUPABASE_URL` — già impostato
- `SUPABASE_SECRET_KEY` — Supabase → Project Settings → API Keys → **Secret key**
  (formato `sb_secret_...`, SEGRETA). In alternativa la vecchia `SUPABASE_SERVICE_ROLE_KEY`.
- `OUTPUT_DIR` — cartella dove salvare il backup. Puoi **lasciarlo vuoto**: alla
  prima esecuzione l'app chiede dove salvare (puoi **trascinare la cartella**
  nella finestra) e ricorda la scelta scrivendola nel `.env`. Per cambiare cartella
  basta modificare o cancellare questa riga.

## Avanzamento e file mancanti

Durante il download viene mostrata una **barra di avanzamento con percentuale**
separata per foto e diete. Se qualche file risulta a database ma non nello
storage (record orfani), l'export continua e salva l'elenco in
`file-mancanti.txt` dentro la cartella di destinazione.

## Sicurezza

La **secret key è segreta** (accesso completo al database): tienila solo
sul PC di chi esegue il backup, non condividerla e non caricarla online.
Il file `.env` non va su git. Il binario invece NON contiene la chiave: è
sempre e solo nel `.env`, quindi puoi consegnare il binario e il `.env` insieme.
