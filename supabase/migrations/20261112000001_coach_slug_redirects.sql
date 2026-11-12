create table if not exists coach_slug_redirects (
  id uuid default gen_random_uuid() primary key,
  old_slug text not null,
  new_slug text not null,
  coach_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

create unique index if not exists coach_slug_redirects_old_slug_idx on coach_slug_redirects(old_slug);

alter table coach_slug_redirects enable row level security;

create policy "coach can insert own redirects"
  on coach_slug_redirects for insert
  with check (coach_id = auth.uid());

create policy "public read redirects"
  on coach_slug_redirects for select
  using (true);
