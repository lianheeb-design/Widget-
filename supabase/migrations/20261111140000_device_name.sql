-- The computer's name (as set in Windows), so the developer can tell in the
-- dashboard which PC an installation runs on. Sent by app versions from 1.2.1
-- on; null for older ones. Updated on every check (a renamed PC shows its new
-- name).

alter table licensing.installations
  add column device_name text check (char_length(device_name) <= 64);

-- license_check gets the device name as an optional fifth argument.
drop function public.license_check(uuid, text, text, integer);

create function public.license_check(
  p_installation_id uuid,
  p_secret_hash text,
  p_app_version text,
  p_max_registrations_per_minute integer default 30,
  p_device_name text default null
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
  v_device text := left(nullif(btrim(p_device_name), ''), 64);
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
      (installation_id, secret_hash, app_version, device_name, last_seen, last_status_check)
    values (p_installation_id, p_secret_hash, v_version, v_device, now(), now())
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
         app_version = coalesce(v_version, i.app_version),
         device_name = coalesce(v_device, i.device_name)
   where i.id = v_row.id;

  return query select 'ok'::text, v_row.status, false;
end;
$$;

revoke all on function public.license_check(uuid, text, text, integer, text) from public;
revoke all on function public.license_check(uuid, text, text, integer, text) from anon, authenticated;
grant execute on function public.license_check(uuid, text, text, integer, text) to service_role;

-- The dashboard's views of an installation include the device name.
create or replace function licensing.installation_json(i licensing.installations) returns json
language sql
immutable
set search_path = ''
as $$
  select json_build_object(
    'installation_id', i.installation_id,
    'device_name', i.device_name,
    'status', i.status,
    'created_at', i.created_at,
    'last_seen', i.last_seen,
    'last_status_check', i.last_status_check,
    'blocked_at', i.blocked_at,
    'block_reason', i.block_reason,
    'app_version', i.app_version
  );
$$;

drop function public.admin_list_installations(text, text, integer, integer);

-- One page of installations, most recently seen first. `p_search` matches
-- (part of) the device name, the id, the version or the block reason.
create function public.admin_list_installations(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  installation_id uuid,
  device_name text,
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
    select i.installation_id, i.device_name, i.status, i.created_at, i.last_seen, i.last_status_check,
           i.blocked_at, i.block_reason, i.app_version,
           count(*) over () as total_count
      from licensing.installations i
     where (p_status is null or i.status = p_status)
       and (v_search is null
            or i.installation_id::text ilike v_pattern
            or i.device_name ilike v_pattern
            or i.app_version ilike v_pattern
            or i.block_reason ilike v_pattern)
     order by i.last_seen desc nulls last, i.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_list_installations(text, text, integer, integer) from public;
revoke all on function public.admin_list_installations(text, text, integer, integer) from anon;
grant execute on function public.admin_list_installations(text, text, integer, integer) to authenticated;
