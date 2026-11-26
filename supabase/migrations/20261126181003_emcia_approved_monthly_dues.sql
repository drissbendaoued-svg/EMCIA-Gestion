-- Operational arrears need the approved monthly charge, without the settlement's private details.
create or replace function public.emcia_cash_snapshot_v1(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_payload jsonb;
  v_revision bigint;
  v_dues jsonb;
begin
  select role into v_role from public.profiles where user_id=auth.uid() and active=true;
  if v_role is null or v_role not in ('director','accountant','secretary_morning','secretary_evening')
     or p_id is distinct from 'emcia-main' then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  select payload,revision into v_payload,v_revision from public.emcia_financial_state_v2 where id=p_id;
  if not found then raise exception 'State missing' using errcode='22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a->'id', 'pid', a->'pid', 'sid', a->'sid', 'gid', a->'gid', 'month', a->'month',
    'approvedDue', a->'approvedDue', 'updatedAt', a->'updatedAt'
  ) order by position), '[]'::jsonb) into v_dues
  from jsonb_array_elements(
    case when jsonb_typeof(v_payload->'adj')='array' then v_payload->'adj' else '[]'::jsonb end
  ) with ordinality as adjustment(a, position)
  where jsonb_typeof(a->'approvedDue')='number';

  return jsonb_build_object(
    'financial_revision', v_revision,
    'x', coalesce(v_payload->'x', '[]'::jsonb),
    'oi', coalesce(v_payload->'oi', '[]'::jsonb),
    'monthly_adjustment_dues', v_dues
  );
end;
$function$;
