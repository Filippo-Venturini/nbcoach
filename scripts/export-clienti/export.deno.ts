// ============================================================
// FitCoach — Export foto e diete (versione Deno, per compilare in
// un ESEGUIBILE STANDALONE senza Node). Vedi BUILD.md.
// Legge il file .env posto ACCANTO all'eseguibile.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2"
import { promises as fs, existsSync, readFileSync } from "node:fs"
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
const OUT = Deno.env.get("OUTPUT_DIR") || path.join(BASE, "export")

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERRORE: imposta SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env accanto all'app")
  prompt("Premi Invio per chiudere...")
  Deno.exit(1)
}

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

async function download(bucket, storagePath, destFile) {
  if (!storagePath) return "skip"
  if (existsSync(destFile)) return "skip"
  const { data, error } = await supabase.storage.from(bucket).download(storagePath)
  if (error || !data) {
    console.warn(`  ! impossibile scaricare ${bucket}/${storagePath}: ${error?.message ?? "vuoto"}`)
    return "error"
  }
  const buf = Buffer.from(await data.arrayBuffer())
  await fs.mkdir(path.dirname(destFile), { recursive: true })
  await fs.writeFile(destFile, buf)
  return "ok"
}

async function main() {
  console.log("FitCoach — export foto e diete")
  console.log("Cartella di destinazione:", OUT)
  console.log("Connessione a Supabase...\n")

  const clients = await fetchAll("profiles", "id, full_name, email")
  const nameById = new Map()
  for (const c of clients) nameById.set(c.id, sanitize(c.full_name || c.email || c.id))

  const photos = await fetchAll("progress_photos", "client_id, photo_url, created_at")
  const diets = await fetchAll("diet_plans", "client_id, name, pdf_url, created_at")
  console.log(`Trovate ${photos.length} foto e ${diets.length} diete per ${clients.length} clienti.\n`)

  const stats = { ok: 0, skip: 0, error: 0 }
  const bump = (r) => { stats[r]++ }

  console.log("Scarico le foto...")
  for (const p of photos) {
    const folder = nameById.get(p.client_id) || sanitize(p.client_id)
    const dest = path.join(OUT, folder, "foto", `${dateKey(p.created_at)}_${path.basename(p.photo_url)}`)
    bump(await download("progress-photos", p.photo_url, dest))
  }

  console.log("Scarico le diete...")
  for (const d of diets) {
    const folder = nameById.get(d.client_id) || sanitize(d.client_id)
    const dest = path.join(OUT, folder, "diete", `${dateKey(d.created_at)}_${sanitize(d.name)}.pdf`)
    bump(await download("diet-pdfs", d.pdf_url, dest))
  }

  console.log(`\nCompletato. Nuovi file: ${stats.ok} — già presenti (saltati): ${stats.skip} — errori: ${stats.error}`)
}

main()
  .catch((err) => { console.error("\nErrore:", err.message) })
  .finally(() => { prompt("\nPremi Invio per chiudere...") })
