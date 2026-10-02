-- Rate limits: the counter, its privileges, and the access-request caps.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(public.rate_limit_hit('test:key', 2, 3600), 'first hit allowed');
select ok(public.rate_limit_hit('test:key', 2, 3600), 'second hit allowed');
select ok(not public.rate_limit_hit('test:key', 2, 3600), 'third hit over the limit');

set local role anon;
select throws_ok($$ select public.rate_limit_hit('x', 1, 60) $$, '42501', null, 'anon cannot call the counter');
select throws_ok($$ select * from public.rate_limits $$, '42501', null, 'anon cannot read the counters');

-- Three requests from one email are accepted, the fourth within 24 hours is refused.
select lives_ok(
  $$ insert into public.access_requests (name, org, email) values ('A', 'Org', 'spam@test.local'),
     ('A', 'Org', 'spam@test.local'), ('A', 'Org', 'Spam@test.local') $$,
  'three requests per email accepted');
select throws_ok(
  $$ insert into public.access_requests (name, org, email) values ('A', 'Org', 'spam@test.local') $$,
  'PT429', null, 'fourth request from the same email refused');
reset role;

-- Thirty requests an hour overall, whatever the email.
insert into public.access_requests (name, org, email, created_at)
select 'B', 'Org', format('b%s@test.local', g), now() from generate_series(1, 27) g;
set local role anon;
select throws_ok(
  $$ insert into public.access_requests (name, org, email) values ('C', 'Org', 'c@test.local') $$,
  'PT429', null, 'global hourly cap');

select * from finish();
rollback;
