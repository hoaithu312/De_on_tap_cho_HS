from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import List, Dict, Optional, Any

# --- DOCUMENT SCHEMAS ---
class DocumentBase(BaseModel):
    title: str
    content: str

class DocumentCreate(DocumentBase):
    pass

class DocumentResponse(DocumentBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True

# --- QUESTION SCHEMAS ---
class QuestionBase(BaseModel):
    question_text: str
    question_type: str  # multiple_choice, essay
    options: Optional[Dict[str, str]] = None
    correct_answer: str
    rubric: Optional[str] = None
    max_score: float = 1.0

class QuestionResponse(QuestionBase):
    id: UUID
    quiz_id: UUID

    class Config:
        from_attributes = True

# --- QUIZ SCHEMAS ---
class QuizBase(BaseModel):
    title: str
    subject: str
    quiz_type: str
    duration_minutes: int

class QuizResponseSimple(QuizBase):
    id: UUID
    document_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True

class QuizResponse(QuizResponseSimple):
    questions: List[QuestionResponse] = []

# --- ATTEMPT DETAILS SCHEMAS ---
class AttemptAnswerHistoryItem(BaseModel):
    selected: str
    correct: Optional[bool] = None
    timestamp: Optional[str] = None

class AttemptDetailBase(BaseModel):
    question_id: UUID
    answers_history: List[AttemptAnswerHistoryItem]
    final_score: float
    ai_feedback: Optional[str] = None

class AttemptDetailResponse(AttemptDetailBase):
    id: UUID
    attempt_id: UUID

    class Config:
        from_attributes = True

# --- ATTEMPT SCHEMAS ---
class AttemptBase(BaseModel):
    quiz_id: UUID
    score: float
    time_spent_seconds: int

class AttemptResponseSimple(AttemptBase):
    id: UUID
    submitted_at: datetime

    class Config:
        from_attributes = True

class AttemptResponse(AttemptResponseSimple):
    details: List[AttemptDetailResponse] = []

# --- DYNAMIC REQUEST SCHEMAS ---
class QuizGenerateRequest(BaseModel):
    document_id: Optional[UUID] = None
    direct_text: Optional[str] = None
    subject: str = "Tự động phát hiện"
    quiz_type: str = "multiple_choice"  # multiple_choice, essay, hybrid
    question_count: int = Field(default=5, ge=3, le=20)
    duration_minutes: int = Field(default=15, ge=5, le=90)
    api_key: str
    ai_provider: str = "gemini"  # gemini, openai
    ai_model: Optional[str] = None

class QuestionAttemptInput(BaseModel):
    question_id: UUID
    selected_option: Optional[str] = None  # for multiple choice
    drafts: List[str] = []  # for essay
    attempts_count: int

class SubmitQuizRequest(BaseModel):
    quiz_id: UUID
    time_spent_seconds: int
    answers: List[QuestionAttemptInput]
    api_key: str
    ai_provider: str = "gemini"
    ai_model: Optional[str] = None
