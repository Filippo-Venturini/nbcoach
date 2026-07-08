import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('[delete-client] method:', req.method)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Verifica che il chiamante sia un PT autenticato
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Non autorizzato' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await userClient
      .from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'pt') {
      return new Response(JSON.stringify({ error: 'Accesso riservato al PT' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { client_id } = await req.json()
    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id mancante' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (client_id === user.id) {
      return new Response(JSON.stringify({ error: 'Non puoi eliminare il tuo stesso account da qui' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Sicurezza: il target deve essere un cliente (non un altro PT)
    const { data: target, error: targetError } = await adminClient
      .from('profiles').select('role').eq('id', client_id).single()
    if (targetError || !target) {
      return new Response(JSON.stringify({ error: 'Cliente non trovato' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (target.role !== 'client') {
      return new Response(JSON.stringify({ error: 'Si possono eliminare solo i clienti' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ----------------------------------------------------------------
    // 1. Storage — PDF diete (path salvati in diet_plans.pdf_url)
    // ----------------------------------------------------------------
    const { data: diets } = await adminClient
      .from('diet_plans').select('pdf_url').eq('client_id', client_id)
    const pdfPaths = (diets ?? []).map((d) => d.pdf_url).filter(Boolean)
    if (pdfPaths.length > 0) {
      const { error } = await adminClient.storage.from('diet-pdfs').remove(pdfPaths)
      if (error) console.error('[delete-client] diet-pdfs remove:', error.message)
    }

    // ----------------------------------------------------------------
    // 2. Storage — foto progressi: progress-photos/{client_id}/
    // ----------------------------------------------------------------
    const { data: photoFiles } = await adminClient.storage
      .from('progress-photos').list(client_id)
    if (photoFiles && photoFiles.length > 0) {
      const paths = photoFiles.map((f) => `${client_id}/${f.name}`)
      const { error } = await adminClient.storage.from('progress-photos').remove(paths)
      if (error) console.error('[delete-client] progress-photos remove:', error.message)
    }

    // ----------------------------------------------------------------
    // 3. Elimina l'utente auth → ON DELETE CASCADE su profiles pulisce
    //    workout_programs/plans/exercises, diet_plans, progress_photos,
    //    daily_logs, weekly_notes.
    // ----------------------------------------------------------------
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(client_id)
    if (deleteUserError) {
      console.error('[delete-client] deleteUser:', deleteUserError.message)
      return new Response(JSON.stringify({ error: 'Eliminazione non riuscita' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Errore interno del server' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
