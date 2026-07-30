-- ============================================================
-- SEED (solo sviluppo) — Dati mock per FitCoach
-- Eseguito automaticamente da `supabase db reset` DOPO le migration.
-- NON viene applicato da `supabase db push`, quindi non finisce in produzione.
--
-- Contenuto:
--   1. 150 utenti mock (@mock.local, senza login)
--   2. 10 programmi x 3 schede x 7 esercizi per cliente
--   3. 1 anno di raccolta dati (daily_logs)
--   4. Foto e diete che riusano i file reali già nello storage
--   5. Scadenze distribuite (solo future)
--   6. reps_effettive su una parte degli esercizi
-- ============================================================

-- ------------------------------------------------------------
-- 1. UTENTI MOCK (solo dati, nessun login: password non utilizzabile)
-- ------------------------------------------------------------
do $$
declare
  first_names text[] := array[
    'Marco','Luca','Giulia','Sara','Andrea','Francesco','Chiara','Elena','Matteo','Alessandro',
    'Federica','Valentina','Davide','Simone','Martina','Giorgia','Lorenzo','Stefano','Alice','Roberto'
  ];
  last_names text[] := array[
    'Rossi','Bianchi','Ferrari','Russo','Esposito','Romano','Colombo','Ricci','Marino','Greco',
    'Bruno','Gallo','Conti','De Luca','Mancini','Costa','Giordano','Rizzo','Lombardi','Moretti'
  ];
  n_first int := array_length(first_names, 1);
  n_last  int := array_length(last_names, 1);
  i    int;
  uid  uuid;
  fname text;
  mail  text;
begin
  for i in 1..150 loop
    mail := 'cliente' || lpad(i::text, 3, '0') || '@mock.local';
    if exists (select 1 from auth.users where email = mail) then
      continue;
    end if;
    uid := gen_random_uuid();
    fname := first_names[1 + ((i - 1) % n_first)] || ' ' || last_names[1 + (((i - 1) / n_first) % n_last)];
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
      '$2b$12$swiDIi3k.wubTSI508bWQORg.U3MD6KQR8iJ6n9Vihz3VUFofyj6W',
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', fname, 'role', 'client'),
      false, '', '', '', ''
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. PROGRAMMI / SCHEDE / ESERCIZI
-- ------------------------------------------------------------
do $$
declare
  client_rec  record;
  prog_id     uuid;
  plan_id     uuid;
  p           int;
  s           int;
  plan_labels text[] := array['Scheda A', 'Scheda B', 'Scheda C'];
  matrix      jsonb;
begin
  matrix := jsonb_build_object(
    'Petto',             jsonb_build_object('prev','Forza','current','Ipertrofia','next','Scarico'),
    'Centro Schiena',    jsonb_build_object('prev','Ipertrofia','current','Forza','next','Ipertrofia'),
    'Dorsale',           jsonb_build_object('prev','Forza','current','Ipertrofia','next','Metabolico'),
    'Spalle',            jsonb_build_object('prev','Metabolico','current','Ipertrofia','next','Forza'),
    'Spalla Posteriore', jsonb_build_object('prev','Ipertrofia','current','Metabolico','next','Ipertrofia'),
    'Bicipiti',          jsonb_build_object('prev','Ipertrofia','current','Ipertrofia','next','Metabolico'),
    'Tricipiti',         jsonb_build_object('prev','Metabolico','current','Ipertrofia','next','Ipertrofia'),
    'Quadricipiti',      jsonb_build_object('prev','Forza','current','Ipertrofia','next','Scarico'),
    'Femorali',          jsonb_build_object('prev','Ipertrofia','current','Forza','next','Ipertrofia'),
    'Glutei',            jsonb_build_object('prev','Ipertrofia','current','Ipertrofia','next','Metabolico'),
    'Addome',            jsonb_build_object('prev','Resistenza','current','Resistenza','next','Resistenza'),
    'Stabilizzatori',    jsonb_build_object('prev','Mobilità','current','Mobilità','next','Mobilità')
  );

  for client_rec in
    select p.id from profiles p join auth.users u on u.id = p.id
    where u.email like '%@mock.local'
  loop
    if exists (select 1 from workout_programs where client_id = client_rec.id) then
      continue;
    end if;
    for p in 1..10 loop
      insert into workout_programs (client_id, name, notes, is_active, stimulus_matrix, created_at)
      values (client_rec.id, 'Programma ' || p, 'Programma mock nr. ' || p, (p = 10), matrix,
              now() - (((10 - p) * 14) || ' days')::interval)
      returning id into prog_id;

      for s in 1..3 loop
        insert into workout_plans (client_id, program_id, name, is_active, created_at)
        values (client_rec.id, prog_id, plan_labels[s], (p = 10), now())
        returning id into plan_id;

        insert into workout_exercises (plan_id, exercise_id, sets, reps, carico, rest, cadenza, notes, order_index)
        select plan_id, ec.id, 4, '8-12', null, '1:30', null, null, row_number() over () - 1
        from (select id from exercises_catalog order by random() limit 7) ec;
      end loop;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. RACCOLTA DATI — 1 anno di daily_logs
-- ------------------------------------------------------------
do $$
declare
  client_rec record;
  base_peso  numeric;
  base_vita  numeric;
begin
  for client_rec in
    select p.id from profiles p join auth.users u on u.id = p.id
    where u.email like '%@mock.local'
  loop
    base_peso := round((65 + random() * 25)::numeric, 1);
    base_vita := round((75 + random() * 25)::numeric, 1);
    insert into daily_logs (client_id, logged_date, data, created_at)
    select
      client_rec.id, g::date,
      jsonb_build_object(
        'peso',          round((base_peso + (random() * 2 - 1))::numeric, 1),
        'vita',          round((base_vita + (random() * 2 - 1))::numeric, 1),
        'allenamento',   (random() < 0.6),
        'cheat',         (random() < 0.15),
        'ore_sonno',     round((6 + random() * 3)::numeric, 1),
        'qualita_sonno', (5 + floor(random() * 6))::int,
        'stress',        (2 + floor(random() * 7))::int
      ),
      (g::date)::timestamptz + time '20:00'
    from generate_series((current_date - 364), current_date, interval '1 day') as s(g)
    on conflict (client_id, logged_date) do nothing;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4. FOTO + DIETE — riusano i file REALI presenti nello storage
--    (no-op se i bucket sono vuoti, es. su reset locale senza file)
-- ------------------------------------------------------------
do $$
declare
  photo_paths text[];
  diet_paths  text[];
  n_photos    int;
  n_diets     int;
  client_rec  record;
begin
  select array_agg(o.name) into photo_paths
  from storage.objects o
  where o.bucket_id = 'progress-photos'
    and o.name not like '%.emptyFolderPlaceholder' and o.name not like '%/';

  select array_agg(o.name) into diet_paths
  from storage.objects o
  where o.bucket_id = 'diet-pdfs'
    and o.name not like '%.emptyFolderPlaceholder' and o.name not like '%/';

  n_photos := coalesce(array_length(photo_paths, 1), 0);
  n_diets  := coalesce(array_length(diet_paths, 1), 0);
  raise notice 'Seed media: % foto, % diete riutilizzabili', n_photos, n_diets;

  if n_photos = 0 and n_diets = 0 then
    return;
  end if;

  for client_rec in
    select p.id from profiles p join auth.users u on u.id = p.id
    where u.email like '%@mock.local'
  loop
    if n_photos > 0 then
      delete from progress_photos where client_id = client_rec.id;
      insert into progress_photos (client_id, photo_url, notes, created_at)
      select client_rec.id, photo_paths[1 + (((mo * 4) + dy) % n_photos)], null,
             (date_trunc('week', (now() - (mo * interval '30 days')))::date + dy)::timestamptz + time '12:00'
      from generate_series(0, 11) as m(mo)
      cross join generate_series(0, 3) as d(dy);
    end if;

    if n_diets > 0 then
      delete from diet_plans where client_id = client_rec.id;
      insert into diet_plans (client_id, name, pdf_url, notes, is_active, created_at)
      select client_rec.id, 'Dieta ' || i, diet_paths[1 + ((i - 1) % n_diets)], null, (i = 10),
             now() - (((10 - i) * 14) || ' days')::interval
      from generate_series(1, 10) as s(i);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5. SCADENZE — distribuite, solo future (da oggi in avanti)
--    Categorie: 0=nessuna, 1=solo dieta, 2=solo allenamento, 3=entrambe
-- ------------------------------------------------------------
with mock as (
  select p.id as client_id, row_number() over (order by u.email) as n
  from profiles p join auth.users u on u.id = p.id
  where u.email like '%@mock.local'
)
update diet_plans d
set expires_at = case when (m.n % 4) in (1, 3) then current_date + floor(random() * 84)::int else null end
from mock m
where d.client_id = m.client_id and d.is_active = true;

with mock as (
  select p.id as client_id, row_number() over (order by u.email) as n
  from profiles p join auth.users u on u.id = p.id
  where u.email like '%@mock.local'
)
update workout_programs w
set expires_at = case when (m.n % 4) in (2, 3) then current_date + floor(random() * 84)::int else null end
from mock m
where w.client_id = m.client_id and w.is_active = true;

-- ------------------------------------------------------------
-- 6. REPS EFFETTIVE — su ~metà dei clienti, solo programma attivo, ~70% esercizi
-- ------------------------------------------------------------
with mock as (
  select p.id as client_id, row_number() over (order by u.email) as n
  from profiles p join auth.users u on u.id = p.id
  where u.email like '%@mock.local'
)
update workout_exercises we
set reps_effettive = (
  select string_agg((8 + floor(random() * 5))::int::text, '-')
  from generate_series(1, greatest(coalesce(we.sets, 3), 1))
)
from workout_plans wp
join workout_programs prog on prog.id = wp.program_id and prog.is_active = true
join mock m on m.client_id = wp.client_id
where we.plan_id = wp.id and (m.n % 2) = 0 and random() < 0.7;
