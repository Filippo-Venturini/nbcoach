#!/usr/bin/env node
/**
 * Pulizia storage post-migration 20260730000200_cleanup_mock_data.sql
 *
 * Elimina dai bucket `diet-pdfs` e `progress-photos` i file che non sono più
 * referenziati dal DB (diet_plans.pdf_url / progress_photos.photo_url), cioè
 * quelli dei clienti mock rimossi. Usa la Storage API, quindi cancella davvero
 * il file e non solo la riga in storage.objects.
 *
 * Il bucket `useful-files` NON viene mai toccato.
 *
 * Uso:
 *   node cleanup-storage.mjs            # dry-run: elenca cosa verrebbe eliminato
 *   node cleanup-storage.mjs --apply    # esegue l'eliminazione
 *
 * Richiede in ambiente (o nel .env alla root del repo):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const PLACEHOLDER = '.emptyFolderPlaceholder'
const PAGE = 1000
const REMOVE_CHUNK = 100

// Bucket da ripulire e colonna del DB che ne referenzia i path
const BUCKETS = [
  { bucket: 'diet-pdfs', table: 'diet_plans', column: 'pdf_url' },
  { bucket: 'progress-photos', table: 'progress_photos', column: 'photo_url' },
]

// ─── env ──────────────────────────────────────────────────────

function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [resolve(here, '../../.env'), resolve(here, '.env')]) {
    try {
      for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
        if (!m) continue
        const value = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
        if (value && !process.env[m[1]]) process.env[m[1]] = value
      }
    } catch { /* file assente: si usano le env già presenti */ }
  }
}

loadEnv()

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('✖ Servono SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (env o .env alla root del repo).')
  process.exit(1)
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } })

// ─── helper ───────────────────────────────────────────────────

// Path referenziati dal DB, con paginazione
async function referencedPaths(table, column) {
  const paths = new Set()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(column).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}.${column}: ${error.message}`)
    for (const row of data ?? []) {
      const value = row[column]
      if (value) paths.add(String(value).replace(/^\/+/, ''))
    }
    if (!data || data.length < PAGE) return paths
  }
}

// Elenco ricorsivo dei file di un bucket (list() non è ricorsivo)
async function listBucket(bucket, prefix = '') {
  const files = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    const entries = data ?? []
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      // Le cartelle non hanno metadata/id
      if (entry.id === null || entry.metadata === null) files.push(...await listBucket(bucket, path))
      else files.push(path)
    }
    if (entries.length < PAGE) return files
  }
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ─── main ─────────────────────────────────────────────────────

console.log(APPLY ? '▶ MODALITÀ APPLY: i file verranno eliminati.' : '▶ DRY-RUN: nessun file verrà eliminato (usa --apply).')
console.log(`  Progetto: ${url}`)
console.log('  Bucket "useful-files": ignorato per scelta esplicita.\n')

let failures = 0

for (const { bucket, table, column } of BUCKETS) {
  try {
    const [keep, all] = await Promise.all([referencedPaths(table, column), listBucket(bucket)])
    const orphans = all.filter(p => !keep.has(p) && !p.endsWith(PLACEHOLDER))

    console.log(`── ${bucket}`)
    console.log(`   file nel bucket: ${all.length} · referenziati da ${table}.${column}: ${keep.size} · da eliminare: ${orphans.length}`)
    for (const p of orphans.slice(0, 20)) console.log(`   - ${p}`)
    if (orphans.length > 20) console.log(`   … e altri ${orphans.length - 20}`)

    if (APPLY && orphans.length) {
      let removed = 0
      for (const batch of chunk(orphans, REMOVE_CHUNK)) {
        const { error } = await db.storage.from(bucket).remove(batch)
        if (error) { console.error(`   ✖ errore rimozione: ${error.message}`); failures++; break }
        removed += batch.length
      }
      console.log(`   ✔ eliminati ${removed}/${orphans.length}`)
    }
    console.log()
  } catch (err) {
    console.error(`   ✖ ${bucket}: ${err.message}\n`)
    failures++
  }
}

if (!APPLY) console.log('Nessuna modifica effettuata. Rilancia con --apply per eliminare.')
process.exit(failures ? 1 : 0)
