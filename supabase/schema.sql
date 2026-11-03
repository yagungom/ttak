-- ════════════════════════════════════════════════════════════════
--  딱! 홈런 온라인 랭킹 스키마 (Supabase)
--  사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run
--  여러 번 실행해도 안전합니다(idempotent).
--
--  ✅ 와르르 캐치·뻥! 승부차기와 같은 Supabase 프로젝트에 그대로 실행하면 됩니다.
--     딱! 홈런 기록은 따로 저장(private.hr_*)되고, 다른 게임 기록은 건드리지 않습니다.
--     공용 부품(금지어·IP 해시·팀 이름 검사)은 다른 게임과 같은 내용이라 같이 써요.
--
--  랭킹 두 가지
--   · 🏏 비거리   = 한 경기에서 가장 멀리 친 공(m)
--   · 📏 총 비거리 = 한 경기 동안 친 거리 합계(m) — 1·2·3회 경기를 따로 줄 세움
--  나누는 기준: 선수 종류(어른/어린이) × 방식(카메라/폰) × 기간(오늘/이번 주/이번 달, 한국시간)
--  한 판에 사람 선수마다 기록 1개 (둘이 하면 2개). 컴퓨터 선수는 등록 안 함
--
--  보안 설계 (다른 게임과 같음)
--   · 테이블은 모두 private 스키마 → REST API 로 직접 읽기/쓰기 불가, RLS + 권한 회수
--   · 브라우저는 함수 3개만 호출: hr_start_session / hr_submit_score / hr_get_leaderboard
--   · 점수는 서버가 발급한 1회용 세션으로만 등록, 서버 시계로 경기 시간 검증
--   · 친 공 하나하나의 거리 목록을 받아 서버가 합계·최고·홈런 수를 다시 계산해서 비교
--   · 팀 이름·선수 이름 규칙·욕설 필터, IP 기준 요청 제한. IP 는 '날짜별 솔트 해시'로만, 2일만 보관
-- ════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema private from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema private from authenticated'; end if;
end $$;

-- ── 비밀 솔트 (IP 해시용, 외부 노출 없음) ──
create table if not exists private.app_secret (
  id   int primary key default 1 check (id = 1),
  salt text not null
);
insert into private.app_secret (id, salt)
values (1, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- ── 금지어 (팀 이름) — 소문자·공백/기호 제거 후 부분일치로 검사 ──
create table if not exists private.banned_words (word text primary key);
insert into private.banned_words (word) values
  ('시발'),('씨발'),('씨빨'),('시빨'),('씨바'),('ㅅㅂ'),('ㅆㅂ'),('ㅅ1ㅂ'),('병신'),('븅신'),('빙신'),('ㅂㅅ'),('개새'),('개색'),('개세'),('새끼'),('섀끼'),('ㅅㄲ'),
  ('좆'),('존나'),('졸라'),('ㅈㄴ'),('지랄'),('ㅈㄹ'),('미친'),('ㅁㅊ'),('엠창'),('니애미'),('느금'),('염병'),('썅'),('쌍년'),('창녀'),('걸레'),('보지'),('자지'),('섹스'),('야동'),
  ('일베'),('메갈'),('한남'),('김치녀'),('틀딱'),('장애인새'),('찐따'),('애미'),('애비'),
  ('fuck'),('shit'),('bitch'),('sex'),('porn'),('dick'),('pussy'),('nigger'),('nigga'),('slut'),('whore'),
  ('admin'),('관리자'),('운영자'),('운영진')
on conflict do nothing;


-- ── 경기 세션 (선수 1명 × 1판 = 1세션, 1회만 등록) ──
create table if not exists private.hr_sessions (
  id           uuid primary key default gen_random_uuid(),
  mode         text not null check (mode in ('adult', 'kid')),
  input        text not null default 'camera' check (input in ('camera', 'touch')),
  innings      int  not null check (innings between 1 and 3),
  team_name    text not null,
  player_name  text not null,
  ip_hash      text not null,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists hr_sessions_ip_time_idx on private.hr_sessions (ip_hash, started_at desc);
create index if not exists hr_sessions_time_idx on private.hr_sessions (started_at);

-- ── 기록 ──
create table if not exists private.hr_scores (
  id           bigint generated always as identity primary key,
  mode         text not null check (mode in ('adult', 'kid')),
  input        text not null default 'camera' check (input in ('camera', 'touch')),
  innings      int  not null check (innings between 1 and 3),
  team_name    text not null check (char_length(team_name) between 2 and 12),
  player_name  text not null check (char_length(player_name) between 1 and 6),
  total        int  not null check (total between 0 and 100000),
  best         int  not null check (best between 0 and 200),
  hits         int  not null check (hits between 0 and 1000),
  homers       int  not null check (homers between 0 and 1000),
  hits_log     text not null,
  created_at   timestamptz not null default now(),
  hidden       boolean not null default false     -- 관리자가 부적절한 기록을 숨길 때
);
create index if not exists hr_scores_total_idx on private.hr_scores (mode, input, innings, created_at desc, total desc);
create index if not exists hr_scores_best_idx  on private.hr_scores (mode, input, created_at desc, best desc);

alter table private.app_secret   enable row level security;
alter table private.banned_words enable row level security;
alter table private.hr_sessions  enable row level security;
alter table private.hr_scores    enable row level security;
revoke all on all tables in schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on all tables in schema private from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on all tables in schema private from authenticated'; end if;
end $$;


-- ════════════════ 공용 내부 함수 (와르르 캐치와 같은 내용) ════════════════

-- 막대그래프 구간 폭 (js/util.js niceStep 과 같은 규칙)
create or replace function private.nice_step(raw numeric)
returns int language plpgsql immutable set search_path = '' as $$
declare p numeric; f numeric; m numeric;
begin
  if raw is null or raw <= 1 then return 1; end if;
  p := power(10::numeric, floor(log(10::numeric, raw)));
  f := raw / p;
  m := case when f <= 1 then 1 when f <= 2 then 2 when f <= 2.5 then 2.5 when f <= 5 then 5 else 10 end;
  return ceil(m * p)::int;
end $$;

-- 요청 IP → 날짜별 솔트 해시 (원본 IP 는 저장하지 않음)
create or replace function private.client_ip_hash()
returns text language plpgsql stable security definer set search_path = '' as $$
declare h json; ip text; s text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;
  ip := coalesce(
    nullif(h ->> 'cf-connecting-ip', ''),
    nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''),
    nullif(h ->> 'x-real-ip', ''),
    'unknown');
  select a.salt into s from private.app_secret a where a.id = 1;
  return encode(extensions.digest(ip || '|' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || '|' || s, 'sha256'), 'hex');
end $$;

-- 팀 이름 검사 (js/nickname.js 와 같은 규칙). 통과하면 정규화된 이름을 돌려줌
create or replace function private.check_team(p text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare n text; k text;
begin
  n := btrim(regexp_replace(normalize(coalesce(p, ''), NFC), '\s+', ' ', 'g'));
  if char_length(n) < 2 or char_length(n) > 12 then raise exception 'bad_name_length' using errcode = '22023'; end if;
  if n !~ '^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _♥★-]+$' then raise exception 'bad_name_chars' using errcode = '22023'; end if;
  k := lower(regexp_replace(n, '[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]', '', 'g'));
  if k ~ '[0-9]{7,}' then raise exception 'bad_name_digits' using errcode = '22023'; end if;
  if exists (select 1 from private.banned_words w where position(w.word in k) > 0) then
    raise exception 'banned_name' using errcode = '22023';
  end if;
  return n;
end $$;

-- 한국시간 기준 기간 시작 (주간은 월요일 시작)
create or replace function private.period_from(p_period text)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if p_period not in ('day', 'week', 'month') then raise exception 'bad_period' using errcode = '22023'; end if;
  return date_trunc(p_period, now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
end $$;


-- 선수 이름 검사 (js/nickname.js validatePlayer 와 같은 규칙): 1~6자, 팀 이름과 같은 글자·금지어 규칙
create or replace function private.hr_check_player(p text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare n text; k text;
begin
  n := btrim(regexp_replace(normalize(coalesce(p, ''), NFC), '\s+', ' ', 'g'));
  if char_length(n) < 1 or char_length(n) > 6 then raise exception 'bad_player_length' using errcode = '22023'; end if;
  if n !~ '^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _♥★-]+$' then raise exception 'bad_player_chars' using errcode = '22023'; end if;
  k := lower(regexp_replace(n, '[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]', '', 'g'));
  if exists (select 1 from private.banned_words w where position(w.word in k) > 0) then
    raise exception 'banned_name' using errcode = '22023';
  end if;
  return n;
end $$;

-- ════════════════ 딱! 홈런 공개 함수 (브라우저가 호출) ════════════════

-- 1) 경기 시작: 사람 선수마다 1회용 세션 발급
create or replace function public.hr_start_session(p_mode text, p_team text, p_player text, p_input text default 'camera', p_innings int default 2)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_hash text; v_team text; v_player text; v_id uuid; v_cnt int;
begin
  if p_mode is null or p_mode not in ('adult', 'kid') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_input is null or p_input not in ('camera', 'touch') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_innings is null or p_innings not between 1 and 3 then raise exception 'bad_mode' using errcode = '22023'; end if;
  v_team := private.check_team(p_team);
  v_player := private.hr_check_player(p_player);
  v_hash := private.client_ip_hash();

  select count(*) into v_cnt from private.hr_sessions
   where ip_hash = v_hash and started_at > now() - interval '1 minute';
  if v_cnt >= 12 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  select count(*) into v_cnt from private.hr_sessions
   where ip_hash = v_hash and started_at > now() - interval '1 hour';
  if v_cnt >= 240 then raise exception 'rate_limited' using errcode = 'P0001'; end if;

  insert into private.hr_sessions (mode, input, innings, team_name, player_name, ip_hash)
  values (p_mode, p_input, p_innings, v_team, v_player, v_hash)
  returning id into v_id;

  if random() < 0.05 then
    delete from private.hr_sessions where started_at < now() - interval '2 days';
  end if;
  return v_id;
end $$;

-- 2) 기록 등록: 세션당 1회. 친 공 거리 목록(p_log, 예: '87,102,45')으로 서버가 다시 계산 (js/config.js 와 같은 숫자)
--    · 공 하나 거리 2~145m (게임에서 나올 수 있는 최대 약 135m)
--    · 홈런은 파울라인 쪽 담장(92m)보다 멀리 간 공만 될 수 있음
--    · 시간: 친 공 하나에 최소 3.5초, 스트라이크 하나에 최소 2초 (한 회 = 스트라이크 9개)
create or replace function public.hr_submit_score(p_session uuid, p_total int, p_best int, p_homers int, p_log text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  s record; v_elapsed_ms bigint; v_sum int := 0; v_max int := 0; v_hits int := 0; v_far int := 0; d int; part text;
  v_from timestamptz; v_brank int; v_btotal int; v_trank int; v_ttotal int;
begin
  -- 세션 소모 (실패해도 다시 쓸 수 없음 → 숫자 바꿔가며 재시도 불가)
  update private.hr_sessions
     set submitted_at = now()
   where id = p_session and submitted_at is null and started_at > now() - interval '24 hours'
  returning mode, input, innings, team_name, player_name, started_at into s;
  if not found then return json_build_object('ok', false, 'reason', 'invalid_session'); end if;

  if p_total is null or p_best is null or p_homers is null or p_log is null
     or char_length(p_log) > 4000 or p_log !~ '^([0-9]{1,3}(,[0-9]{1,3})*)?$' then
    return json_build_object('ok', false, 'reason', 'implausible');
  end if;

  if p_log <> '' then
    foreach part in array string_to_array(p_log, ',') loop
      d := part::int;
      if d < 2 or d > 145 then return json_build_object('ok', false, 'reason', 'implausible'); end if;
      v_sum := v_sum + d; v_max := greatest(v_max, d); v_hits := v_hits + 1;
      if d >= 92 then v_far := v_far + 1; end if;
    end loop;
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - s.started_at)) * 1000)::bigint;
  if p_total <> v_sum or p_best <> v_max or p_homers < 0 or p_homers > v_far
     or v_elapsed_ms < v_hits * 3500 + s.innings * 9 * 2000 then
    return json_build_object('ok', false, 'reason', 'implausible');
  end if;

  insert into private.hr_scores (mode, input, innings, team_name, player_name, total, best, hits, homers, hits_log)
  values (s.mode, s.input, s.innings, s.team_name, s.player_name, v_sum, v_max, v_hits, p_homers, p_log);

  v_from := private.period_from('day');
  select count(*) filter (where sc.best > v_max) + 1, count(*) into v_brank, v_btotal
    from private.hr_scores sc
   where sc.mode = s.mode and sc.input = s.input and sc.created_at >= v_from and not sc.hidden;
  select count(*) filter (where sc.total > v_sum) + 1, count(*) into v_trank, v_ttotal
    from private.hr_scores sc
   where sc.mode = s.mode and sc.input = s.input and sc.innings = s.innings and sc.created_at >= v_from and not sc.hidden;

  return json_build_object('ok', true, 'best_rank', v_brank, 'best_count', v_btotal, 'total_rank', v_trank, 'total_count', v_ttotal);
end $$;

-- 3) 랭킹: 종류(best 비거리 / total 총 비거리) × 선수 종류 × 방식 × 기간 (총 비거리는 회 수별) → TOP10 + 분포 + 내 순위
create or replace function public.hr_get_leaderboard(p_kind text, p_mode text, p_period text, p_score int default null, p_input text default 'camera', p_innings int default 2)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz; v_total int; v_max int; v_step int; v_top json; v_bins json; v_rank int;
begin
  if p_kind is null or p_kind not in ('best', 'total') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_mode is null or p_mode not in ('adult', 'kid') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_input is null or p_input not in ('camera', 'touch') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if p_innings is null or p_innings not between 1 and 3 then raise exception 'bad_mode' using errcode = '22023'; end if;
  v_from := private.period_from(p_period);

  -- 대상 기록 (종류에 따라 점수 = 최장 비거리 또는 총 비거리, 총 비거리는 같은 회 수만)
  select count(*), coalesce(max(case when p_kind = 'best' then sc.best else sc.total end), 0) into v_total, v_max
    from private.hr_scores sc
   where sc.mode = p_mode and sc.input = p_input and sc.created_at >= v_from and not sc.hidden
     and (p_kind = 'best' or sc.innings = p_innings);
  v_step := case when p_kind = 'best' then 10 else greatest(private.nice_step(greatest(v_max, 1) / 16.0), 10) end;

  select coalesce(json_agg(x order by x.rank), '[]'::json) into v_top from (
    select row_number() over (order by t.score desc, t.at asc) as rank, t.team, t.player, t.score, t.total, t.best, t.hits, t.homers, t.innings, t.at
      from (select sc.team_name as team, sc.player_name as player, case when p_kind = 'best' then sc.best else sc.total end as score,
                   sc.total, sc.best, sc.hits, sc.homers, sc.innings, sc.created_at as at
              from private.hr_scores sc
             where sc.mode = p_mode and sc.input = p_input and sc.created_at >= v_from and not sc.hidden
               and (p_kind = 'best' or sc.innings = p_innings)) t
     order by t.score desc, t.at asc limit 10) x;

  select coalesce(json_agg(json_build_object('b', x.b, 'c', x.c) order by x.b), '[]'::json) into v_bins from (
    select (case when p_kind = 'best' then sc.best else sc.total end / v_step) as b, count(*) as c
      from private.hr_scores sc
     where sc.mode = p_mode and sc.input = p_input and sc.created_at >= v_from and not sc.hidden
       and (p_kind = 'best' or sc.innings = p_innings)
     group by 1) x;

  if p_score is not null then
    select count(*) + 1 into v_rank from private.hr_scores sc
     where sc.mode = p_mode and sc.input = p_input and sc.created_at >= v_from and not sc.hidden
       and (p_kind = 'best' or sc.innings = p_innings)
       and (case when p_kind = 'best' then sc.best else sc.total end) > p_score;
  end if;

  return json_build_object('total', v_total, 'step', v_step, 'max', v_max, 'top', v_top, 'bins', v_bins, 'my_rank', v_rank);
end $$;

-- ── 실행 권한: 공개 함수 3개만 ──
revoke all on function public.hr_start_session(text, text, text, text, int) from public;
revoke all on function public.hr_submit_score(uuid, int, int, int, text) from public;
revoke all on function public.hr_get_leaderboard(text, text, text, int, text, int) from public;
revoke all on all functions in schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.hr_start_session(text, text, text, text, int) to anon';
    execute 'grant execute on function public.hr_submit_score(uuid, int, int, int, text) to anon';
    execute 'grant execute on function public.hr_get_leaderboard(text, text, text, int, text, int) to anon';
    execute 'revoke all on all functions in schema private from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.hr_start_session(text, text, text, text, int) to authenticated';
    execute 'grant execute on function public.hr_submit_score(uuid, int, int, int, text) to authenticated';
    execute 'grant execute on function public.hr_get_leaderboard(text, text, text, int, text, int) to authenticated';
    execute 'revoke all on all functions in schema private from authenticated';
  end if;
end $$;

-- ════════════════ 관리자용 (SQL Editor 에서 직접 실행) ════════════════
-- 최근 기록 보기:
--   select id, mode, input, innings, team_name, player_name, total, best, hits, homers, created_at from private.hr_scores order by created_at desc limit 50;
-- 부적절한 이름 숨기기:
--   update private.hr_scores set hidden = true where team_name = '문제되는이름' or player_name = '문제되는이름';
-- 금지어 추가 (모든 게임에 같이 적용):
--   insert into private.banned_words(word) values ('추가할단어') on conflict do nothing;
-- 13개월 지난 기록 정리:
--   delete from private.hr_scores where created_at < now() - interval '13 months';
