-- STAGING ONLY: do not apply before backup, permission review and role tests.
-- Allows authorized EMCIA staff to mutate ONLY expense (x) and other-income (oi)
-- records in the financial JSON document, using optimistic revision checks.
-- Other financial keys remain unchanged.
create or replace function public.emcia_save_cash_entry_v1(
 p_id text, p_expected_revision bigint, p_collection text,
 p_action text, p_record jsonb, p_record_id text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
 v_role text; v_uid uuid := auth.uid(); v_payload jsonb; v_rows jsonb;
 v_revision bigint; v_match int; v_updated jsonb;
begin
 select role into v_role from public.profiles
 where user_id=v_uid and active=true;
 if v_role not in ('director','accountant','secretary_morning','secretary_evening')
    or v_uid is null then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 if p_collection not in ('x','oi') or p_action not in ('insert','update','delete') then
   raise exception 'Invalid action' using errcode='22023';
 end if;
 if p_record_id is null or length(p_record_id) < 1 or length(p_record_id)>128 then
   raise exception 'Invalid record id' using errcode='22023';
 end if;
 if p_action <> 'delete' and
    (jsonb_typeof(p_record) <> 'object' or p_record->>'id' is distinct from p_record_id
     or jsonb_typeof(p_record->'a') <> 'number'
     or (p_record->>'a')::numeric <= 0
     or coalesce(p_record->>'date','') !~ '^\\d{4}-\\d{2}-\\d{2}$') then
   raise exception 'Invalid financial entry' using errcode='22023';
 end if;
 select payload,revision into v_payload,v_revision
 from public.emcia_financial_state_v2 where id=p_id for update;
 if not found then raise exception 'State missing' using errcode='22023'; end if;
 if v_revision is distinct from p_expected_revision then
   raise exception 'Revision conflict' using errcode='40001';
 end if;
 v_rows:=coalesce(v_payload->p_collection,'[]'::jsonb);
 if jsonb_typeof(v_rows)<>'array' then raise exception 'Invalid collection' using errcode='22023'; end if;
 select count(*) into v_match from jsonb_array_elements(v_rows) e where e->>'id'=p_record_id;
 if (p_action='insert' and v_match<>0) or
    (p_action<>'insert' and v_match<>1) then
   raise exception 'Record conflict' using errcode='40001';
 end if;
 if p_action='insert' then v_rows:=v_rows||jsonb_build_array(p_record);
 elsif p_action='update' then
   select coalesce(jsonb_agg(case when e->>'id'=p_record_id then p_record else e end order by ord),'[]'::jsonb)
   into v_rows from jsonb_array_elements(v_rows) with ordinality as t(e,ord);
 else
   select coalesce(jsonb_agg(e order by ord),'[]'::jsonb) into v_rows
   from jsonb_array_elements(v_rows) with ordinality as t(e,ord)
   where e->>'id' is distinct from p_record_id;
 end if;
 v_updated:=jsonb_set(v_payload,array[p_collection],v_rows,true);
 update public.emcia_financial_state_v2
 set payload=v_updated,revision=revision+1,updated_by=v_uid,updated_at=transaction_timestamp()
 where id=p_id returning revision into v_revision;
 return jsonb_build_object('financial_revision',v_revision,'record_id',p_record_id);
end; $$;
revoke all on function public.emcia_save_cash_entry_v1(text,bigint,text,text,jsonb,text) from public, anon;
grant execute on function public.emcia_save_cash_entry_v1(text,bigint,text,text,jsonb,text) to authenticated;
