#!/usr/bin/env python3
"""RAG PDF → 텍스트 추출 → add-public-knowledge Edge Function → 임베딩 저장"""
import sys, time, pathlib, unicodedata
import requests

try:
    import fitz
except ImportError:
    sys.exit("pip3 install pymupdf")

RAG_DIR      = pathlib.Path("/Users/karensong/.openclaw/workspace/tennis-coach-app/rag-docs")
SUPABASE_URL = "https://luhuiwyhewofjxnbzbdt.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/add-public-knowledge"

# 실제 서비스 키 런타임 로딩
def load_service_key():
    env = (RAG_DIR.parent / ".env.service").read_text()
    for line in env.splitlines():
        if "SERVICE_KEY" in line:
            return line.split("=", 1)[1].strip()
    raise RuntimeError(".env.service에서 SERVICE_KEY를 찾을 수 없음")

def nfc(s): return unicodedata.normalize("NFC", s)

FOLDER_META_NFC = {
    nfc("ITF 표준 테니스 컨디셔닝 메커니즘"):               ("conditioning", "전체",   "ITF"),
    nfc("단체 회원을 좁은 공간에서 녹여내는 가성비 레슨 플랜"):  ("lesson_plan",  "전체",   "단체 레슨"),
    nfc("이벤트:체험:원데이 클래스 레슨 플랜"):              ("lesson_plan",  "전체",   "이벤트/체험"),
    nfc("상급, 선수 레벨 "):                              ("lesson_plan",  "상급",   "상급/선수"),
    nfc("입문,초급, 중급, (주니어, 성인)"):                 ("lesson_plan",  "초중급", "입문/초급/중급"),
    nfc("호주 주니어 레슨 프로그램 초중"):                  ("lesson_plan",  "주니어", "호주 주니어"),
    nfc("호주오픈_주니어_초중급"):                         ("lesson_plan",  "주니어", "호주오픈 주니어"),
}

def get_meta(pdf_path):
    folder = nfc(pdf_path.parent.name)
    if folder == "rag-docs":
        name = pdf_path.stem
        if "시니어" in name: return ("lesson_plan", "시니어", "시니어 프로그램")
        return ("lesson_plan", "전체", "공용 자료")
    return FOLDER_META_NFC.get(folder, ("lesson_plan", "전체", "공용 자료"))

def extract_text(pdf_path):
    doc = fitz.open(str(pdf_path))
    pages = []
    for page in doc:
        text = page.get_text("text")
        if len(text.strip()) < 50:
            tp = page.get_textpage_ocr(dpi=150, full=True)
            text = page.get_text("text", textpage=tp)
        pages.append(text)
    doc.close()
    return "\n".join(pages).strip()

def call_edge(title, text, source, category, level, key):
    try:
        r = requests.post(
            FUNCTION_URL,
            json={"title": title, "text": text, "source": source, "category": category, "level": level},
            headers={"Authorization": f"Bearer {key}"},
            timeout=120,
        )
        return r.json()
    except Exception as e:
        return {"error": str(e)}

def main():
    key = load_service_key()

    pdfs = sorted(RAG_DIR.rglob("*.pdf"))
    seen, unique = set(), []
    for p in pdfs:
        k = nfc(p.stem.replace(".coredownload", ""))
        if k not in seen:
            seen.add(k)
            unique.append(p)

    print(f"총 {len(unique)}개 PDF 처리 시작", flush=True)
    print("=" * 60, flush=True)

    ok = fail = 0
    for i, pdf in enumerate(unique, 1):
        category, level, source = get_meta(pdf)
        title = nfc(pdf.stem).replace("-", " ").replace("_", " ").replace(".coredownload", "")[:80]

        print(f"\n[{i}/{len(unique)}] {pdf.relative_to(RAG_DIR)}", flush=True)
        print(f"  → {category} / {level} / {source}", flush=True)

        try:
            text = extract_text(pdf)
        except Exception as e:
            print(f"  ✗ 추출 실패: {e}", flush=True)
            fail += 1; continue

        if len(text.strip()) < 100:
            print(f"  ✗ 텍스트 짧음 ({len(text)}자) 스킵", flush=True)
            fail += 1; continue

        print(f"  → {len(text)}자 추출", flush=True)
        result = call_edge(title, text, source, category, level, key)

        if result.get("success"):
            print(f"  ✅ {result['saved']}청크 저장", flush=True)
            ok += 1
        else:
            print(f"  ✗ 실패: {result}", flush=True)
            fail += 1

        time.sleep(0.3)

    print(f"\n{'='*60}", flush=True)
    print(f"완료: ✅ {ok}  ✗ {fail}", flush=True)

if __name__ == "__main__":
    main()
