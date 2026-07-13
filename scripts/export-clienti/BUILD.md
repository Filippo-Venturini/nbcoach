# Compilare/testare l'eseguibile — guida per lo sviluppatore

Sorgente unica: `export.deno.ts`. Serve **Deno** (solo su chi compila, non sul PC del PT).

Installa Deno:
- Windows (PowerShell): `irm https://deno.land/install.ps1 | iex`  (oppure `winget install DenoLand.Deno`)
- Mac: `brew install deno`

## 1. Test rapido (senza compilare)

Metti `.env` nella cartella (copia da `.env.example`, compila la service key;
`OUTPUT_DIR` lascialo vuoto per esportare in `./export`). Poi, dentro la cartella:

```
deno run --allow-net --allow-read --allow-write --allow-env export.deno.ts
```

Gira sul TUO sistema (Windows va benissimo) e scarica i file: così verifichi
che tutto funzioni prima di compilare.

## 2. Compilare l'eseguibile per il PT (Mac)

Scopri se il suo Mac è Apple Silicon (M1/M2/M3/M4) o Intel, poi:

```
# Apple Silicon
deno compile --no-check --allow-net --allow-read --allow-write --allow-env \
  --target aarch64-apple-darwin --output EsportaClienti export.deno.ts

# Mac Intel
deno compile --no-check --allow-net --allow-read --allow-write --allow-env \
  --target x86_64-apple-darwin --output EsportaClienti export.deno.ts
```

Deno cross-compila: puoi produrre il binario Mac anche dal tuo PC Windows.

> Nota: `--no-check` salta il type-check di TypeScript. Il sorgente è JS scritto
> in un file `.ts` (parametri senza tipi espliciti), quindi senza questo flag
> `deno compile` si fermerebbe con errori TS7006/TS2339. Il binario è identico.

## 3. (Facoltativo) Eseguibile Windows per provarlo tu

```
deno compile --no-check --allow-net --allow-read --allow-write --allow-env \
  --output EsportaClienti.exe export.deno.ts
```

(Sei già su Windows, quindi non serve `--target`: compila per il tuo sistema.)

## 4. Cosa consegnare al PT

Una cartella con **due file**: `EsportaClienti` + `.env` (con la secret key;
lascia `OUTPUT_DIR` vuoto così alla prima apertura l'app chiede dove salvare e
ricorda la scelta). Il PT fa **doppio clic** su `EsportaClienti`.

### Doppio clic su Mac — cosa succede
Il binario compilato non ha estensione: facendo doppio clic dal Finder, macOS lo
apre nel **Terminale** e lo esegue (compare la barra di avanzamento). Alla fine
resta in attesa di Invio per chiudere.

**Prima apertura** (binario non firmato → Gatekeeper lo blocca): una volta sola,
- tasto destro sul file → **Apri** → **Apri** (poi il doppio clic funziona sempre), oppure
- Terminale: `xattr -dr com.apple.quarantine EsportaClienti`

### (Opzionale) launcher più amichevole
Se preferisci un file con nome parlante da cliccare, metti accanto un
`Avvia backup.command` con dentro:
```sh
#!/bin/bash
cd "$(dirname "$0")"
./EsportaClienti
```
poi `chmod +x "Avvia backup.command"`. Su Mac i file `.command` si aprono nel
Terminale con doppio clic. (Vale la stessa nota Gatekeeper della prima apertura.)

### Dove salva l'export
Alla prima esecuzione l'app chiede la cartella: il PT può **trascinare** una
cartella dal Finder dentro la finestra del Terminale e premere Invio. La scelta
viene salvata nel `.env` (`OUTPUT_DIR`), quindi le volte dopo non la richiede.
