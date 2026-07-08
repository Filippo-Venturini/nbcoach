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
deno compile --allow-net --allow-read --allow-write --allow-env \
  --target aarch64-apple-darwin --output EsportaClienti export.deno.ts

# Mac Intel
deno compile --allow-net --allow-read --allow-write --allow-env \
  --target x86_64-apple-darwin --output EsportaClienti export.deno.ts
```

Deno cross-compila: puoi produrre il binario Mac anche dal tuo PC Windows.

## 3. (Facoltativo) Eseguibile Windows per provarlo tu

```
deno compile --allow-net --allow-read --allow-write --allow-env \
  --target x86_64-pc-windows-msvc --output EsportaClienti.exe export.deno.ts
```

## 4. Cosa consegnare al PT

Una cartella con **due file**: `EsportaClienti` + `.env` (con la service key e,
se vuoi, `OUTPUT_DIR` vuoto così esporta accanto all'app). Il PT fa doppio clic.

Prima apertura su Mac (binario non firmato → Gatekeeper):
- tasto destro sul file → **Apri** → **Apri**, oppure
- Terminale: `xattr -dr com.apple.quarantine EsportaClienti`
