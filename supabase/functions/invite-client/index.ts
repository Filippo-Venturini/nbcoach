import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('[invite-client] method:', req.method)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
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

    // Controlla il ruolo nel profilo
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || profile?.role !== 'pt') {
      return new Response(JSON.stringify({ error: 'Accesso riservato al PT' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, full_name, redirect_to } = await req.json()

    if (!email || !full_name) {
      return new Response(JSON.stringify({ error: 'Email e nome sono obbligatori' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Invita il cliente via admin API — manda email con link per impostare la password
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Genera il link di invito SENZA inviare email: il PT lo condivide a mano.
    // Crea comunque l'utente (con full_name e role) legato a questa email.
    const { data, error: inviteError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        data: { full_name, role: 'client' },
        ...(redirect_to ? { redirectTo: redirect_to } : {}),
      },
    })

    if (inviteError) {
      console.error('[invite-client] invite error:', inviteError.status, inviteError.code, inviteError.message)
      const raw = (inviteError.message || '').toLowerCase()
      let msg = inviteError.message
      if (raw.includes('already registered') || raw.includes('already been registered')) {
        msg = 'Questa email è già registrata'
      } else if (raw.includes('rate limit') || inviteError.status === 429) {
        msg = "Limite di invii email raggiunto. Con l'SMTP di default di Supabase si possono inviare solo pochi inviti all'ora: attendi un po' oppure configura un SMTP personalizzato."
      }
      // Propaga lo status reale (es. 429) quando disponibile
      const status = (typeof inviteError.status === 'number' && inviteError.status >= 400)
        ? inviteError.status
        : 400
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ link: data.properties?.action_link, user: data.user }), {
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
