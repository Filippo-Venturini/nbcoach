import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('[reset-password] method:', req.method)
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

    const { email, redirect_to } = await req.json()

    if (!email) {
      return new Response(JSON.stringify({ error: "L'email è obbligatoria" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Genera il link di recovery SENZA inviare email: il PT lo condivide a mano.
    // generateLink non manda mai email, quindi non intacca i limiti SMTP.
    const { data, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        ...(redirect_to ? { redirectTo: redirect_to } : {}),
      },
    })

    if (linkError) {
      console.error('[reset-password] link error:', linkError.status, linkError.code, linkError.message)
      const raw = (linkError.message || '').toLowerCase()
      let msg = linkError.message
      if (raw.includes('user not found') || raw.includes('not found')) {
        msg = 'Nessun utente registrato con questa email'
      } else if (raw.includes('rate limit') || linkError.status === 429) {
        msg = 'Limite di richieste raggiunto: attendi qualche istante e riprova.'
      }
      const status = (typeof linkError.status === 'number' && linkError.status >= 400)
        ? linkError.status
        : 400
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Link alla NOSTRA pagina con token_hash: verrà verificato lato client
    // (verifyOtp) solo quando l'utente reale apre la pagina. Così le anteprime
    // di WhatsApp/email non consumano il token monouso.
    const shareLink = (redirect_to && data.properties?.hashed_token)
      ? `${redirect_to}?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`
      : data.properties?.action_link
    return new Response(JSON.stringify({ link: shareLink, user: data.user }), {
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
