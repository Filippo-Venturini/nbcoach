// ============================================================
// FitCoach — Export foto e diete (versione Deno, per compilare in
// un ESEGUIBILE STANDALONE senza Node). Vedi BUILD.md.
// Legge il file .env posto ACCANTO all'eseguibile.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2"
import { promises as fs, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Buffer } from "node:buffer"

// Cerca il .env accanto all'eseguibile (binario compilato) oppure nella
// cartella corrente (utile quando si testa con `deno run`).
function findBase() {
  for (const dir of [path.dirname(Deno.execPath()), Deno.cwd()]) {
    if (existsSync(path.join(dir, ".env"))) return dir
  }
  return Deno.cwd()
}
const BASE = findBase()

function loadEnv() {
  const envPath = path.join(BASE, ".env")
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) Deno.env.set(m[1], m[2].replace(/^["']|["']$/g, ""))
  }
}
loadEnv()

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
// Nuova "secret key" (sb_secret_...) oppure, per retro-compatibilità, la vecchia service_role
const SERVICE_KEY = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERRORE: imposta SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env accanto all'app")
  prompt("Premi Invio per chiudere...")
  Deno.exit(1)
}

// ---- Cartella di destinazione -----------------------------------------------
// 1) se OUTPUT_DIR è nel .env la uso; 2) altrimenti la chiedo (si può TRASCINARE
//    la cartella nella finestra) e la salvo nel .env per le volte successive.
function unescapePath(raw) {
  let s = (raw || "").trim().replace(/^["']|["']$/g, "")
  // Su Mac/Linux trascinando una cartella nel Terminale gli spazi arrivano come "\ "
  if (Deno.build.os !== "windows") s = s.replace(/\\(.)/g, "$1")
  return s.trim()
}
function saveOutputDir(dir) {
  try {
    const envPath = path.join(BASE, ".env")
    let txt = existsSync(envPath) ? readFileSync(envPath, "utf8") : ""
    const line = `OUTPUT_DIR=${dir}`
    if (/^\s*OUTPUT_DIR\s*=.*$/m.test(txt)) txt = txt.replace(/^\s*OUTPUT_DIR\s*=.*$/m, line)
    else txt = txt.replace(/\s*$/, "") + "\n" + line + "\n"
    writeFileSync(envPath, txt)
  } catch { /* se non riesco a scrivere, pazienza: uso comunque la cartella scelta */ }
}
function resolveOutputDir() {
  const fromEnv = (Deno.env.get("OUTPUT_DIR") || "").trim()
  if (fromEnv) return fromEnv
  console.log("Dove vuoi salvare il backup?")
  const ans = prompt('Trascina qui la cartella (o incolla il percorso) e premi Invio.\nInvio a vuoto = crea "export" accanto all\'app:')
  const chosen = unescapePath(ans)
  if (!chosen) return path.join(BASE, "export")
  saveOutputDir(chosen)
  console.log(`Ho salvato questa cartella nel file .env. La prossima volta userò questa senza chiedere.`)
  console.log(`(Per cambiarla, modifica o cancella la riga OUTPUT_DIR nel file .env.)\n`)
  return chosen
}
const OUT = resolveOutputDir()

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function sanitize(name) {
  return (name || "senza-nome")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "senza-nome"
}
function dateKey(ts) {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "senza-data"
}

async function fetchAll(table, columns) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

const missing = [] // file a DB ma non trovati nello storage (record orfani)

async function download(bucket, storagePath, destFile) {
  if (!storagePath) return "skip"
  if (existsSync(destFile)) return "skip"
  const { data, error } = await supabase.storage.from(bucket).download(storagePath)
  if (error || !data) {
    missing.push(`${bucket}/${storagePath}\t${error?.message ?? "vuoto"}`)
    return "error"
  }
  const buf = Buffer.from(await data.arrayBuffer())
  await fs.mkdir(path.dirname(destFile), { recursive: true })
  await fs.writeFile(destFile, buf)
  return "ok"
}

// Barra di avanzamento (per CLIENTI) aggiornata sulla stessa riga.
const enc = new TextEncoder()
function shortName(s, n = 28) {
  s = s || ""
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}
function showClientProgress(done, total, upToDate, current) {
  const pct = total ? Math.round((done / total) * 100) : 100
  const bars = Math.round(pct / 5) // 20 blocchi
  const bar = "#".repeat(bars) + "-".repeat(20 - bars)
  const line = `  Clienti [${bar}] ${pct}%  aggiornati ${done}/${total}  (già a posto: ${upToDate})  → ${shortName(current)}`
  Deno.stdout.writeSync(enc.encode("\r" + line.padEnd(100)))
}

async function main() {
  console.log("\nFitCoach — export foto e diete")
  console.log("Cartella di destinazione:", OUT)
  console.log("Connessione a Supabase...\n")

  const profiles = await fetchAll("profiles", "id, full_name, email")
  const nameById = new Map()
  for (const c of profiles) nameById.set(c.id, sanitize(c.full_name || c.email || c.id))

  const photos = await fetchAll("progress_photos", "client_id, photo_url, created_at")
  const diets = await fetchAll("diet_plans", "client_id, name, pdf_url, created_at")

  // Raggruppo i file attesi per cliente (foto + diete).
  const byClient = new Map()
  const ensure = (cid) => {
    if (!byClient.has(cid)) byClient.set(cid, { name: nameById.get(cid) || sanitize(cid), items: [] })
    return byClient.get(cid)
  }
  for (const p of photos) {
    if (!p.photo_url) continue
    const c = ensure(p.client_id)
    c.items.push({
      bucket: "progress-photos",
      storagePath: p.photo_url,
      dest: path.join(OUT, c.name, "foto", `${dateKey(p.created_at)}_${path.basename(p.photo_url)}`),
    })
  }
  for (const d of diets) {
    if (!d.pdf_url) continue
    const c = ensure(d.client_id)
    c.items.push({
      bucket: "diet-pdfs",
      storagePath: d.pdf_url,
      dest: path.join(OUT, c.name, "diete", `${dateKey(d.created_at)}_${sanitize(d.name)}.pdf`),
    })
  }

  // Classifico ogni cliente: "pending" = file non ancora presenti sul disco.
  const clients = [...byClient.values()]
  for (const c of clients) c.pending = c.items.filter((it) => !existsSync(it.dest))
  const toUpdate = clients.filter((c) => c.pending.length > 0)
  const upToDate = clients.length - toUpdate.length

  console.log(`Clienti con foto/diete: ${clients.length}`)
  console.log(`  già aggiornati (nessun file nuovo): ${upToDate}`)
  console.log(`  da aggiornare: ${toUpdate.length}\n`)

  if (toUpdate.length === 0) {
    console.log("Tutti i clienti sono già aggiornati. Niente da scaricare.")
  } else {
    let done = 0, filesOk = 0, filesMiss = 0
    for (const c of toUpdate) {
      showClientProgress(done, toUpdate.length, upToDate, c.name)
      for (const it of c.pending) {
        const r = await download(it.bucket, it.storagePath, it.dest)
        if (r === "ok") filesOk++
        else if (r === "error") filesMiss++
      }
      done++
      showClientProgress(done, toUpdate.length, upToDate, c.name)
    }
    Deno.stdout.writeSync(enc.encode("\n"))

    // Salva l'elenco dei file mancanti (record orfani nel DB) per eventuale bonifica.
    if (missing.length) {
      const logPath = path.join(OUT, "file-mancanti.txt")
      await fs.mkdir(OUT, { recursive: true })
      await fs.writeFile(
        logPath,
        "File presenti a database ma non trovati nello storage Supabase:\n\n" + missing.join("\n") + "\n",
      )
    }

    console.log("\n— Riepilogo —")
    console.log(`Clienti con foto/diete: ${clients.length}`)
    console.log(`  già aggiornati:       ${upToDate}`)
    console.log(`  aggiornati adesso:    ${done}`)
    console.log(`File nuovi scaricati:   ${filesOk}`)
    if (filesMiss) {
      console.log(`File a database ma NON presenti nello storage: ${filesMiss}`)
      console.log(`  (elenco in ${path.join(OUT, "file-mancanti.txt")})`)
    }
  }
}

main()
  .catch((err) => { console.error("\nErrore:", err.message) })
  .finally(() => { prompt("\nPremi Invio per chiudere...") })
