import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// tennis_knowledge 테이블의 모든 항목에 임베딩 생성
// POST /functions/v1/generate-embeddings (관리자용)
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // 임베딩 없는 항목 조회
    const { data: items, error } = await supabase
      .from('tennis_knowledge')
      .select('id, title, content, category, level')
      .is('embedding', null)
      .limit(50) // 한 번에 50개씩 처리

    if (error) throw error
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ message: '임베딩 생성할 항목 없음', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`임베딩 생성 시작: ${items.length}개`)
    let successCount = 0
    let errorCount = 0

    for (const item of items) {
      try {
        // 임베딩용 텍스트: 제목 + 카테고리 + 레벨 + 내용 (검색 품질 향상)
        const textToEmbed = `[${item.category}][${item.level || '전체'}] ${item.title}\n${item.content}`

        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: textToEmbed.slice(0, 8000),
          }),
        })

        const embedData = await embedRes.json()

        if (!embedData.data?.[0]?.embedding) {
          console.error(`임베딩 실패 (${item.id}):`, JSON.stringify(embedData))
          errorCount++
          continue
        }

        // DB 업데이트
        const { error: updateError } = await supabase
          .from('tennis_knowledge')
          .update({ embedding: embedData.data[0].embedding })
          .eq('id', item.id)

        if (updateError) {
          console.error(`DB 업데이트 실패 (${item.id}):`, updateError)
          errorCount++
        } else {
          successCount++
          console.log(`✅ 임베딩 완료: ${item.title}`)
        }

        // Rate limit 방지 (약간의 딜레이)
        await new Promise(resolve => setTimeout(resolve, 200))

      } catch (e) {
        console.error(`처리 오류 (${item.id}):`, e)
        errorCount++
      }
    }

    return new Response(JSON.stringify({
      message: '임베딩 생성 완료',
      success: successCount,
      errors: errorCount,
      total: items.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
