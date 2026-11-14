-- All changes, including synthetic rows, are rolled back. No production row is modified.
begin;
do $$ begin perform set_config('request.jwt.claim.sub',(select user_id::text from public.profiles where active and role='director' limit 1),true); end $$;
insert into public.emcia_operational_state_v2(id,payload,revision) values('emcia-atomic-transaction-test','{"test":true}',0);
insert into public.emcia_financial_state_v2(id,payload,revision) values('emcia-atomic-transaction-test','{"test":true}',0);
set local role authenticated;
do $$
declare v jsonb;
begin
 v:=public.emcia_save_state_v2('emcia-atomic-transaction-test',0,'{"test":"saved"}',0,'{"test":"saved"}');
 if v->>'operational_revision'<>'1' or v->>'financial_revision'<>'1' then raise exception 'Revision increment failed'; end if;
 begin
  perform public.emcia_save_state_v2('emcia-atomic-transaction-test',1,'{"test":"must-not-save"}',0,'{}');
  raise exception 'Conflict was accepted';
 exception when serialization_failure then null; end;
 if (select revision from public.emcia_operational_state_v2 where id='emcia-atomic-transaction-test')<>1 or (select payload->>'test' from public.emcia_operational_state_v2 where id='emcia-atomic-transaction-test')<>'saved' then raise exception 'Partial save occurred'; end if;
 v:=public.emcia_load_state_v2('emcia-atomic-transaction-test');
 if v->'financial' is null or v->'financial'='null' then raise exception 'Director finance missing'; end if;
end $$;
rollback;
