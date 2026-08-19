-- ============================================================
-- BASELINE SCHEMA — FitCoach
-- Stato consolidato dello schema (sostituisce le vecchie migration 001..011).
-- I dati MOCK non sono qui: stanno in supabase/seed.sql (solo sviluppo/reset).
-- È incluso però il catalogo reale dei 241 esercizi (dato di riferimento).
-- ============================================================

-- ---------- ENUM ----------
create type user_role as enum ('pt', 'client');

-- ---------- TABELLE ----------
create table profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  full_name             text,
  role                  user_role not null default 'client',
  phone                 text,
  email                 text,
  questionnaire_pending boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table exercises_catalog (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  youtube_id   text not null,
  muscle_group text,
  created_at   timestamptz not null default now()
);

create table workout_programs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references profiles(id) on delete cascade,
  name            text,
  notes           text,
  is_active       boolean not null default true,
  expires_at      date,
  stimulus_matrix jsonb not null default '{}'::jsonb,
  volume_targets  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on column workout_programs.volume_targets is
  'Volume settimanale pianificato dal PT per gruppo muscolare, in numero di serie. Es. {"Petto": 12, "Dorsale": 10}. Chiavi opzionali: solo i gruppi pianificati.';

create table workout_plans (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id) on delete cascade,
  program_id   uuid references workout_programs(id) on delete cascade,
  name         text not null,
  notes        text,
  is_active    boolean not null default true,
  volume_targets jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table workout_exercises (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references workout_plans(id) on delete cascade,
  exercise_id    uuid not null references exercises_catalog(id) on delete cascade,
  sets           int,
  reps           text,
  carico         text,
  rest           text,
  cadenza        text,
  reps_effettive text,
  notes          text,
  superset_color text,
  order_index    int not null default 0
);

comment on column workout_exercises.reps_effettive is
  'Ripetizioni effettivamente eseguite dal cliente, testo libero (es. "2-3-2"). Compilato lato app dal cliente.';

comment on column workout_exercises.rest is
  'Recupero tra le serie in minuti, testo libero (es. "1:30", "2", "1.5").';

comment on column workout_exercises.superset_color is
  'Hex color (es. "#ef4444") se l''esercizio è parte di una superserie/circuito. NULL se esercizio singolo. Esercizi con lo stesso colore nella stessa scheda sono raggruppati insieme dal PT.';

create table diet_plans (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id) on delete cascade,
  name         text not null,
  pdf_url      text not null,
  notes        text,
  is_active    boolean not null default true,
  expires_at   date,
  created_at   timestamptz not null default now()
);

create table progress_photos (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id) on delete cascade,
  photo_url    text not null,
  notes        text,
  created_at   timestamptz not null default now()
);

create table useful_files (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  file_path   text not null,
  file_size   bigint,
  mime_type   text,
  category    text not null default 'Allenamento',
  created_at  timestamptz not null default now()
);

create table app_settings (
  key   text primary key,
  value text
);

create table daily_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references profiles(id) on delete cascade,
  logged_date date not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (client_id, logged_date)
);

create table weekly_notes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references profiles(id) on delete cascade,
  week_start  date not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, week_start)
);

-- ---------- INDICI ----------
create index on exercises_catalog (muscle_group);
create index on workout_programs (client_id);
create index on workout_programs (client_id, is_active);
create index on workout_plans (client_id);
create index on workout_plans (client_id, is_active);
create index on workout_plans (program_id);
create index on workout_exercises (plan_id, order_index);
create index on diet_plans (client_id);
create index on diet_plans (client_id, is_active);
create index on progress_photos (client_id, created_at desc);
create index on daily_logs (client_id, logged_date desc);
create index weekly_notes_client_week_idx on weekly_notes (client_id, week_start desc);

-- ---------- FUNZIONI ----------
create or replace function is_pt()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'pt'
  );
$$;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'client')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- TRIGGER ----------
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

create trigger profiles_updated_at
  before update on profiles
  for each row execute procedure set_updated_at();

create trigger workout_plans_updated_at
  before update on workout_plans
  for each row execute procedure set_updated_at();

create trigger weekly_notes_updated_at
  before update on weekly_notes
  for each row execute procedure set_updated_at();

-- ---------- RLS ----------
alter table profiles enable row level security;
create policy "pt can view all profiles"      on profiles for select using (is_pt());
create policy "pt can update all profiles"     on profiles for update using (is_pt());
create policy "users can view own profile"     on profiles for select using (auth.uid() = id);
create policy "users can update own profile"   on profiles for update using (auth.uid() = id);

alter table exercises_catalog enable row level security;
create policy "authenticated users can view catalog" on exercises_catalog for select using (auth.role() = 'authenticated');
create policy "pt can manage catalog"                on exercises_catalog for all    using (is_pt());

alter table workout_programs enable row level security;
create policy "pt can manage all programs"     on workout_programs for all    using (is_pt());
create policy "clients can view own programs"  on workout_programs for select using (client_id = auth.uid());

alter table workout_plans enable row level security;
create policy "pt can manage all workout plans"    on workout_plans for all    using (is_pt());
create policy "clients can view own workout plans" on workout_plans for select using (client_id = auth.uid());

alter table workout_exercises enable row level security;
create policy "pt can manage all workout exercises" on workout_exercises for all using (is_pt());
create policy "clients can view own workout exercises"
  on workout_exercises for select
  using (
    exists (
      select 1 from workout_plans
      where workout_plans.id = workout_exercises.plan_id
        and workout_plans.client_id = auth.uid()
    )
  );

alter table diet_plans enable row level security;
create policy "pt can manage all diet plans"    on diet_plans for all    using (is_pt());
create policy "clients can view own diet plans" on diet_plans for select using (client_id = auth.uid());

alter table progress_photos enable row level security;
create policy "pt can view all progress photos"        on progress_photos for select using (is_pt());
create policy "clients can insert own progress photos" on progress_photos for insert with check (client_id = auth.uid());
create policy "clients can view own progress photos"   on progress_photos for select using (client_id = auth.uid());
create policy "clients can delete own progress photos" on progress_photos for delete using (client_id = auth.uid());

alter table useful_files enable row level security;
create policy "pt can manage useful files"
  on useful_files for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'pt'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'pt'));
create policy "authenticated can read useful files" on useful_files for select using (auth.role() = 'authenticated');

alter table app_settings enable row level security;
create policy "authenticated can read app_settings" on app_settings for select using (auth.role() = 'authenticated');
create policy "pt can update app_settings"
  on app_settings for update
  using (exists (select 1 from profiles where id = auth.uid() and role = 'pt'));

alter table daily_logs enable row level security;
create policy "pt can read all daily logs"
  on daily_logs for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'pt'));
create policy "client can manage own daily logs"
  on daily_logs for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

alter table weekly_notes enable row level security;
create policy "pt can manage all weekly notes"
  on weekly_notes for all using (is_pt()) with check (is_pt());
create policy "client can manage own weekly notes"
  on weekly_notes for all using (client_id = auth.uid()) with check (client_id = auth.uid());

-- ---------- STORAGE ----------
insert into storage.buckets (id, name, public) values
  ('diet-pdfs', 'diet-pdfs', true),
  ('progress-photos', 'progress-photos', true),
  ('useful-files', 'useful-files', false)
on conflict (id) do nothing;

-- diet-pdfs
create policy "pt can upload diet pdfs"
  on storage.objects for insert
  with check (bucket_id = 'diet-pdfs' and exists (select 1 from profiles where id = auth.uid() and role = 'pt'));
create policy "pt can delete diet pdfs"
  on storage.objects for delete
  using (bucket_id = 'diet-pdfs' and exists (select 1 from profiles where id = auth.uid() and role = 'pt'));
create policy "authenticated users can download diet pdfs"
  on storage.objects for select
  using (bucket_id = 'diet-pdfs' and auth.role() = 'authenticated');

-- progress-photos
create policy "clients can upload own progress photos"
  on storage.objects for insert
  with check (bucket_id = 'progress-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "clients can view own progress photos"
  on storage.objects for select
  using (bucket_id = 'progress-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "clients can delete own progress photos"
  on storage.objects for delete
  using (bucket_id = 'progress-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "pt can view all progress photos"
  on storage.objects for select
  using (bucket_id = 'progress-photos' and exists (select 1 from profiles where id = auth.uid() and role = 'pt'));

-- useful-files
create policy "pt can upload useful files"
  on storage.objects for insert
  with check (bucket_id = 'useful-files' and exists (select 1 from profiles where id = auth.uid() and role = 'pt'));
create policy "pt can delete useful files"
  on storage.objects for delete
  using (bucket_id = 'useful-files' and exists (select 1 from profiles where id = auth.uid() and role = 'pt'));
create policy "authenticated can download useful files"
  on storage.objects for select
  using (bucket_id = 'useful-files' and auth.role() = 'authenticated');

-- ---------- DATI DI RIFERIMENTO ----------
insert into app_settings (key, value) values ('questionnaire_form_url', null)
on conflict (key) do nothing;

-- Catalogo esercizi (241 voci, dato di riferimento)
insert into exercises_catalog (name, youtube_id, muscle_group) values
  ('Abductor', '8R9ZhlTMdnE', 'Glutei'),
  ('Adductor', 'cMP9Ql04Fcw', 'Femorali'),
  ('Affondi', '_Clggs-WmjI', 'Quadricipiti'),
  ('Affondi in camminata', 'M3cHIj0r3-w', 'Quadricipiti'),
  ('Affondi in deficit', '2L1TXhpSfHI', 'Quadricipiti'),
  ('Affondi posteriori', 'uI03SgXDNXs', 'Glutei'),
  ('Alzate laterali cavo basso (cavigliera)', 'okAg3DHuQHU', 'Spalle'),
  ('Alzate laterali cavo basso (maniglia)', 'WXbC9KgTRHk', 'Spalle'),
  ('Alzate laterali cavi bassi panca 60°', 'DuULzk5DQUE', 'Spalle'),
  ('Alzate laterali dec. Laterale - panca piana', 'ID3PVL_n5aA', 'Spalle'),
  ('Alzate laterali dec. Laterale - panca 30°', 'ItTlqehMtcY', 'Spalle'),
  ('Alzate laterali in piedi', '2Mf0DZNS4Fs', 'Spalle'),
  ('Alzate laterali in piedi panca 75°', '4i77CRia9m0', 'Spalle'),
  ('Alzate laterali prono panca 60°', 'qwNzEce99vM', 'Spalla Posteriore'),
  ('Alzate laterali prono panca 75°', 'qwNzEce99vM', 'Spalla Posteriore'),
  ('Alzate laterali seduto/a a terra', 'piVtnnBLt6o', 'Spalle'),
  ('Alzate laterali seduto/a (no schienale)', 'RWjtxbDVx5I', 'Spalle'),
  ('Alzate laterali seduto/a panca 60°', 'sU_CeIFNzuY', 'Spalle'),
  ('Aperture posteriori busto 90°', '8-v3iywtxpM', 'Spalla Posteriore'),
  ('Aperture posteriori su panca 30°', 'SKJPZ1XcE-g', 'Spalla Posteriore'),
  ('Aperture posteriori al cavo alto (singole)', 'r5JfNKEZtuc', 'Spalla Posteriore'),
  ('Aperture posteriori al cavo alto', 'tk1cx1j6aPg', 'Spalla Posteriore'),
  ('Australian pull up', 'QO8sHAMe4tc', 'Centro Schiena'),
  ('Bayesian curl cavo basso', 'CeKMs_tz1MA', 'Bicipiti'),
  ('Belt squat', '3pFlcFH-19o', 'Quadricipiti'),
  ('Cat curl', 'gfv5ZAyqgHU', 'Femorali'),
  ('Chest press', 'yydkHkn8n_s', 'Petto'),
  ('Chest press cavi bassi panca 60°', 'qOBGQ0zQMpY', 'Petto'),
  ('Chest supported row manubri (panca 30° - in piedi)', 'sjqzVxLBvqo', 'Centro Schiena'),
  ('Chest supported row bilanciere ez (panca 30° - in piedi - presa supina)', 'T9MAfA9o_BA', 'Centro Schiena'),
  ('Chin up (presa supina)', 'LzH-gFYIbM4', 'Dorsale'),
  ('Chin up (presa neutra)', 'Y1zp7KTB3a4', 'Dorsale'),
  ('Croci cavi alti', 'ece2JNd0vXs', 'Petto'),
  ('Croci cavi bassi in piedi', 'BRx9RF-Yiok', 'Petto'),
  ('Croci cavi bassi panca 60°', 'xUClxKILM1o', 'Petto'),
  ('Croci cavi bassi panca 60° (focus clavicolari)', '6xbHGneGTDY', 'Petto'),
  ('Croci cavi bassi panca 60° (focus clavicolari - cavigliera)', 'RUqSGkAdNFA', 'Petto'),
  ('Croci manubri panca 15°', 'WpcmiptncLY', 'Petto'),
  ('Croci manubri panca 30°', 'VzGnhOaMSPo', 'Petto'),
  ('Croci manubri panca 30° (versione pro)', 'cS-sXwy_tYo', 'Petto'),
  ('Croci manubri panca 45°', 'VzGnhOaMSPo', 'Petto'),
  ('Cross cable push down', 'Nr2ShKZY-C4', 'Tricipiti'),
  ('Curl al trx', 'aUuOIf7SD9M', 'Bicipiti'),
  ('Curl cavi alti alle orecchie', 'l1qnR-XQw8w', 'Bicipiti'),
  ('Curl alla scott cavo basso', 'lATxmaSCnEk', 'Bicipiti'),
  ('Curl alla panca scott bilanciere ez', '52DLZq7l-Do', 'Bicipiti'),
  ('Curl alla panca scott manubri', 'cTteoopdI-I', 'Bicipiti'),
  ('Curl bilanciere ez', 'OFszdccExLk', 'Bicipiti'),
  ('Curl cavo basso', 'X_CLHHo3sBw', 'Bicipiti'),
  ('Curl cavo basso corda/vulken', 'PaZHLgyGoS0', 'Bicipiti'),
  ('Curl manubri panca 45°', '6S6m-IutYBQ', 'Bicipiti'),
  ('Curl manubri panca 60°', '6S6m-IutYBQ', 'Bicipiti'),
  ('Curl manubri panca 75°', 'eyub48RM7Ag', 'Bicipiti'),
  ('Curl martello in piedi', 'QSGh5n5MYNo', 'Bicipiti'),
  ('Dip', '4g9TgNywIdI', 'Tricipiti'),
  ('Distensioni al multipower panca 15°', 'TJKhYdNCU9E', 'Petto'),
  ('Distensioni al multipower panca 30°', 'TJKhYdNCU9E', 'Petto'),
  ('Distensioni al multipower panca 45° - presa stretta', 'CpCnzZwRtOg', 'Petto'),
  ('Face pull', 'xN2HCUe6UCE', 'Spalla Posteriore'),
  ('Floor flyes', 'iV5Mw9pzMPU', 'Petto'),
  ('Floor press bilanciere', 'CfvgZBqVoaw', 'Petto'),
  ('Flyes machine', 'dC1q8C4CePk', 'Petto'),
  ('Floor press manubri', 'pB8Q-d_oDjg', 'Petto'),
  ('French press corpo libero', 'LotCkJWuvQ4', 'Tricipiti'),
  ('French press bilanciere ez', 'Dn1uJCk2PV8', 'Tricipiti'),
  ('French press bilanciere ez (a terra)', 'gTXk2I8qsXk', 'Tricipiti'),
  ('French press cavo alto', 'w11OYjkCYes', 'Tricipiti'),
  ('French press cavo basso corda/vulken', 'g0Flf57rDns', 'Tricipiti'),
  ('French press manubrio (seduto/a)', 'YNJugkQAcRk', 'Tricipiti'),
  ('French press manubri panca piana', '9IwRW7gwqAU', 'Tricipiti'),
  ('French press manubri panca 15°', '9IwRW7gwqAU', 'Tricipiti'),
  ('French press manubri panca 30°', '9IwRW7gwqAU', 'Tricipiti'),
  ('French press manubri panca 45°', '9IwRW7gwqAU', 'Tricipiti'),
  ('Frog pump', 'ZMBl7nsMJqI', 'Glutei'),
  ('Frog pump bilanciere', 'YVUJ84rQYp4', 'Glutei'),
  ('Gironda chin up', '5s9ihSURQAs', 'Dorsale'),
  ('Glute machine', 'GNyug7o2V3c', 'Glutei'),
  ('Hack squat', 'CJnKYIGJjRk', 'Quadricipiti'),
  ('Hack squat al multipower', 'C6evYRUGh_s', 'Quadricipiti'),
  ('Hip Thrust', 'XhUoI6wEXGo', 'Glutei'),
  ('Hip Thrust al multipower', 'SyUzVCzusMA', 'Glutei'),
  ('Hip Thrust b stance', '08GlBimxLlA', 'Glutei'),
  ('Hpx (focus femorali)', 'pX2UArSjfRo', 'Femorali'),
  ('Hpx (focus glutei)', 'XmzQ0Jgk2bc', 'Glutei'),
  ('Hpx singolo', 'pRMegJR5Qc4', 'Glutei'),
  ('Iliac pulldown (in ginocchio)', 'bHGEFhdE6GY', 'Dorsale'),
  ('Iliac pulldown (panca 60° - presa supina)', 'DUckbzQfs9I', 'Dorsale'),
  ('Iliac pulldown (panca 75° - presa neutra)', 'tgcdf38K5VY', 'Dorsale'),
  ('Intrarotazione del femore (prona)', 'GUqFUlUTOkg', 'Stabilizzatori'),
  ('JM Press', 'kTAInrhTx7w', 'Tricipiti'),
  ('Kick back manubri', 'C3qfzpJ2C2M', 'Tricipiti'),
  ('Kick back cavo basso', 'k412grO3dBg', 'Tricipiti'),
  ('Kneeling landmine squeeze press', 'kMkpTHibiTo', 'Petto'),
  ('Lat machine larga', 'wtO9Gg9mhUo', 'Dorsale'),
  ('Lat machine mag media', '7TEdd2Ih8mM', 'Dorsale'),
  ('Lat machine mag triangolo', 'hX_t1gGWF54', 'Dorsale'),
  ('Lat machine triangolo', 'xEo4AZyrAMU', 'Dorsale'),
  ('Lat machine triangolo (Stile gironda)', 'oq6An73LLAE', 'Dorsale'),
  ('Lat machine sbarra + maniglie', 'Z5qYHOZ0vog', 'Dorsale'),
  ('Lat machine singola', 'zyB1R79ddo4', 'Dorsale'),
  ('Lat machine supina', 'UQ0ln3vds8k', 'Dorsale'),
  ('Lat machine vulken', 'mxnyyQIGR20', 'Dorsale'),
  ('Lat machine vulken (panca 45°)', 'PNKJ8CSE9T0', 'Dorsale'),
  ('Leg curl fitball', 'AeS2EAdMpkQ', 'Femorali'),
  ('Leg curl in piedi', 'PQuDLLhbaUU', 'Femorali'),
  ('Leg curl manubrio', 'x4m2K1DqnNc', 'Femorali'),
  ('Leg curl manubrio (+ elastico)', 'l0WfY4_Vqcs', 'Femorali'),
  ('Leg curl sdraiato/a', 'nQCu0dYNo0E', 'Femorali'),
  ('Leg curl seduto/a', '_vW3Mwjhp3c', 'Femorali'),
  ('Leg curl seduto/a (gamba singola)', 'cTd7XkAp38Q', 'Femorali'),
  ('Leg extension', 'iz-1UEvCTdo', 'Quadricipiti'),
  ('Leg extension (gamba singola)', 'K1SU2k2cd94', 'Quadricipiti'),
  ('Leg press', 'FFn7BRYM-BY', 'Quadricipiti'),
  ('Leg press 45°', 'OwDUSxaOScY', 'Quadricipiti'),
  ('Leg press (gamba singola)', 'ude489VJSjU', 'Quadricipiti'),
  ('Leg press 45° (focus femorali)', '7q866ACRlnc', 'Femorali'),
  ('Leg press 45° (gamba singola)', 'XS5m8Tf4-qA', 'Quadricipiti'),
  ('Leg press (full ROM)', 'WUcxu_Rm8js', 'Quadricipiti'),
  ('Lento avanti manubri panca 60°', 'JrnzayUObDo', 'Spalle'),
  ('Lying curl cavo basso', 'bJslTE_RdIo', 'Femorali'),
  ('Low row', 'axGqteZRkvc', 'Centro Schiena'),
  ('Nordic leg curl', 'jrHmfwu9Akg', 'Femorali'),
  ('OHP al multipower panca 60°', 'CPXys-vjcK8', 'Spalle'),
  ('OHP dai pin', '7257BoGo5_k', 'Spalle'),
  ('OHP panca 60°', 'lPzJfueE0Y8', 'Spalle'),
  ('Panca inclinata bilanciere', 'np_zwetfRh8', 'Petto'),
  ('Panca piana', 'j4YCwl57PY0', 'Petto'),
  ('Panca piana paralimpica', 'Bz5A0nRAJO4', 'Petto'),
  ('Pendlay row', '65-VY89DDeI', 'Centro Schiena'),
  ('Pike push up', 'xdp31Hk2v3s', 'Spalle'),
  ('PJR Pullover bilanciere ez', 'W1zkYkXmY84', 'Tricipiti'),
  ('PJR Pullover manubri', 'SBSksqblATw', 'Tricipiti'),
  ('Ponte glutei', '8Z0F_o_25_U', 'Glutei'),
  ('Ponte glutei (gamba singola)', 'Sa4gWgVkOxA', 'Glutei'),
  ('Preacher curl cavo basso', 'bzk04wDHpSc', 'Bicipiti'),
  ('Preacher curl manubrio', 'Og8Ldq4T9Wo', 'Bicipiti'),
  ('Pull Up', 'Sj6kvKTSu5w', 'Dorsale'),
  ('Pulldown corda/vulken', 'sQKlmNBhDnY', 'Dorsale'),
  ('Pulldown corda/vulken (versione pro)', 'Vh9atF15XXw', 'Dorsale'),
  ('Pulldown sbarra', 'lS4T3bz3NEI', 'Dorsale'),
  ('Pulldown singolo', 'I2TBj91v3IY', 'Dorsale'),
  ('Pulley mag media', 's-hBNUU6cz0', 'Centro Schiena'),
  ('Pulley mag triangolo', 'TQq9nqv5ou0', 'Centro Schiena'),
  ('Pulley triangolo', '1LMUAbAtS1o', 'Centro Schiena'),
  ('Pulley sbarra', 'M0g9Jl23zt0', 'Centro Schiena'),
  ('Pulley vulken', '5CYk88pkPTg', 'Centro Schiena'),
  ('Pulley singolo', '-WL0-yTcId4', 'Centro Schiena'),
  ('Pulley in cifosi', 'YAUEalS5bgI', 'Centro Schiena'),
  ('Pullover manubrio (panca piana)', 'NzV326fVl_0', 'Dorsale'),
  ('Pullover manubrio (panca declinata)', 'NzV326fVl_0', 'Dorsale'),
  ('Pullover al cavo (panca piana)', 'pLYz0XvTk-4', 'Dorsale'),
  ('Pullover al cavo (panca 15°)', 'pLYz0XvTk-4', 'Dorsale'),
  ('Pullover al cavo (panca 30°)', 'pLYz0XvTk-4', 'Dorsale'),
  ('Push down sbarra', 'x1wWDQQPSyQ', 'Tricipiti'),
  ('Push down corda/vulken', 'aiqN9iOQMAU', 'Tricipiti'),
  ('Push up', 'GSSQ4OLR9B4', 'Petto'),
  ('Rack pull', 'nq0i1_m0gcM', 'Femorali'),
  ('Rematore bilanciere (presa prona)', 'r_cRYlPsDjU', 'Centro Schiena'),
  ('Rematore bilanciere (presa supina)', 'SvG1O-1oYTI', 'Centro Schiena'),
  ('Rematore manubri (in piedi)', 'tQse4To3SBo', 'Centro Schiena'),
  ('Rematore manubrio', 'fvJcBLLO4nA', 'Centro Schiena'),
  ('Reverse hack squat', 'UkRZQcCYq3w', 'Quadricipiti'),
  ('Reverse hyper', 'L9PtVd1THZo', 'Glutei'),
  ('Row al trx', 'sGW0xaQmn9c', 'Centro Schiena'),
  ('Row machine', 'RerH6Y7h-RE', 'Centro Schiena'),
  ('Seal row manubri panca 30°', 'RuajlvRoZL8', 'Centro Schiena'),
  ('Shoulder press', 'PiBJj3c6zMk', 'Spalle'),
  ('Sissy leg press', 'Wpthh__xMjE', 'Quadricipiti'),
  ('Sissy squat', 'w20d8YL6GfI', 'Quadricipiti'),
  ('Squat', 'uDJgOvss4yA', 'Quadricipiti'),
  ('Squat bulgaro', 'Xlm7UJVE2Ro', 'Quadricipiti'),
  ('Squat bulgaro al multipower (focus glutei)', 'NHTCpnExQ_g', 'Glutei'),
  ('Squat bulgaro al multipower (focus quad)', 'OXY6AvmIsek', 'Quadricipiti'),
  ('Squat bulgaro bilanciere', 'B8SHteHOj4c', 'Quadricipiti'),
  ('Squat goblet', 'xpuxA49VzQ0', 'Quadricipiti'),
  ('Squat isometrico', 'Dyq_WrQsCLs', 'Quadricipiti'),
  ('Slanci posteriori al cavo basso', '8Migl4Y7LeA', 'Glutei'),
  ('Spider curl', 'E1iTi1StUUI', 'Bicipiti'),
  ('Spinte manubri panca piana', 'U3JuYOvguWg', 'Petto'),
  ('Spinte manubri panca 15°', 'U3JuYOvguWg', 'Petto'),
  ('Spinte manubri panca 30°', 'Yv0c46cRXHE', 'Petto'),
  ('Spinte manubri panca 45° (presa stretta)', 'GpBVgYBXcY8', 'Petto'),
  ('Stacco', 'En_rWmOBoXs', 'Femorali'),
  ('Stacco GT', 'ZtyieP5vcw8', 'Femorali'),
  ('Stacco GT b stance', '6kxia6SP4eo', 'Femorali'),
  ('Stacco rumeno', 'I-7q0yhUkZU', 'Femorali'),
  ('Stacco rumeno al rack', 'mhZ9fz4-ps8', 'Femorali'),
  ('Stacco rumeno al landmine', 'L0mGVyLSSEA', 'Femorali'),
  ('Stacco rumeno b stance', 'T9nvDx8qfDU', 'Femorali'),
  ('Stacco rumeno b stance al multipower', 'Hht-XgTUHO0', 'Femorali'),
  ('Stacco rumeno b stance (gamba su panca)', 'PVenOJQyUaU', 'Femorali'),
  ('Stacco rumeno manubri', 'b_nYl--cHcI', 'Femorali'),
  ('Stacco sumo', 'rKxtKs0mves', 'Glutei'),
  ('Stacco sumo con kett/manubrio', 'v_yruSf7GMM', 'Glutei'),
  ('Step up', 'txB8w4BvVlQ', 'Quadricipiti'),
  ('Step up all''easypower', '_13lHCugwRQ', 'Quadricipiti'),
  ('Swing', '7vuDjS3ES6E', 'Glutei'),
  ('T Bar', 'gv7xfweHAZk', 'Centro Schiena'),
  ('Tirate al petto bilanciere ez', '7alo5dkl13s', 'Spalle'),
  ('Tirate al petto cavo basso corda/vulken', 'Pwscyn-ju18', 'Spalle'),
  ('Tirate posteriori al cavo alto', '4VWHMOIXapI', 'Spalla Posteriore'),
  ('Tirate posteriori busto 90°', '0I-nJVe9OQE', 'Spalla Posteriore'),
  ('Tirate posteriori panca 30°', 'rv7MSNDqdVM', 'Spalla Posteriore'),
  ('Tirate posteriori dec. Laterale - panca piana', 'cVvGdx4yaY4', 'Spalla Posteriore'),
  ('Tirate posteriori dec. Laterale - panca 30°', 'cVvGdx4yaY4', 'Spalla Posteriore'),
  ('Vertical row cavo alto con vulken (panca 75°)', '2-TaBO_c3qM', 'Spalla Posteriore'),
  ('6 ways', '_robAY0mnDw', 'Addome'),
  ('AB Wheel', 'wpqdSP-Ry20', 'Addome'),
  ('Crunch al cavo alto', 'crtuPue2B8s', 'Addome'),
  ('Crunch su fitball', '6i4CIsGpZHc', 'Addome'),
  ('Hollow', 'BjEkVtOfSlA', 'Addome'),
  ('Plank', 'IzB9pBJcY0Q', 'Addome'),
  ('Plank con tocco alternato delle spalle', 'Bmn3-MBf0Yg', 'Addome'),
  ('Plank laterale', 'wCAyEOsd0NE', 'Addome'),
  ('Plank laterale al trx', 'S32_T_byo7g', 'Addome'),
  ('Plank laterale al trx + bosu', 'FJdMdpv9VGU', 'Addome'),
  ('Plank laterale con sovraccarico', 'mavcwB3VZjs', 'Addome'),
  ('Plank mani-gomiti', 'Arg5prTi8iI', 'Addome'),
  ('Plank su bosu', '_fUaEDr81cU', 'Addome'),
  ('Plank su fitball', 'X0cjr1by6Zg', 'Addome'),
  ('Reverse crunch', 'fJ3Q1kuBSEE', 'Addome'),
  ('Reverse crunch con fitball', 'IrZav-C34hs', 'Addome'),
  ('Reverse crunch alla sbarra', '52vwIiS2JuY', 'Addome'),
  ('Reverse crunch alla sbarra (full ROM)', 'FAZsJwSez8s', 'Addome'),
  ('Airplane', 'EuaGlo-mjnk', 'Stabilizzatori'),
  ('Aperture con elastico', 'uBSlgtl3Gsw', 'Stabilizzatori'),
  ('Bird dog', 'diYvakTNhnI', 'Stabilizzatori'),
  ('Bottom up con kett (dinamico)', 'tzEFjAJ62zY', 'Stabilizzatori'),
  ('Bottom up con kett (statica)', '0SdWnljWWQw', 'Stabilizzatori'),
  ('Bottom up con kett (su panca)', 'vkUE_KhX_ts', 'Stabilizzatori'),
  ('Circonduzioni anche', '7pjC1oEt0Q4', 'Stabilizzatori'),
  ('Circonduzioni con elastico/bastone', 'XEIwwuNTCRM', 'Stabilizzatori'),
  ('Cobra - gatto', 'FgPLm0i_fyE', 'Stabilizzatori'),
  ('Dead Bug con manubrio (dinamico)', 'tF8ibj-HUo0', 'Stabilizzatori'),
  ('Dead Bug con manubrio (statica)', 'ESt0imJF0vM', 'Stabilizzatori'),
  ('Extrarotazioni con elastico/al cavo', 'zJDjjB54D3I', 'Stabilizzatori'),
  ('Jumping jack', 'RFkkLbo9w5Q', 'Stabilizzatori'),
  ('Polpacci su rialzo', 'QjwrJOY6jVk', 'Stabilizzatori'),
  ('Pulldown singolo con elastico', 'g_el3w8UaRg', 'Dorsale'),
  ('Stacco monopodalico', '0r1WCTR4c-k', 'Femorali'),
  ('T Spine rotation', 'HVZ7CinHCiY', 'Stabilizzatori');
