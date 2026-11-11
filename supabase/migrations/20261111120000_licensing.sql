-- Remote access management for the island: every installation registers with
-- a random id, and the developer can block or unblock it from the admin
-- dashboard. See docs/licensing/README.md for the whole design.
--
-- Security model:
-- - The tables live in the private schema `licensing`, which the Data API
--   (PostgREST) does not expose. Nobody reaches them directly.
-- - The only way in are the functions in `public` below, all `security definer`
--   with an empty search_path:
--   - `license_check` is executable by `service_role` only, i.e. by the
--     `license` Edge Function, never by the desktop app itself.
--   - `admin_*` are executable by signed-in users, and every one of them checks
--     that the caller is in `licensing.admins` before doing anything.
-- - Status changes write an append-only audit trail (`installation_events`).

create schema if not exists licensing;
revoke all on schema licensing from public;
revoke all on schema licensing from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table licensing.installations (
  id bigint generated always as identity primary key,
  installation_id uuid not null unique,
  -- SHA-256 (hex) of the installation's secret. The secret itself never
  -- leaves the installation except over TLS to the Edge Function.
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'BLOCKED')),
  created_at timestamptz not null default now(),
  last_seen timestamptz,
  last_status_check timestamptz,
  blocked_at timestamptz,
  block_reason text check (char_length(block_reason) <= 500),
  app_version text check (char_length(app_version) <= 32),
  constraint installations_blocked_at_matches_status
    check ((status = 'BLOCKED') = (blocked_at is not null))
);

create index installations_created_at_idx on licensing.installations (created_at desc);
create index installations_last_seen_idx on licensing.installations (last_seen desc nulls last);
create index installations_status_idx on licensing.installations (status);

create table licensing.installation_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null
    references licensing.installations (installation_id) on delete cascade,
  event text not null check (event in ('REGISTERED', 'BLOCKED', 'UNBLOCKED')),
  reason text check (char_length(reason) <= 500),
  -- The admin who made the change (`auth.users.id`); null for registrations.
  actor_id uuid,
  -- Copied at the time of the change, so the trail stays readable even if the
  -- admin account is deleted later.
  actor_email text,
  created_at timestamptz not null default now()
);

create index installation_events_installation_idx
  on licensing.installation_events (installation_id, created_at desc);

create table licensing.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

-- Row level security on, with no policies: even a role that somehow got a
-- grant would see nothing. The security definer functions run as the owner.
alter table licensing.installations enable row level security;
alter table licensing.installation_events enable row level security;
alter table licensing.admins enable row level security;

revoke all on all tables in schema licensing from public;
revoke all on all tables in schema licensing from anon, authenticated, service_role;
revoke all on all sequences in schema licensing from public;
revoke all on all sequences in schema licensing from anon, authenticated, service_role;

-- The audit trail is append-only. Deleting an installation (a data deletion
-- request) still removes its events through the cascade.
create function licensing.forbid_event_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'installation events are append-only' using errcode = '42501';
end;
$$;

create trigger installation_events_append_only
  before update on licensing.installation_events
  for each row execute function licensing.forbid_event_update();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function licensing.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from licensing.admins a where a.user_id = (select auth.uid())
  );
$$;

-- Returns the caller's user id, or raises `insufficient_privilege`.
create function licensing.require_admin() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from licensing.admins a where a.user_id = v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function licensing.installation_json(i licensing.installations) returns json
language sql
immutable
set search_path = ''
as $$
  select json_build_object(
    'installation_id', i.installation_id,
    'status', i.status,
    'created_at', i.created_at,
    'last_seen', i.last_seen,
    'last_status_check', i.last_status_check,
    'blocked_at', i.blocked_at,
    'block_reason', i.block_reason,
    'app_version', i.app_version
  );
$$;

revoke all on function licensing.forbid_event_update() from public;
revoke all on function licensing.is_admin() from public;
revoke all on function licensing.require_admin() from public;
revoke all on function licensing.installation_json(licensing.installations) from public;

-- ---------------------------------------------------------------------------
-- Desktop app: registration and status check (via the Edge Function)
-- ---------------------------------------------------------------------------

-- Registers an unknown installation (status ACTIVE) or verifies a known one,
-- records the contact and returns its status.
--
-- outcome: 'ok' | 'invalid_credentials' | 'rate_limited'
create function public.license_check(
  p_installation_id uuid,
  p_secret_hash text,
  p_app_version text,
  p_max_registrations_per_minute integer default 30
)
returns table (outcome text, status text, registered boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row licensing.installations%rowtype;
  v_version text := nullif(btrim(p_app_version), '');
begin
  if p_installation_id is null or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if v_version is not null and char_length(v_version) > 32 then
    raise exception 'invalid app version' using errcode = '22023';
  end if;

  select * into v_row
    from licensing.installations i
   where i.installation_id = p_installation_id
     for update;

  if not found then
    -- Cheap protection against registration floods with random ids.
    if (select count(*)
          from licensing.installations i
         where i.created_at > now() - interval '1 minute') >= greatest(p_max_registrations_per_minute, 1) then
      return query select 'rate_limited'::text, null::text, false;
      return;
    end if;

    insert into licensing.installations as i
      (installation_id, secret_hash, app_version, last_seen, last_status_check)
    values (p_installation_id, p_secret_hash, v_version, now(), now())
    on conflict (installation_id) do nothing
    returning * into v_row;

    if found then
      insert into licensing.installation_events (installation_id, event)
      values (p_installation_id, 'REGISTERED');
      return query select 'ok'::text, v_row.status, true;
      return;
    end if;

    -- Registered by a parallel request a moment ago: verify against that one.
    select * into v_row
      from licensing.installations i
     where i.installation_id = p_installation_id
       for update;
  end if;

  if v_row.secret_hash <> p_secret_hash then
    return query select 'invalid_credentials'::text, null::text, false;
    return;
  end if;

  update licensing.installations i
     set last_seen = now(),
         last_status_check = now(),
         app_version = coalesce(v_version, i.app_version)
   where i.id = v_row.id;

  return query select 'ok'::text, v_row.status, false;
end;
$$;

revoke all on function public.license_check(uuid, text, text, integer) from public;
revoke all on function public.license_check(uuid, text, text, integer) from anon, authenticated;
grant execute on function public.license_check(uuid, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Admin dashboard (signed-in admins only)
-- ---------------------------------------------------------------------------

create function public.admin_is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select licensing.is_admin();
$$;

-- Counts for the overview. `online`: last contact within p_online_minutes;
-- `new`: registered within p_new_days.
create function public.admin_stats(
  p_online_minutes integer default 30,
  p_new_days integer default 7
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform licensing.require_admin();
  if p_online_minutes not between 1 and 10080 or p_new_days not between 1 and 365 then
    raise exception 'invalid range' using errcode = '22023';
  end if;

  return (
    select json_build_object(
      'total', count(*),
      'active', count(*) filter (where i.status = 'ACTIVE'),
      'blocked', count(*) filter (where i.status = 'BLOCKED'),
      'online', count(*) filter (where i.last_seen > now() - make_interval(mins => p_online_minutes)),
      'new', count(*) filter (where i.created_at > now() - make_interval(days => p_new_days))
    )
    from licensing.installations i
  );
end;
$$;

-- One page of installations, most recently seen first. `p_search` matches
-- (part of) the id, the version or the block reason.
create function public.admin_list_installations(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  installation_id uuid,
  status text,
  created_at timestamptz,
  last_seen timestamptz,
  last_status_check timestamptz,
  blocked_at timestamptz,
  block_reason text,
  app_version text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
begin
  perform licensing.require_admin();
  if p_status is not null and p_status not in ('ACTIVE', 'BLOCKED') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 100 then
    raise exception 'search too long' using errcode = '22023';
  end if;

  -- LIKE wildcards in the search are taken literally.
  v_pattern := '%' || replace(replace(replace(coalesce(v_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select i.installation_id, i.status, i.created_at, i.last_seen, i.last_status_check,
           i.blocked_at, i.block_reason, i.app_version,
           count(*) over () as total_count
      from licensing.installations i
     where (p_status is null or i.status = p_status)
       and (v_search is null
            or i.installation_id::text ilike v_pattern
            or i.app_version ilike v_pattern
            or i.block_reason ilike v_pattern)
     order by i.last_seen desc nulls last, i.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- One installation with its full history (newest first).
create function public.admin_get_installation(p_installation_id uuid) returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row licensing.installations%rowtype;
begin
  perform licensing.require_admin();

  select * into v_row from licensing.installations i where i.installation_id = p_installation_id;
  if not found then
    raise exception 'installation not found' using errcode = 'P0002';
  end if;

  return json_build_object(
    'installation', licensing.installation_json(v_row),
    'events', coalesce((
      select json_agg(json_build_object(
               'id', e.id,
               'event', e.event,
               'reason', e.reason,
               'actor_email', e.actor_email,
               'created_at', e.created_at
             ) order by e.created_at desc, e.id desc)
        from licensing.installation_events e
       where e.installation_id = p_installation_id
    ), '[]'::json)
  );
end;
$$;

-- Blocks (p_status 'BLOCKED') or unblocks ('ACTIVE') an installation and
-- records it in the audit trail. Setting the current status again changes
-- nothing (`changed`: false), so a double click doesn't log twice.
create function public.admin_set_installation_status(
  p_installation_id uuid,
  p_status text,
  p_reason text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := licensing.require_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row licensing.installations%rowtype;
  v_email text;
begin
  if p_status is null or p_status not in ('ACTIVE', 'BLOCKED') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;

  select * into v_row
    from licensing.installations i
   where i.installation_id = p_installation_id
     for update;
  if not found then
    raise exception 'installation not found' using errcode = 'P0002';
  end if;

  if v_row.status = p_status then
    return json_build_object('changed', false, 'installation', licensing.installation_json(v_row));
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  update licensing.installations i
     set status = p_status,
         blocked_at = case when p_status = 'BLOCKED' then now() end,
         block_reason = case when p_status = 'BLOCKED' then v_reason end
   where i.id = v_row.id
  returning * into v_row;

  insert into licensing.installation_events (installation_id, event, reason, actor_id, actor_email)
  values (
    p_installation_id,
    case when p_status = 'BLOCKED' then 'BLOCKED' else 'UNBLOCKED' end,
    v_reason,
    v_uid,
    v_email
  );

  return json_build_object('changed', true, 'installation', licensing.installation_json(v_row));
end;
$$;

revoke all on function public.admin_is_admin() from public;
revoke all on function public.admin_stats(integer, integer) from public;
revoke all on function public.admin_list_installations(text, text, integer, integer) from public;
revoke all on function public.admin_get_installation(uuid) from public;
revoke all on function public.admin_set_installation_status(uuid, text, text) from public;

revoke all on function public.admin_is_admin() from anon;
revoke all on function public.admin_stats(integer, integer) from anon;
revoke all on function public.admin_list_installations(text, text, integer, integer) from anon;
revoke all on function public.admin_get_installation(uuid) from anon;
revoke all on function public.admin_set_installation_status(uuid, text, text) from anon;

grant execute on function public.admin_is_admin() to authenticated;
grant execute on function public.admin_stats(integer, integer) to authenticated;
grant execute on function public.admin_list_installations(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_installation(uuid) to authenticated;
grant execute on function public.admin_set_installation_status(uuid, text, text) to authenticated;
