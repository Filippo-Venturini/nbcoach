-- ============================================================
-- MIGRATION — Hardening di sicurezza
--   1. Blocca l'escalation di ruolo (un cliente NON può diventare pt)
--   2. Il trigger di signup forza sempre role='client' (ignora il metadata)
--   3. Rende privati i bucket con dati sensibili (foto e diete)
--   4. Percorso sicuro per reps_effettive scritte dal cliente (RPC)
-- Idempotente: può essere eseguita anche a schema già presente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Anti-escalation ruolo: solo un PT (o il service role / SQL admin,
--    dove auth.uid() è null) può cambiare profiles.role.
-- ------------------------------------------------------------
create or replace function prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    -- Se c'è un utente finale (auth.uid() non null) e non è PT => vietato
    if auth.uid() is not null and not is_pt() then
      raise exception 'Non sei autorizzato a modificare il ruolo utente';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_escalation on profiles;
create trigger profiles_prevent_role_escalation
  before update on profiles
  for each row execute procedure prevent_role_escalation();

-- ------------------------------------------------------------
-- 2. Signup: forza role='client' (il ruolo dal metadata è controllato
--    dall'utente e non va considerato affidabile). I PT si promuovono
--    manualmente via SQL/service role.
-- ------------------------------------------------------------
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
    'client'
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3. Bucket privati (le letture passeranno da signed URL)
-- ------------------------------------------------------------
update storage.buckets set public = false where id in ('diet-pdfs', 'progress-photos');

-- ------------------------------------------------------------
-- 4. RPC sicura per aggiornare SOLO reps_effettive.
--    Il cliente aggiorna le proprie schede; il PT qualsiasi. Nessun
--    altro campo modificabile dal cliente.
-- ------------------------------------------------------------
create or replace function set_reps_effettive(p_exercise_id uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select wp.client_id into owner
  from workout_exercises we
  join workout_plans wp on wp.id = we.plan_id
  where we.id = p_exercise_id;

  if owner is null then
    raise exception 'Esercizio non trovato';
  end if;

  if owner <> auth.uid() and not is_pt() then
    raise exception 'Non autorizzato';
  end if;

  update workout_exercises
  set reps_effettive = p_value
  where id = p_exercise_id;
end;
$$;

revoke all on function set_reps_effettive(uuid, text) from public;
grant execute on function set_reps_effettive(uuid, text) to authenticated;
