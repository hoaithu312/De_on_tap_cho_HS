import os
import json
import httpx
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type

class RateLimitError(Exception):
    pass

# Import local modules
import models_v4 as models
import schemas_v4 as schemas

# --- DATABASE SETUP ---
# Default to SQLite local database for easy testing, but configurable via env for PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./quiz_app.db")

engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables automatically
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Smart Quiz Generator Backend API", version="1.0.0")

# --- CORS MIDDLEWARE ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- HELPER FUNCTIONS FOR AI CALLS ---
@retry(
    wait=wait_exponential(multiplier=2, min=2, max=10),
    stop=stop_after_attempt(4),
    retry=retry_if_exception_type(RateLimitError)
)
async def call_ai_api(prompt: str, api_key: str, provider: str, model: str, is_json: bool = True) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            if provider == "gemini":
                # Default model if not specified
                ai_model = model or "gemini-1.5-flash-latest"
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{ai_model}:generateContent?key={api_key}"
                
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.5,
                        "maxOutputTokens": 8192
                    }
                }
                if is_json:
                    payload["generationConfig"]["responseMimeType"] = "application/json"

                response = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
                if response.status_code in [429, 503]:
                    raise RateLimitError(f"Google Gemini API rate limit or overloaded: {response.text}")
                elif response.status_code != 200:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Google Gemini API error: {response.text}"
                    )
                
                data = response.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
            
            elif provider == "openai":
                ai_model = model or "gpt-4o-mini"
                url = "https://api.openai.com/v1/chat/completions"
                
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
                
                payload = {
                    "model": ai_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.5,
                    "max_tokens": 4096
                }
                if is_json:
                    payload["response_format"] = {"type": "json_object"}

                response = await client.post(url, json=payload, headers=headers)
                if response.status_code in [429, 503]:
                    raise RateLimitError(f"OpenAI API rate limit or overloaded: {response.text}")
                elif response.status_code != 200:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"OpenAI API error: {response.text}"
                    )
                
                data = response.json()
                return data["choices"][0]["message"]["content"]
            
            else:
                raise HTTPException(status_code=400, detail="Invalid AI provider. Use 'gemini' or 'openai'.")
                
        except Exception as e:
            if isinstance(e, RateLimitError) or isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail=f"Failed to communicate with AI API: {str(e)}")


# --- ENDPOINTS ---

# 1. Document Upload
@app.post("/api/documents", response_model=schemas.DocumentResponse, status_code=status.HTTP_201_CREATED)
def create_document(doc: schemas.DocumentCreate, db: Session = Depends(get_db)):
    db_doc = models.Document(title=doc.title, content=doc.content)
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)
    return db_doc

@app.get("/api/documents/{document_id}", response_model=schemas.DocumentResponse)
def get_document(document_id: UUID, db: Session = Depends(get_db)):
    doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


# 2. AI Quiz Generation
@app.post("/api/quizzes/generate", response_model=schemas.QuizResponse)
async def generate_quiz(req: schemas.QuizGenerateRequest, db: Session = Depends(get_db)):
    # 1. Gather document text
    text_content = ""
    doc_title = "Đề ôn tập tự tạo"
    
    if req.document_id:
        doc = db.query(models.Document).filter(models.Document.id == req.document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        text_content = doc.content
        doc_title = doc.title
    elif req.direct_text:
        text_content = req.direct_text
    else:
        raise HTTPException(status_code=400, detail="Must provide either document_id or direct_text")

    if len(text_content.strip()) < 50:
        raise HTTPException(status_code=400, detail="Text content must be at least 50 characters long")

    # 2. Construct AI Prompt
    prompt = f"""Bạn là một chuyên gia khảo thí và biên soạn đề thi. Nhiệm vụ của bạn là phân tích tài liệu văn bản sau đây và xây dựng một đề ôn tập thông minh chất lượng cao cho học sinh.
Nội dung tài liệu:
---
{text_content[:15000]}
---

Yêu cầu đề thi:
- Tên môn học: {req.subject if req.subject != 'Tự động phát hiện' else 'Tự động trích xuất môn học chính xác'}
- Số lượng câu hỏi: {req.question_count} câu.
- Hình thức câu hỏi: {req.quiz_type} (multiple_choice: Trắc nghiệm khách quan với 4 lựa chọn A, B, C, D; essay: Tự luận; hybrid: Kết hợp cả hai hình thức).
- Ngôn ngữ: Tiếng Việt.
- Nội dung câu hỏi phải bám sát kiến thức cốt lõi, khái niệm, công thức hoặc dữ kiện trong tài liệu. Tránh các câu hỏi quá chung chung hoặc không có trong tài liệu.
- Đối với trắc nghiệm, các phương án nhiễu phải hợp lý và có tính phân loại cao. Chỉ có DUY NHẤT một phương án đúng.
- Đối với tự luận, phải cung cấp đáp án mẫu (correct_answer) và hướng dẫn chấm điểm (rubric) chi tiết để AI chấm điểm sau này. Điểm tối đa mỗi câu hỏi nên chia đều sao cho tổng điểm tối đa của toàn bài là 10. Điền điểm tối đa cho mỗi câu vào trường "max_score" (ví dụ: 10 điểm cho 5 câu thì mỗi câu max_score=2.0).
- Để tối ưu hóa tốc độ sinh đề và tránh bị lỗi timeout/giới hạn khi tạo nhiều câu hỏi (như 10 câu), phần giải thích ('explanation') hãy viết NGẮN GỌN và TRỌNG TÂM (khoảng 1-3 câu), chỉ viết chi tiết khi tài liệu gốc có sẵn hướng dẫn giải chi tiết cho câu hỏi đó.

Bạn BẮT BUỘC phải trả về kết quả dưới định dạng JSON duy nhất tuân thủ cấu trúc Schema dưới đây. Không thêm bất kỳ văn bản giải thích nào ngoài khối JSON.


JSON Schema:
{{
  "title": "Tiêu đề đề ôn tập dựa trên nội dung tài liệu",
  "subject": "Tên môn học trích xuất được (ví dụ: Toán học, Sinh học, Ngữ văn...)",
  "questions": [
    {{
      "id": "q_1",
      "question_text": "Nội dung câu hỏi...",
      "question_type": "multiple_choice",
      "options": {{
        "A": "Nội dung phương án A",
        "B": "Nội dung phương án B",
        "C": "Nội dung phương án C",
        "D": "Nội dung phương án D"
      }},
      "correct_answer": "Mã chữ cái đáp án đúng (A hoặc B hoặc C hoặc D)",
      "max_score": 2.0,
      "explanation": "Giải thích chi tiết tại sao chọn đáp án này dựa trên tài liệu"
    }},
    {{
      "id": "q_2",
      "question_text": "Nội dung câu hỏi tự luận...",
      "question_type": "essay",
      "options": null,
      "correct_answer": "Ý chính cần trả lời hoặc câu trả lời mẫu chi tiết",
      "rubric": "Thang điểm và tiêu chí chấm điểm (ví dụ: Nêu đủ ý A được 50%, giải thích đúng ý B được 50%)",
      "max_score": 2.0,
      "explanation": "Giải thích kiến thức liên quan từ tài liệu gốc"
    }}
  ]
}}"""

    # 3. Call AI API
    gen_model = req.ai_model
    if req.ai_provider == "gemini" and not gen_model:
        gen_model = "gemini-1.5-flash-latest"
        
    response_text = await call_ai_api(
        prompt=prompt,
        api_key=req.api_key,
        provider=req.ai_provider,
        model=gen_model,
        is_json=True
    )

    try:
        # Clean markdown code blocks if needed
        clean_json = response_text.strip()
        if clean_json.startswith("```json"):
            clean_json = clean_json[7:]
        if clean_json.endswith("```"):
            clean_json = clean_json[:-3]
        clean_json = clean_json.strip()

        parsed_quiz = json.loads(clean_json)
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"AI returned invalid JSON: {str(e)}. Original response: {response_text}"
        )

    if not isinstance(parsed_quiz, dict) or "questions" not in parsed_quiz or not isinstance(parsed_quiz["questions"], list) or len(parsed_quiz["questions"]) == 0:
        raise HTTPException(
            status_code=500,
            detail="AI did not return a valid quiz JSON structure containing a 'questions' list."
        )

    # 4. Save Quiz to Database
    db_quiz = models.Quiz(
        document_id=req.document_id,
        title=parsed_quiz.get("title", f"Đề ôn tập: {doc_title}"),
        subject=parsed_quiz.get("subject", req.subject if req.subject != 'Tự động phát hiện' else 'Tổng hợp'),
        quiz_type=req.quiz_type,
        duration_minutes=req.duration_minutes
    )
    db.add(db_quiz)
    db.commit()
    db.refresh(db_quiz)

    # Save Questions
    questions_list = parsed_quiz.get("questions", [])
    num_questions = len(questions_list)
    for q in questions_list:
        try:
            max_score_val = float(q.get("max_score")) if q.get("max_score") is not None else (10.0 / num_questions)
        except (ValueError, TypeError):
            max_score_val = 10.0 / num_questions

        db_question = models.Question(
            quiz_id=db_quiz.id,
            question_text=q.get("question_text"),
            question_type=q.get("question_type"),
            options=q.get("options"),
            correct_answer=q.get("correct_answer"),
            rubric=q.get("rubric"),
            max_score=max_score_val
        )
        db.add(db_question)
    
    db.commit()
    db.refresh(db_quiz)
    return db_quiz


# 3. Get Quiz Details (For Students - Answers hidden to prevent cheating)
@app.get("/api/quizzes/{quiz_id}", response_model=schemas.QuizResponse)
def get_quiz_details(quiz_id: UUID, db: Session = Depends(get_db)):
    quiz = db.query(models.Quiz).filter(models.Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    
    # Secure payload: Hide correct_answer and rubric from students during taking the quiz
    secured_questions = []
    for q in quiz.questions:
        secured_questions.append(
            models.Question(
                id=q.id,
                quiz_id=q.quiz_id,
                question_text=q.question_text,
                question_type=q.question_type,
                options=q.options,
                max_score=q.max_score,
                # Hiding these:
                correct_answer="HIDDEN",
                rubric="HIDDEN"
            )
        )
    
    secured_quiz = models.Quiz(
        id=quiz.id,
        document_id=quiz.document_id,
        title=quiz.title,
        subject=quiz.subject,
        quiz_type=quiz.quiz_type,
        duration_minutes=quiz.duration_minutes,
        created_at=quiz.created_at,
        questions=secured_questions
    )
    return secured_quiz


# 4. Submit & Auto-Grade Exam
@app.post("/api/attempts/submit", response_model=schemas.AttemptResponse)
async def submit_quiz(req: schemas.SubmitQuizRequest, db: Session = Depends(get_db)):
    # 1. Fetch Quiz and correct questions
    quiz = db.query(models.Quiz).filter(models.Quiz.id == req.quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    
    # Store questions map for fast retrieval
    q_map = {q.id: q for q in quiz.questions}
    
    # Initialize variables
    total_score = 0.0
    max_exam_score = 0.0
    attempt_details_to_create = []

    # 2. Process answers
    for ans_input in req.answers:
        q_id = ans_input.question_id
        if q_id not in q_map:
            raise HTTPException(status_code=400, detail=f"Question {q_id} does not belong to this quiz")
        
        question = q_map[q_id]
        max_exam_score += question.max_score
        
        if question.question_type == "multiple_choice":
            # Auto grading multiple choice
            selected = ans_input.selected_option
            correct = question.correct_answer
            score = question.max_score if selected == correct else 0.0
            
            # Format MCQ history log (Client-side limit is 2, backend accepts it)
            history = [{"selected": selected or "(Trống)", "correct": selected == correct}]
            
            detail = models.AttemptDetail(
                question_id=q_id,
                answers_history=history,
                final_score=score,
                ai_feedback="Đúng hoàn toàn" if score > 0 else "Sai"
            )
            attempt_details_to_create.append(detail)
            total_score += score
            
        elif question.question_type == "essay":
            # Determine final answer from drafts
            student_answer = ""
            if len(ans_input.drafts) > 0:
                student_answer = ans_input.drafts[-1]  # final submission
                
            history = [{"selected": text, "timestamp": f"Draft {i+1}"} for i, text in enumerate(ans_input.drafts)]

            if not student_answer.strip():
                # Blank submission
                detail = models.AttemptDetail(
                    question_id=q_id,
                    answers_history=history,
                    final_score=0.0,
                    ai_feedback="Học sinh bỏ trống câu tự luận."
                )
                attempt_details_to_create.append(detail)
                continue

            # Call AI to grade the essay response
            grade_prompt = f"""Bạn là một giáo viên chấm thi AI chuyên nghiệp và công tâm. Nhiệm vụ của bạn là chấm điểm câu trả lời tự luận của học sinh dựa trên câu hỏi, đáp án mẫu và thang điểm (rubric) chấm thi đã có sẵn.

Thông tin câu hỏi và đáp án tham chiếu:
- Câu hỏi: {question.question_text}
- Đáp án mẫu: {question.correct_answer}
- Hướng dẫn chấm điểm (Rubric): {question.rubric or 'Đầy đủ ý chính theo đáp án mẫu.'}
- Điểm tối đa của câu hỏi này: {question.max_score}

Bài làm của học sinh:
---
{student_answer}
---

Yêu cầu chấm điểm:
- Đọc kỹ bài làm của học sinh và đối chiếu với đáp án mẫu và rubric.
- Cho điểm chính xác (số thực từ 0 đến {question.max_score}). Hãy công bằng, thưởng điểm cho các ý đúng và không cho điểm các phần sai lệch hoặc lạc đề.
- Viết nhận xét (feedback) ngắn gọn nhưng chi tiết bằng Tiếng Việt:
  + Chỉ ra những ý đúng mà học sinh đã nêu.
  + Chỉ ra những ý còn thiếu hoặc sai sót so với đáp án mẫu.
  + Đưa ra lời khuyên để cải thiện câu trả lời.

Trả về kết quả duy nhất ở định dạng JSON dưới đây, không kèm theo bất kỳ văn bản nào khác ngoài JSON.

JSON Schema:
{{
  "score": 1.5, // Số thực nằm trong đoạn [0, {question.max_score}]
  "feedback": "Nhận xét chi tiết cho học sinh..."
}}"""

            try:
                grade_model = req.ai_model
                if req.ai_provider == "gemini" and not grade_model:
                    grade_model = "gemini-1.5-pro-latest"
                    
                response = await call_ai_api(
                    prompt=grade_prompt,
                    api_key=req.api_key,
                    provider=req.ai_provider,
                    model=grade_model,
                    is_json=True
                )
                
                clean_res = response.strip()
                if clean_res.startsWith("```json"):
                    clean_res = clean_res[7:]
                if clean_res.endswith("```"):
                    clean_res = clean_res[:-3]
                clean_res = clean_res.strip()
                
                parsed_grading = json.loads(clean_res)
                score = min(float(parsed_grading.get("score", 0.0)), question.max_score)
                feedback = parsed_grading.get("feedback", "Không có nhận xét.")
                
            except Exception as e:
                # Handle API failures gracefully
                score = 0.0
                feedback = f"Lỗi gọi AI chấm thi: {str(e)}"
                
            detail = models.AttemptDetail(
                question_id=q_id,
                answers_history=history,
                final_score=score,
                ai_feedback=feedback
            )
            attempt_details_to_create.append(detail)
            total_score += score

    # Normalize final score to a 10-point scale
    normalized_score = total_score
    if max_exam_score > 0 and max_exam_score != 10.0:
        normalized_score = (total_score / max_exam_score) * 10.0
        normalized_score = round(min(max(normalized_score, 0.0), 10.0), 2)

    # 3. Create and save Attempt
    db_attempt = models.Attempt(
        quiz_id=req.quiz_id,
        score=normalized_score,
        time_spent_seconds=req.time_spent_seconds
    )
    db.add(db_attempt)
    db.commit()
    db.refresh(db_attempt)

    # Attach details
    for d in attempt_details_to_create:
        d.attempt_id = db_attempt.id
        db.add(d)
        
    db.commit()
    db.refresh(db_attempt)
    
    return db_attempt


# 5. History Lists
@app.get("/api/attempts", response_model=List[schemas.AttemptResponseSimple])
def get_attempts_history(subject: Optional[str] = None, quiz_type: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.Attempt).join(models.Quiz)
    
    if subject and subject != "all":
        query = query.filter(models.Quiz.subject == subject)
    if quiz_type and quiz_type != "all":
        query = query.filter(models.Quiz.quiz_type == quiz_type)
        
    attempts = query.order_by(models.Attempt.submitted_at.desc()).all()
    return attempts


# 6. Detailed attempt report
@app.get("/api/attempts/{attempt_id}", response_model=schemas.AttemptResponse)
def get_attempt_detail(attempt_id: UUID, db: Session = Depends(get_db)):
    attempt = db.query(models.Attempt).filter(models.Attempt.id == attempt_id).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return attempt


# 7. Reset history (Helper endpoint)
@app.delete("/api/attempts", status_code=status.HTTP_204_NO_CONTENT)
def clear_attempts_history(db: Session = Depends(get_db)):
    db.query(models.AttemptDetail).delete()
    db.query(models.Attempt).delete()
    db.commit()
    return None


# 8. Single Essay Check & Grade Draft Endpoint
class EssayGradeRequest(BaseModel):
    question_id: UUID
    student_answer: str
    api_key: str
    ai_provider: str = "gemini"
    ai_model: Optional[str] = None

@app.post("/api/attempts/grade-essay")
async def grade_essay_draft(req: EssayGradeRequest, db: Session = Depends(get_db)):
    question = db.query(models.Question).filter(models.Question.id == req.question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
        
    grade_prompt = f"""Bạn là một giáo viên chấm thi AI chuyên nghiệp và công tâm.
Nhiệm vụ của bạn là chấm xem câu trả lời của học sinh có ĐỦ Ý và CHÍNH XÁC (tương ứng với tối thiểu 80% điểm số hoặc đạt yêu cầu) so với đáp án mẫu để được coi là ĐÚNG hay không.
Hãy phản hồi cực kỳ ngắn gọn, không giải thích dài dòng.

Thông tin câu hỏi và đáp án tham chiếu:
- Câu hỏi: {question.question_text}
- Đáp án mẫu: {question.correct_answer}
- Hướng dẫn chấm điểm (Rubric): {question.rubric or 'Đầy đủ ý chính theo đáp án mẫu.'}

Bài làm của học sinh:
---
{req.student_answer}
---

Trả về kết quả duy nhất ở định dạng JSON dưới đây, không kèm theo bất kỳ văn bản nào khác ngoài JSON.

JSON Schema:
{{
  "correct": true, // true nếu câu trả lời đã chính xác và đầy đủ ý cơ bản, false nếu chưa đạt yêu cầu
  "feedback": "Một câu nhận xét rất ngắn gọn (tối đa 2 câu) để học sinh biết họ thiếu hoặc sai gì, tuyệt đối không tiết lộ đáp án mẫu."
}}"""

    try:
        grade_model = req.ai_model
        if req.ai_provider == "gemini" and not grade_model:
            grade_model = "gemini-3.5-flash"
            
        response = await call_ai_api(
            prompt=grade_prompt,
            api_key=req.api_key,
            provider=req.ai_provider,
            model=grade_model,
            is_json=True
        )
        
        clean_res = response.strip()
        if clean_res.startswith("```json"):
            clean_res = clean_res[7:]
        if clean_res.endswith("```"):
            clean_res = clean_res[:-3]
        clean_res = clean_res.strip()
        
        parsed_grading = json.loads(clean_res)
        return {
            "correct": parsed_grading.get("correct") == True,
            "feedback": parsed_grading.get("feedback", "Chưa đạt yêu cầu.")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi gọi AI chấm thi: {str(e)}")
