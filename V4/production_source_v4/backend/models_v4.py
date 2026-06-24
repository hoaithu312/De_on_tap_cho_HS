import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    quizzes = relationship("Quiz", back_populates="document", cascade="all, delete-orphan")


class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    quiz_type = Column(String, nullable=False)  # multiple_choice, essay, hybrid
    duration_minutes = Column(Integer, nullable=False, default=15)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    document = relationship("Document", back_populates="quizzes")
    questions = relationship("Question", back_populates="quiz", cascade="all, delete-orphan")
    attempts = relationship("Attempt", back_populates="quiz", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quiz_id = Column(UUID(as_uuid=True), ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    question_type = Column(String, nullable=False)  # multiple_choice, essay
    options = Column(JSON, nullable=True)  # {"A": "...", "B": "..."}
    correct_answer = Column(Text, nullable=False)  # "A" or model answer text
    rubric = Column(Text, nullable=True)  # scoring guidelines for AI grading
    max_score = Column(Float, nullable=False, default=1.0)

    # Relationships
    quiz = relationship("Quiz", back_populates="questions")
    attempt_details = relationship("AttemptDetail", back_populates="question", cascade="all, delete-orphan")


class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quiz_id = Column(UUID(as_uuid=True), ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    score = Column(Float, nullable=False, default=0.0)
    time_spent_seconds = Column(Integer, nullable=False)
    submitted_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    quiz = relationship("Quiz", back_populates="attempts")
    details = relationship("AttemptDetail", back_populates="attempt", cascade="all, delete-orphan")


class AttemptDetail(Base):
    __tablename__ = "attempt_details"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    attempt_id = Column(UUID(as_uuid=True), ForeignKey("attempts.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(UUID(as_uuid=True), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    answers_history = Column(JSON, nullable=False)  # List of dicts: [{"selected": "A", "correct": false}, ...]
    final_score = Column(Float, nullable=False, default=0.0)
    ai_feedback = Column(Text, nullable=True)

    # Relationships
    attempt = relationship("Attempt", back_populates="details")
    question = relationship("Question", back_populates="attempt_details")
