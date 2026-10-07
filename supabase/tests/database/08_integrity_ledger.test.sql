-- Integrity ledger: hash chain, idempotent appends, append-only, public read, no personal data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e2', 'officer8@test.local', '{"full_name": "Ledger Officer"}');
update public.profiles set role = 'officer' where user_id = '00000000-0000-0000-0000-0000000000e2';

-- Recomputes every hash and link; returns the ids of entries that do not check out.
create temporary view broken_links as
select e.id
from (
  select id, payload_text, payload_hash, prev_hash, entry_hash,
         lag(entry_hash) over (order by id) as expected_prev,
         row_number() over (order by id) as n
  from public.ledger_entries
) e
where e.payload_hash <> encode(sha256(convert_to(e.payload_text, 'UTF8')), 'hex')
   or e.entry_hash <> encode(sha256(convert_to(e.prev_hash || '|' || e.id::text || '|' || e.payload_hash, 'UTF8')), 'hex')
   or e.prev_hash <> coalesce(e.expected_prev, repeat('0', 64))
   or e.id <> e.n;

select is(
  (select count(*) from public.ledger_entries where kind = 'flag'),
  3::bigint, 'each seeded T1/T2 landfill flag is in the ledger');
select is(
  (select prev_hash from public.ledger_entries order by id limit 1),
  repeat('0', 64), 'the chain starts from a zero hash');
select is_empty('select id from broken_links', 'every hash and link checks out');

update public.scans set tier = tier where tier in ('T1', 'T2');
select is(
  (select count(*) from public.ledger_entries),
  3::bigint, 'rewriting a flag with the same values adds no entry');

update public.actions set status = 'confirmed'
where scan_id = (select id from public.scans where tier = 'T1' order by pass_date limit 1);
select is(
  (select count(*) from public.ledger_entries where kind = 'confirmation'),
  1::bigint, 'a confirmation result is recorded');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-0000000000e2", "role": "authenticated"}', true);
set local role authenticated;
insert into public.measures (id, site_id, kind, title, agency, capture_share, note)
values ('00000000-0000-0000-0000-00000000e801', (select id from public.sites where slug = 'deonar'),
        'gas_collection', 'Gas wells', 'BMC', 0.6, 'internal note: call the contractor');
update public.measures set note = 'edited note' where id = '00000000-0000-0000-0000-00000000e801';
update public.measures set status = 'in_progress', start_date = '2026-09-01'
where id = '00000000-0000-0000-0000-00000000e801';
insert into public.gas_meter_readings (site_id, measure_id, period_start, period_end, ch4_destroyed_t, meter_id, verified_by)
values ((select id from public.sites where slug = 'deonar'), '00000000-0000-0000-0000-00000000e801',
        '2026-09-01', '2026-09-30', 12.5, 'DN-1', 'A. Person');
reset role;

select is(
  (select count(*) from public.ledger_entries where kind = 'measure'),
  2::bigint, 'a measure is recorded when added and when its status changes, not when its note changes');
select is(
  (select count(*) from public.ledger_entries where kind = 'meter'),
  1::bigint, 'a metered reading is recorded');
select ok(
  not exists (select 1 from public.ledger_entries
              where payload_text like '%internal note%' or payload_text like '%A. Person%'
                 or payload_text like '%officer8%'),
  'notes, names and emails never enter the ledger');

select isnt(public.ledger_snapshot_scorecard('2026-09-15'), null, 'a month''s scorecard is frozen');
select is(public.ledger_snapshot_scorecard('2026-09-01'), null::bigint, 'once per month');
select is(
  (select (payload_text::jsonb -> 'sites' -> 0 ->> 'slug') from public.ledger_entries where kind = 'scorecard'),
  'bhalswa', 'the snapshot holds every site''s row');

select is_empty('select id from broken_links', 'the chain still checks out after every kind of entry');

select throws_ok(
  $$ update public.ledger_entries set payload_text = '{}' where id = 1 $$,
  '42501', null, 'entries cannot be edited, even by the database owner');
select throws_ok(
  $$ delete from public.ledger_entries where id = 1 $$,
  '42501', null, 'entries cannot be deleted');

set local role anon;
select isnt_empty('select id from public.ledger_entries', 'anyone can read the ledger');
select throws_ok(
  $$ select public.ledger_append('flag', 'x', '{}'::jsonb) $$,
  '42501', null, 'only the database itself appends');
reset role;

select * from finish();
rollback;
