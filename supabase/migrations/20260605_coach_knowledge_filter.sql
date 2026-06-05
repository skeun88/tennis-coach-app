-- Coach Personal Knowledge Layer
-- search_tennis_knowledge RPC에 filter_coach_id 파라미터 추가

-- 기존 함수 삭제 후 재생성
drop function if exists search_tennis_knowledge(vector, float, int, text, text);
drop function if exists search_tennis_knowledge(vector, float, int, text, text, uuid);

create or replace function search_tennis_knowledge(
  query_embedding vector(1536),
  match_threshold float default 0.4,
  match_count int default 5,
  filter_level text default null,
  filter_court_type text default null,
  filter_coach_id uuid default null
)
returns table (
  id uuid,
  coach_id uuid,
  source text,
  category text,
  level text,
  title text,
  content text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    tk.id,
    tk.coach_id,
    tk.source,
    tk.category,
    tk.level,
    tk.title,
    tk.content,
    1 - (tk.embedding <=> query_embedding) as similarity
  from tennis_knowledge tk
  where
    1 - (tk.embedding <=> query_embedding) > match_threshold
    and (filter_level is null or tk.level is null or tk.level = '전체' or tk.level = filter_level)
    and (filter_court_type is null or tk.category = filter_court_type or tk.category is null)
    and (
      -- filter_coach_id가 있으면 해당 코치 자료만, null이면 공용(coach_id IS NULL) 자료만
      case
        when filter_coach_id is not null then tk.coach_id = filter_coach_id
        else tk.coach_id is null
      end
    )
  order by tk.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- tennis_knowledge RLS: 코치 본인 자료만 쓰기/삭제, 공용 자료는 읽기만
-- (기존 정책이 있으면 유지, 없으면 추가)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tennis_knowledge' and policyname = 'coach_own_knowledge_insert'
  ) then
    create policy "coach_own_knowledge_insert"
      on tennis_knowledge for insert
      with check (coach_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'tennis_knowledge' and policyname = 'coach_own_knowledge_delete'
  ) then
    create policy "coach_own_knowledge_delete"
      on tennis_knowledge for delete
      using (coach_id = auth.uid());
  end if;
end $$;
