import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end).trim())
    if (end === text.length) break
    start += chunkSize - overlap
  }
  return chunks.filter(c => c.length > 80)
}

async function createEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
  })
  const data = await res.json()
  if (!data.data?.[0]?.embedding) throw new Error(`임베딩 생성 실패: ${JSON.stringify(data)}`)
  return data.data[0].embedding
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const body = await req.json()
    const { source, category, level, title, text: textContent } = body

    if (!textContent || textContent.trim().length < 20) {
      return new Response(JSON.stringify({ error: '내용이 없습니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const chunks = chunkText(textContent)
    if (chunks.length === 0) {
      return new Response(JSON.stringify({ error: '내용이 너무 짧습니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const results = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkTitle = chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title
      const textToEmbed = `[${category ?? '테니스'}][${level ?? '전체'}] ${chunkTitle}\n${chunk}`

      const embedding = await createEmbedding(textToEmbed, OPENAI_API_KEY)

      const { data, error } = await supabase
        .from('tennis_knowledge')
        .insert({
          coach_id: null,   // 공용 자료
          source: source ?? '공용 자료',
          category: category ?? '테니스',
          level: level ?? '전체',
          title: chunkTitle,
          content: chunk,
          embedding,
        })
        .select('id')
        .single()

      if (error) throw error
      results.push(data.id)

      // rate limit 방지
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 50))
    }

    return new Response(JSON.stringify({
      success: true,
      saved: results.length,
      ids: results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('add-public-knowledge error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
