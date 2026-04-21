-- 벡터 검색 함수 (Supabase SQL Editor에서 실행)
create or replace function search_tennis_knowledge(
  query_embedding vector(1536),
  match_threshold float default 0.4,
  match_count int default 5,
  filter_level text default null
)
returns table (
  id uuid,
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
    tk.source,
    tk.category,
    tk.level,
    tk.title,
    tk.content,
    1 - (tk.embedding <=> query_embedding) as similarity
  from tennis_knowledge tk
  where
    1 - (tk.embedding <=> query_embedding) > match_threshold
    and (filter_level is null or tk.level is null or tk.level = filter_level or tk.level = '전체')
  order by tk.embedding <=> query_embedding
  limit match_count;
end;
$$;
