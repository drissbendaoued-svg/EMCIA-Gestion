-- Invoker functions preserve the existing RLS and table grants.
create or replace function public.emcia_load_state_v2(p_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object(
  'operational',(select to_jsonb(s) from public.emcia_operational_state_v2 s where s.id=p_id),
  'financial',(select to_jsonb(s) from public.emcia_financial_state_v2 s where s.id=p_id)
 );
$$;
create or replace function public.emcia_save_state_v2(
 p_id text, p_operational_revision bigint, p_operational jsonb,
 p_financial_revision bigint default null, p_financial jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 v_uid uuid := auth.uid(); v_role text; v_op bigint; v_fin bigint;
begin
 select role into v_role from public.profiles where user_id=v_uid and active;
 if v_uid is null or v_role is null or v_role not in ('director','accountant','secretary_morning','secretary_evening') then
  raise exception 'Active EMCIA account required' using errcode='42501';
 end if;
 if jsonb_typeof(p_operational) is distinct from 'object' then
  raise exception 'Invalid operational payload' using errcode='22023';
 end if;
 if p_financial is not null and (v_role not in ('director','accountant') or p_financial_revision is null) then
  raise exception 'Financial write not permitted' using errcode='42501';
 end if;
 if p_financial is not null and jsonb_typeof(p_financial) is distinct from 'object' then
  raise exception 'Invalid financial payload' using errcode='22023';
 end if;
 select revision into v_op from public.emcia_operational_state_v2 where id=p_id for update;
 if not found or v_op is distinct from p_operational_revision then
  raise exception 'Operational revision conflict; reload before saving' using errcode='40001';
 end if;
 if p_financial is not null then
  select revision into v_fin from public.emcia_financial_state_v2 where id=p_id for update;
  if not found or v_fin is distinct from p_financial_revision then
   raise exception 'Financial revision conflict; no changes saved' using errcode='40001';
  end if;
 end if;
 update public.emcia_operational_state_v2 set payload=p_operational,revision=revision+1,updated_by=v_uid,updated_at=transaction_timestamp() where id=p_id returning revision into v_op;
 if not found then raise exception 'Operational write denied' using errcode='42501'; end if;
 if p_financial is not null then
  update public.emcia_financial_state_v2 set payload=p_financial,revision=revision+1,updated_by=v_uid,updated_at=transaction_timestamp() where id=p_id returning revision into v_fin;
  if not found then raise exception 'Financial write denied' using errcode='42501'; end if;
 end if;
 return jsonb_build_object('operational_revision',v_op,'financial_revision',v_fin);
end;
$$;
revoke all on function public.emcia_load_state_v2(text) from public,anon;
revoke all on function public.emcia_save_state_v2(text,bigint,jsonb,bigint,jsonb) from public,anon;
grant execute on function public.emcia_load_state_v2(text) to authenticated;
grant execute on function public.emcia_save_state_v2(text,bigint,jsonb,bigint,jsonb) to authenticated;
