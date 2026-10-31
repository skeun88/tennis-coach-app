-- lesson_requests: member_id nullable + guest columns + source
alter table lesson_requests
  alter column member_id drop not null,
  add column if not exists guest_name text,
  add column if not exists guest_phone text,
  add column if not exists package_id uuid references lesson_packages(id),
  add column if not exists source text not null default 'app';

-- 인덱스 (중복 방지)
create index if not exists idx_lesson_requests_coach_status on lesson_requests (coach_id, status);
create index if not exists idx_members_coach_phone on members (coach_id, phone);

-- RLS: 공개 코치의 coach_profiles anon 읽기 (전화/이메일 제외)
create or replace view public_coach_profiles as
  select
    id,
    coach_id,
    display_name,
    avatar_url,
    sport,
    region_city,
    region_district,
    center_name,
    bio,
    coaching_years,
    specialties,
    coaching_style,
    has_player_career,
    career_details,
    certifications,
    awards,
    show_coaching_journey,
    journey_snapshot,
    public_slug,
    is_public
  from coach_profiles
  where is_public = true;

grant select on public_coach_profiles to anon;

-- lesson_requests: anon이 게스트 요청 insert 가능 (coach_id 있는 경우만)
create policy "anon can insert guest lesson requests"
  on lesson_requests for insert
  to anon
  with check (
    member_id is null
    and guest_phone is not null
    and guest_name is not null
    and source = 'web'
  );

-- lesson_packages: 공개 코치의 패키지 anon 읽기
create policy "anon can read public coach packages"
  on lesson_packages for select
  to anon
  using (
    coach_id in (select coach_id from coach_profiles where is_public = true)
  );
