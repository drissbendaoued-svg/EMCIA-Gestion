create table public.emcia_daily_payment_reminders (
 reminder_date date not null,
 student_id text not null check (length(student_id) between 1 and 120),
 actor_id uuid references public.profiles(user_id) on delete set null,
 actor_name text not null,
 created_at timestamptz not null default now(),
 primary key (reminder_date,student_id)
);
alter table public.emcia_daily_payment_reminders enable row level security;
revoke all on public.emcia_daily_payment_reminders from public,anon,authenticated;
grant select on public.emcia_daily_payment_reminders to authenticated;
grant insert(reminder_date,student_id,actor_id,actor_name) on public.emcia_daily_payment_reminders to authenticated;
create policy daily_reminders_read on public.emcia_daily_payment_reminders for select to authenticated
 using (emcia_private."current_role"() in ('director','accountant','secretary_morning','secretary_evening'));
create policy daily_reminders_insert on public.emcia_daily_payment_reminders for insert to authenticated
 with check (
 emcia_private."current_role"() in ('director','accountant','secretary_morning','secretary_evening')
 and actor_id=(select auth.uid())
 and actor_name=(select coalesce(display_name,role) from public.profiles where user_id=(select auth.uid()) and active)
 and reminder_date=(now() at time zone 'Africa/Casablanca')::date
 );
create function public.emcia_mark_daily_payment_reminder(p_student_id text,p_date date)
returns public.emcia_daily_payment_reminders language plpgsql security invoker set search_path='' as $$
declare v_name text; v_row public.emcia_daily_payment_reminders;
begin
 select coalesce(display_name,role) into v_name from public.profiles where user_id=auth.uid() and active
 and role in ('director','accountant','secretary_morning','secretary_evening');
 if v_name is null then raise exception 'Active staff account required' using errcode='42501';end if;
 if p_date is distinct from (now() at time zone 'Africa/Casablanca')::date then raise exception 'Only today can be marked' using errcode='22023';end if;
 if not exists(select 1 from public.emcia_operational_state_v2 state cross join lateral jsonb_array_elements(coalesce(state.payload->'s','[]')) student where state.id='emcia-main' and student->>'id'=p_student_id) then raise exception 'Unknown student' using errcode='22023';end if;
 insert into public.emcia_daily_payment_reminders(reminder_date,student_id,actor_id,actor_name)
 values(p_date,p_student_id,auth.uid(),v_name) on conflict do nothing;
 select * into v_row from public.emcia_daily_payment_reminders where reminder_date=p_date and student_id=p_student_id;
 return v_row;
end $$;
revoke all on function public.emcia_mark_daily_payment_reminder(text,date) from public,anon;
grant execute on function public.emcia_mark_daily_payment_reminder(text,date) to authenticated;
