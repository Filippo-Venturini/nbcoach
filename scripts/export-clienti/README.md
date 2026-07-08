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
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → chiave **service_role** (SEGRETA)
- `OUTPUT_DIR` — cartella dove salvare il backup. **Lascialo vuoto** per creare
  automaticamente una cartella `export/` accanto all'eseguibile.

## Sicurezza

La **service role key è segreta** (accesso completo al database): tienila solo
sul PC di chi esegue il backup, non condividerla e non caricarla online.
Il file `.env` non va su git. Il binario invece NON contiene la chiave: è
sempre e solo nel `.env`, quindi puoi consegnare il binario e il `.env` insieme.
