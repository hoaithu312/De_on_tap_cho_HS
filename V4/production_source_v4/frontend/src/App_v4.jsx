import React, { useState, useEffect, useRef } from "react";

// API Base URL config (adjust according to backend port, e.g. localhost:8000)
const API_BASE_URL = "http://localhost:8000/api";

export default function App() {
  // Views navigation
  const [currentView, setCurrentView] = useState("dashboard"); // 'dashboard', 'quiz_session', 'grading_report', 'history'
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // Settings
  const [settings, setSettings] = useState({
    provider: "gemini",
    apiKey: "",
    model: "gemini-3.5-flash",
  });

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("smart_quiz_production_settings");
    if (saved) {
      setSettings(JSON.parse(saved));
    }
  }, []);

  const saveSettings = () => {
    localStorage.setItem("smart_quiz_production_settings", JSON.stringify(settings));
    setShowSettings(false);
    addToast("Cài đặt cấu hình AI thành công!", "success");
  };

  const hasApiKey = !!settings.apiKey;

  // Document Upload State
  const [selectedFile, setSelectedFile] = useState(null);
  const [directText, setDirectText] = useState("");
  const [fileContentText, setFileContentText] = useState("");
  const [isReadingFile, setIsReadingFile] = useState(false);
  const fileInputRef = useRef(null);

  // Quiz Configurations
  const [config, setConfig] = useState({
    subject: "Tự động phát hiện",
    type: "multiple_choice",
    questionCount: 5,
    duration: 15,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState("");

  // Quiz Session State
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [sessionAnswers, setSessionAnswers] = useState({}); // question_id -> { selectedOption, drafts: [], attempts: 0, feedback: null, locked: false }
  
  // Timer State
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerIntervalRef = useRef(null);
  const [examStartSeconds, setExamStartSeconds] = useState(0);

  // Grading Result State
  const [gradingResult, setGradingResult] = useState(null);

  // History State
  const [historyList, setHistoryList] = useState([]);
  const [historyFilter, setHistoryFilter] = useState({
    subject: "all",
    type: "all",
  });

  // Toasts
  const [toasts, setToasts] = useState([]);
  const addToast = (message, type = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // 1. File parsing using client-side libraries or native txt reader
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setSelectedFile(file);
    setIsReadingFile(true);
    addToast(`Đang đọc tệp ${file.name}...`, "info");

    const extension = file.name.split(".").pop().toLowerCase();
    
    if (extension === "txt") {
      const reader = new FileReader();
      reader.onload = (event) => {
        setFileContentText(event.target.result);
        setIsReadingFile(false);
        addToast("Nạp tệp văn bản thành công!", "success");
      };
      reader.readAsText(file);
    } else {
      // PDF and DOCX parsing requires standard PDF.js/Mammoth.js logic
      // In a React app, this is typically handled by third-party npm packages.
      // We read file as ArrayBuffer and emulate text extraction or instruct user.
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const arrayBuffer = event.target.result;
          let extractedText = "";

          if (extension === "pdf") {
            // Check if pdfjs-dist is loaded globally
            if (window.pdfjsLib) {
              const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
              for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                extractedText += textContent.items.map((item) => item.str).join(" ") + "\n";
              }
            } else {
              extractedText = `[Đã nạp file PDF: ${file.name}. Ở phiên bản production, backend sẽ parse tệp PDF này thông qua thư viện Python PyPDF/pdfplumber.]`;
            }
          } else if (extension === "docx") {
            if (window.mammoth) {
              const res = await window.mammoth.extractRawText({ arrayBuffer });
              extractedText = res.value;
            } else {
              extractedText = `[Đã nạp file Word: ${file.name}. Ở phiên bản production, backend sẽ parse tệp DOCX này thông qua thư viện python-docx.]`;
            }
          }

          setFileContentText(extractedText);
          setIsReadingFile(false);
          addToast(`Nạp tệp ${extension.toUpperCase()} thành công!`, "success");
        } catch (err) {
          console.error(err);
          setIsReadingFile(false);
          addToast("Lỗi giải nén tệp. Đã nạp file dưới dạng thô.", "warning");
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setFileContentText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // 2. Fetch history attempts on view history loading
  useEffect(() => {
    if (currentView === "history") {
      fetchHistory();
    }
  }, [currentView, historyFilter]);

  const fetchHistory = async () => {
    try {
      let url = `${API_BASE_URL}/attempts`;
      const params = [];
      if (historyFilter.subject !== "all") params.push(`subject=${encodeURIComponent(historyFilter.subject)}`);
      if (historyFilter.type !== "all") params.push(`quiz_type=${encodeURIComponent(historyFilter.type)}`);
      
      if (params.length > 0) url += "?" + params.join("&");
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        // Since backend simple attempts list returns basic details, we match with quizzes
        setHistoryList(data);
      }
    } catch (err) {
      addToast("Không thể tải lịch sử làm bài từ server backend!", "error");
    }
  };

  const clearAllHistory = async () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử không?")) {
      try {
        const res = await fetch(`${API_BASE_URL}/attempts`, { method: "DELETE" });
        if (res.ok) {
          setHistoryList([]);
          addToast("Đã xóa sạch lịch sử làm bài!", "success");
        }
      } catch (err) {
        addToast("Lỗi xóa lịch sử!", "error");
      }
    }
  };

  // 3. AI quiz generation from FastAPI
  const handleGenerateQuiz = async () => {
    if (!hasApiKey) {
      addToast("Vui lòng cấu hình API Key trước!", "error");
      setShowSettings(true);
      return;
    }

    const textToProcess = selectedFile ? fileContentText : directText;
    if (textToProcess.trim().length < 50) {
      addToast("Tài liệu quá ngắn! Yêu cầu tối thiểu 50 ký tự.", "error");
      return;
    }

    setIsGenerating(true);
    setGeneratingStatus("Đang xử lý tài liệu...");

    try {
      // First, create the document object on backend
      setGeneratingStatus("Đang tải tài liệu lên backend...");
      const docRes = await fetch(`${API_BASE_URL}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selectedFile ? selectedFile.name : "Đề ôn tập tự nhập",
          content: textToProcess,
        }),
      });

      if (!docRes.ok) throw new Error("Lỗi tải tài liệu lên Backend server");
      const savedDoc = await docRes.json();

      // Second, request generating the quiz using RAG
      setGeneratingStatus("AI đang phân tích & biên soạn câu hỏi...");
      const quizRes = await fetch(`${API_BASE_URL}/quizzes/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: savedDoc.id,
          subject: config.subject,
          quiz_type: config.type,
          question_count: config.questionCount,
          duration_minutes: config.duration,
          api_key: settings.apiKey,
          ai_provider: settings.provider,
          ai_model: settings.model,
        }),
      });

      if (!quizRes.ok) {
        const errDetails = await quizRes.json();
        throw new Error(errDetails.detail || "Không thể sinh câu hỏi");
      }

      const generatedQuiz = await quizRes.json();
      setActiveQuiz(generatedQuiz);
      
      addToast("Đã biên soạn đề thi thành công!", "success");
      startQuizSession(generatedQuiz);
    } catch (err) {
      console.error(err);
      addToast(`Lỗi tạo đề thi: ${err.message}`, "error");
    } finally {
      setIsGenerating(false);
    }
  };

  // 4. Play Session Handler
  const startQuizSession = (quiz) => {
    setActiveQuestionIndex(0);
    
    // Set empty answers dictionary
    const initialAnswers = {};
    quiz.questions.forEach((q) => {
      if (q.question_type === "multiple_choice") {
        initialAnswers[q.id] = {
          selectedOption: "",
          attempts: 0,
          feedback: null,
          locked: false,
        };
      } else {
        initialAnswers[q.id] = {
          draftText: "",
          drafts: [],
          attempts: 0,
          locked: false,
        };
      }
    });

    setSessionAnswers(initialAnswers);
    setTimerSeconds(quiz.duration_minutes * 60);
    setExamStartSeconds(quiz.duration_minutes * 60);
    setCurrentView("quiz_session");

    // Start timer interval
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          addToast("Hết giờ làm bài! Tự động nộp bài...", "warning");
          autoSubmitQuiz(quiz, initialAnswers);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Timer formatting helper
  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Option selection with auto-check MCQ
  const selectOption = (qId, option) => {
    if (sessionAnswers[qId].locked) return;
    setSessionAnswers((prev) => {
      const currentAns = prev[qId];
      if (currentAns.locked) return prev;
      
      const attemptsCount = currentAns.attempts + 1;
      const question = activeQuiz.questions.find((q) => q.id === qId);
      let isCorrect = false;
      let feedbackMsg = "";
      
      if (question.correct_answer && question.correct_answer !== "HIDDEN") {
        isCorrect = option === question.correct_answer;
        feedbackMsg = isCorrect ? "Chính xác!" : attemptsCount >= 2 ? "Hết lượt!" : "Sai rồi! Chọn lại lần nữa.";
      } else {
        isCorrect = true;
        feedbackMsg = "Đã lưu lựa chọn.";
      }
      
      return {
        ...prev,
        [qId]: {
          ...currentAns,
          selectedOption: option,
          attempts: attemptsCount,
          locked: isCorrect || attemptsCount >= 2,
          feedback: { correct: isCorrect, message: feedbackMsg },
        }
      };
    });
  };

  // Single Essay Check & Grade Draft (Integrated with Production Backend)
  const checkEssayAnswer = async (qId) => {
    const currentAns = sessionAnswers[qId];
    if (!currentAns || currentAns.locked || currentAns.attempts >= 3) return;

    const draft = currentAns.draftText.trim();
    if (!draft) return;

    // Avoid duplicate check if draft text matches the last submitted draft
    const lastDraft = currentAns.drafts.length > 0 ? currentAns.drafts[currentAns.drafts.length - 1] : '';
    if (draft === lastDraft) return;

    const updatedAttempts = currentAns.attempts + 1;
    const updatedDrafts = [...currentAns.drafts, draft];
    
    addToast(`Đang gửi chấm tự luận lượt ${updatedAttempts}/3 bằng AI...`, "info");
    
    try {
      const res = await fetch(`${API_BASE_URL}/attempts/grade-essay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: qId,
          student_answer: draft,
          api_key: settings.apiKey,
          ai_provider: settings.provider,
          ai_model: settings.model,
        }),
      });

      if (!res.ok) throw new Error("Backend server error during draft grading");
      const result = await res.json();
      
      const isCorrect = result.correct === true;
      const feedbackMsg = result.feedback || "Chưa đạt yêu cầu.";

      setSessionAnswers((prev) => ({
        ...prev,
        [qId]: {
          ...prev[qId],
          drafts: updatedDrafts,
          attempts: updatedAttempts,
          locked: isCorrect || updatedAttempts >= 3,
          feedback: { correct: isCorrect, message: isCorrect ? "Hoàn toàn chính xác!" : updatedAttempts >= 3 ? "Đã hết 3 lượt thử. Vui lòng chuyển câu!" : `Chưa chính xác: ${feedbackMsg} (Còn ${3 - updatedAttempts} cơ hội)` },
        },
      }));

      if (isCorrect) {
        addToast("Câu trả lời tự luận chính xác! Đã mở khóa.", "success");
      } else {
        if (updatedAttempts >= 3) {
          addToast("Đã khóa câu hỏi do hết 3 lượt thử!", "error");
        } else {
          addToast(`Chưa đạt yêu cầu. Bạn còn ${3 - updatedAttempts} lượt thử.`, "warning");
        }
      }
    } catch (err) {
      console.error(err);
      setSessionAnswers((prev) => ({
        ...prev,
        [qId]: {
          ...prev[qId],
          drafts: updatedDrafts,
          attempts: updatedAttempts,
          locked: updatedAttempts >= 3,
          feedback: { correct: false, message: `Lưu nháp thành công (Lỗi chấm điểm: ${err.message})` },
        },
      }));
      addToast("Lỗi AI chấm điểm. Đã lưu nháp.", "warning");
    }
  };

  const submitEssayDraft = (qId) => {
    return checkEssayAnswer(qId);
  };

  const canMoveToNext = () => {
    const q = activeQuiz.questions[activeQuestionIndex];
    const ans = sessionAnswers[q.id];
    if (!ans) return false;
    return ans.locked;
  };

  const canJumpTo = (targetIndex) => {
    if (targetIndex <= activeQuestionIndex) return true;
    for (let i = 0; i < targetIndex; i++) {
      const q = activeQuiz.questions[i];
      const ans = sessionAnswers[q.id];
      if (!ans) return false;
      if (!ans.locked) return false;
    }
    return true;
  };

  // Submit Quiz Entirely
  const confirmSubmitQuiz = () => {
    if (window.confirm("Bạn có chắc chắn muốn nộp toàn bộ bài làm của mình không?")) {
      submitQuizAndGrade();
    }
  };

  const autoSubmitQuiz = (quiz, answersState) => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    submitQuizAndGrade(quiz, answersState);
  };

  const submitQuizAndGrade = async (quizToSubmit = activeQuiz, answersToSubmit = sessionAnswers) => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    
    setIsGenerating(true);
    setGeneratingStatus("Đang chấm bài thi bằng AI...");
    setCurrentView("dashboard"); // temporary block

    const actualQuiz = quizToSubmit;
    const actualAnswers = answersToSubmit;
    const timeSpent = examStartSeconds - timerSeconds;

    // Prepare API submission payload
    const answersPayload = Object.keys(actualAnswers).map((qId) => {
      const ans = actualAnswers[qId];
      return {
        question_id: qId,
        selected_option: ans.selectedOption || null,
        drafts: ans.drafts.length > 0 ? ans.drafts : ans.draftText ? [ans.draftText] : [],
        attempts_count: ans.attempts,
      };
    });

    try {
      const res = await fetch(`${API_BASE_URL}/attempts/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quiz_id: actualQuiz.id,
          time_spent_seconds: timeSpent,
          answers: answersPayload,
          api_key: settings.apiKey,
          ai_provider: settings.provider,
          ai_model: settings.model,
        }),
      });

      if (!res.ok) throw new Error("Backend server error during grading");
      const gradingReport = await res.json();
      
      setGradingResult(gradingReport);
      addToast("Bài thi đã được chấm điểm thành công!", "success");
      setCurrentView("grading_report");
    } catch (err) {
      console.error(err);
      addToast("Lỗi chấm điểm bài thi: " + err.message, "error");
    } finally {
      setIsGenerating(false);
    }
  };

  // Retake quiz
  const retakeQuiz = async (quizId) => {
    try {
      setIsGenerating(true);
      setGeneratingStatus("Đang tải dữ liệu đề thi...");
      
      const res = await fetch(`${API_BASE_URL}/quizzes/${quizId}`);
      if (!res.ok) throw new Error("Không thể lấy đề thi này từ backend");
      
      const quiz = await res.json();
      setActiveQuiz(quiz);
      startQuizSession(quiz);
    } catch (err) {
      addToast("Lỗi làm lại đề: " + err.message, "error");
    } finally {
      setIsGenerating(false);
    }
  };

  // Bubble CSS mapper
  const getBubbleClass = (qId, type) => {
    const ans = sessionAnswers[qId];
    if (!ans) return "bg-gray-800 border-gray-700 text-gray-400";

    if (type === "multiple_choice") {
      if (ans.locked) {
        return ans.feedback?.correct
          ? "bg-green-500/15 border-green-600/50 text-green-400"
          : "bg-red-500/15 border-red-600/50 text-red-400";
      }
      if (ans.attempts > 0) return "bg-amber-500/15 border-amber-600/50 text-amber-400";
      return ans.selectedOption ? "bg-brand-500/15 border-brand-600/50 text-brand-400" : "bg-gray-800 border-gray-700 text-gray-400";
    } else {
      if (ans.locked) {
        return ans.feedback?.correct
          ? "bg-green-500/15 border-green-600/50 text-green-400"
          : "bg-red-500/15 border-red-600/50 text-red-400";
      }
      if (ans.drafts.length > 0) return "bg-amber-500/15 border-amber-600/50 text-amber-400";
      return ans.draftText.trim() ? "bg-brand-500/15 border-brand-600/50 text-brand-400" : "bg-gray-800 border-gray-700 text-gray-400";
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0f19] text-gray-100 font-sans">
      {/* Toasts */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2 max-w-md">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 border ${
              toast.type === "success"
                ? "bg-green-950/90 border-green-700 text-green-200"
                : toast.type === "error"
                ? "bg-red-950/90 border-red-700 text-red-200"
                : "bg-blue-950/90 border-blue-700 text-blue-200"
            }`}
          >
            <i className={`fas ${toast.type === "success" ? "fa-circle-check" : toast.type === "error" ? "fa-triangle-exclamation" : "fa-circle-info"}`}></i>
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-950/70 backdrop-blur border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentView("dashboard")}>
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white shadow-lg">
              <i className="fas fa-brain-circuit text-lg"></i>
            </div>
            <div>
              <h1 className="font-extrabold text-xl bg-clip-text text-transparent bg-gradient-to-r from-brand-100 to-brand-500">Smart Quiz Production</h1>
              <p class="text-[10px] text-gray-500">FastAPI & React RAG Engine</p>
            </div>
          </div>

          <nav className="flex items-center gap-6">
            <button
              onClick={() => setCurrentView("dashboard")}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition ${
                currentView === "dashboard" ? "bg-brand-600/20 text-brand-400" : "text-gray-300 hover:text-white"
              }`}
            >
              Trang chủ
            </button>
            <button
              onClick={() => setCurrentView("history")}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition ${
                currentView === "history" ? "bg-brand-600/20 text-brand-400" : "text-gray-300 hover:text-white"
              }`}
            >
              Lịch sử làm bài
            </button>
            <button onClick={() => setShowSettings(true)} className="px-3 py-2 text-sm font-semibold text-gray-300 hover:text-white rounded-lg hover:bg-gray-800 flex items-center gap-2">
              <i className="fas fa-cog"></i>Cài đặt
              {!hasApiKey && <span className="w-2 h-2 bg-red-500 rounded-full"></span>}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        
        {/* Loading Spinner blocker */}
        {isGenerating && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="font-bold text-lg text-brand-400 animate-pulse">{generatingStatus}</p>
          </div>
        )}

        {/* API Warning */}
        {!hasApiKey && (
          <div className="bg-amber-950/30 border border-amber-800/60 p-4 rounded-xl flex items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-amber-200">Chưa cấu hình API Key</h4>
              <p className="text-sm text-amber-300/80">Bạn cần thiết lập API Key trong menu Cài đặt để ứng dụng giao tiếp với LLM.</p>
            </div>
            <button onClick={() => setShowSettings(true)} className="bg-amber-500 hover:bg-amber-600 text-gray-900 px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap">
              Cấu hình ngay
            </button>
          </div>
        )}

        {/* View: Dashboard */}
        {currentView === "dashboard" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 flex flex-col gap-5 bg-gray-900/40 p-6 rounded-2xl border border-white/5">
              <h2 className="text-lg font-bold text-brand-500 flex items-center gap-2">
                <i className="fas fa-file-invoice"></i>1. Mô-đun Xử lý Tài liệu
              </h2>
              
              {/* File Upload Zone */}
              <div
                className="border-2 border-dashed border-gray-700 hover:border-brand-500 rounded-xl p-8 text-center cursor-pointer hover:bg-gray-800/20 transition flex flex-col items-center justify-center gap-2"
                onClick={() => fileInputRef.current.click()}
              >
                <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.txt,.docx" onChange={handleFileChange} />
                <i className="fas fa-cloud-arrow-up text-3xl text-gray-400"></i>
                <p className="font-bold text-sm">Kéo thả tài liệu hoặc nhấp để chọn tệp</p>
                <p className="text-xs text-gray-500">PDF, Word hoặc TXT</p>
                {isReadingFile && <div className="w-24 h-1 bg-brand-500 rounded animate-pulse mt-2"></div>}
              </div>

              {selectedFile && (
                <div className="bg-gray-800/40 p-3 rounded-lg flex items-center justify-between border border-gray-700">
                  <span className="text-sm font-semibold truncate max-w-sm"><i className="fas fa-file-circle-check text-green-400 mr-2"></i>{selectedFile.name}</span>
                  <button onClick={clearFile} className="text-xs text-red-400 font-bold hover:bg-red-500/10 px-2 py-1 rounded">Gỡ bỏ</button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-gray-300">Hoặc dán văn bản trực tiếp:</label>
                <textarea
                  value={directText}
                  onChange={(e) => setDirectText(e.target.value)}
                  className="w-full h-44 bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm focus:outline-none focus:border-brand-500"
                  placeholder="Dán nội dung học tập..."
                />
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col justify-between bg-gray-900/40 p-6 rounded-2xl border border-white/5">
              <div className="flex flex-col gap-5">
                <h2 className="text-lg font-bold text-brand-500 flex items-center gap-2">
                  <i className="fas fa-sliders"></i>2. Cấu hình Đề thi
                </h2>
                
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-bold uppercase">Môn học:</label>
                  <select
                    value={config.subject}
                    onChange={(e) => setConfig((prev) => ({ ...prev, subject: e.target.value }))}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:outline-none focus:border-brand-500"
                  >
                    <option value="Tự động phát hiện">Tự động phát hiện (Từ tài liệu)</option>
                    <option value="Toán học">Toán học</option>
                    <option value="Vật lý">Vật lý</option>
                    <option value="Hóa học">Hóa học</option>
                    <option value="Sinh học">Sinh học</option>
                    <option value="Ngữ văn">Ngữ văn</option>
                    <option value="Tiếng Anh">Tiếng Anh</option>
                    <option value="Khác">Môn khác</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-bold uppercase">Hình thức:</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["multiple_choice", "essay", "hybrid"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setConfig((prev) => ({ ...prev, type: t }))}
                        className={`p-2 text-xs font-bold rounded-lg border capitalize transition ${
                          config.type === t ? "border-brand-500 bg-brand-500/10 text-brand-400" : "border-gray-800 bg-gray-950 text-gray-400"
                        }`}
                      >
                        {t === "multiple_choice" ? "Trắc nghiệm" : t === "essay" ? "Tự luận" : "Kết hợp"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <label className="font-semibold text-gray-300">Số lượng câu:</label>
                    <span className="font-bold text-brand-400">{config.questionCount} câu</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="20"
                    value={config.questionCount}
                    onChange={(e) => setConfig((prev) => ({ ...prev, questionCount: parseInt(e.target.value) }))}
                    className="w-full accent-brand-500 bg-gray-800"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <label className="font-semibold text-gray-300">Thời gian làm bài:</label>
                    <span className="font-bold text-brand-400">{config.duration} phút</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="90"
                    step="5"
                    value={config.duration}
                    onChange={(e) => setConfig((prev) => ({ ...prev, duration: parseInt(e.target.value) }))}
                    className="w-full accent-brand-500 bg-gray-800"
                  />
                </div>
              </div>

              <button
                onClick={handleGenerateQuiz}
                disabled={!selectedFile && directText.trim().length < 50}
                className="w-full mt-6 bg-brand-600 hover:bg-brand-500 disabled:bg-gray-800 disabled:text-gray-500 font-extrabold py-3.5 rounded-xl transition shadow-lg flex items-center justify-center gap-2"
              >
                <i className="fas fa-wand-magic-sparkles"></i>Bắt đầu Tạo Đề bằng AI
              </button>
            </div>
          </div>
        )}

        {/* View: Quiz session */}
        {currentView === "quiz_session" && activeQuiz && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 flex flex-col bg-gray-900/40 p-6 rounded-2xl border border-white/5 min-h-[450px]">
              {/* Active question header */}
              <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-5">
                <span className="bg-brand-600/35 border border-brand-500/50 text-brand-300 font-extrabold text-xs px-2.5 py-1 rounded">
                  CÂU HỎI {activeQuestionIndex + 1} / {activeQuiz.questions.length}
                </span>
                <span className="text-xs text-gray-400">
                  Lượt: {sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.attempts}/
                  {activeQuiz.questions[activeQuestionIndex].question_type === "multiple_choice" ? "2" : "3"}
                </span>
              </div>

              {/* Question content */}
              <div className="flex-1 flex flex-col gap-6">
                <p className="font-bold text-lg leading-relaxed">{activeQuiz.questions[activeQuestionIndex].question_text}</p>

                {/* Multiple choice options */}
                {activeQuiz.questions[activeQuestionIndex].question_type === "multiple_choice" && (
                  <div className="flex flex-col gap-2.5">
                    {Object.entries(activeQuiz.questions[activeQuestionIndex].options || {}).map(([key, val]) => (
                      <div
                        key={key}
                        onClick={() => selectOption(activeQuiz.questions[activeQuestionIndex].id, key)}
                        className={`p-3 rounded-lg border cursor-pointer flex items-center gap-3 transition ${
                          sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.selectedOption === key
                            ? "bg-brand-500/10 border-brand-500"
                            : "bg-gray-950 border-gray-800 hover:bg-gray-800"
                        } ${sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.locked ? "opacity-70 pointer-events-none" : ""}`}
                      >
                        <span className="w-7 h-7 rounded bg-gray-800 border border-gray-700 flex items-center justify-center font-bold text-xs">{key}</span>
                        <span className="text-sm font-medium">{val}</span>
                      </div>
                    ))}

                    <div className="mt-4 flex items-center gap-4">
                      {sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.feedback && (
                        <span className={`text-xs font-bold ${sessionAnswers[activeQuiz.questions[activeQuestionIndex].id].feedback.correct ? "text-green-400" : "text-red-400"}`}>
                          {sessionAnswers[activeQuiz.questions[activeQuestionIndex].id].feedback.message}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Essay textbox */}
                {activeQuiz.questions[activeQuestionIndex].question_type === "essay" && (
                  <div className="flex flex-col gap-4">
                    <textarea
                      value={sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.draftText || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSessionAnswers((prev) => ({
                          ...prev,
                          [activeQuiz.questions[activeQuestionIndex].id]: { ...prev[activeQuiz.questions[activeQuestionIndex].id], draftText: val },
                        }));
                      }}
                      onBlur={() => checkEssayAnswer(activeQuiz.questions[activeQuestionIndex].id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          checkEssayAnswer(activeQuiz.questions[activeQuestionIndex].id);
                        }
                      }}
                      disabled={sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.locked}
                      className="w-full h-40 bg-gray-950 border border-gray-850 rounded-lg p-3 text-sm focus:outline-none focus:border-brand-500"
                      placeholder="Viết lời giải tự luận tại đây... (Tự động nộp và chấm điểm khi click ra ngoài hoặc nhấn Ctrl+Enter)"
                    />

                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => checkEssayAnswer(activeQuiz.questions[activeQuestionIndex].id)}
                        disabled={sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.locked || !sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.draftText?.trim()}
                        className="bg-brand-600 hover:bg-brand-500 disabled:bg-gray-800 disabled:text-gray-500 text-xs font-bold px-4 py-2.5 rounded-lg transition"
                      >
                        Nộp bài làm (Còn {3 - (sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.attempts || 0)} lượt)
                      </button>
                      <span className="text-xs font-semibold text-brand-400">
                        <i className="fas fa-robot mr-1"></i>Tự động nộp & chấm nháp bằng AI
                      </span>
                    </div>

                    {sessionAnswers[activeQuiz.questions[activeQuestionIndex].id]?.feedback && (
                      <div className="mt-2">
                        <span className={`text-xs font-bold ${sessionAnswers[activeQuiz.questions[activeQuestionIndex].id].feedback.correct ? "text-green-400" : "text-red-400"}`}>
                          {sessionAnswers[activeQuiz.questions[activeQuestionIndex].id].feedback.message}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Navigation buttons */}
              <div className="flex justify-between items-center pt-4 border-t border-gray-800 mt-6">
                <button
                  onClick={() => setActiveQuestionIndex((prev) => Math.max(prev - 1, 0))}
                  disabled={activeQuestionIndex === 0}
                  className="text-xs font-bold text-gray-400 disabled:opacity-30 hover:text-white"
                >
                  <i className="fas fa-chevron-left mr-2"></i>Câu trước
                </button>
                <button
                  onClick={() => setActiveQuestionIndex((prev) => Math.min(prev + 1, activeQuiz.questions.length - 1))}
                  disabled={activeQuestionIndex === activeQuiz.questions.length - 1 || !canMoveToNext()}
                  className="text-xs font-bold text-brand-400 disabled:opacity-30 hover:text-brand-300"
                >
                  Câu sau<i className="fas fa-chevron-right ml-2"></i>
                </button>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-6">
              {/* Timer Display */}
              <div className="bg-gray-900/40 p-5 rounded-2xl border border-white/5 text-center flex flex-col items-center gap-3">
                <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Thời gian còn lại</span>
                <div className={`text-3xl font-extrabold font-mono ${timerSeconds < 60 ? "text-red-500 animate-pulse" : "text-gray-100"}`}>
                  {formatTimer(timerSeconds)}
                </div>
                <button onClick={confirmSubmitQuiz} className="w-full mt-2 bg-green-600 hover:bg-green-500 text-white font-extrabold py-2.5 rounded-xl transition">
                  Nộp toàn bộ bài thi
                </button>
              </div>

              {/* Bubble Grid mapping */}
              <div className="bg-gray-900/40 p-5 rounded-2xl border border-white/5 flex flex-col gap-3">
                <span className="text-sm font-bold">Bản đồ câu hỏi</span>
                <div className="grid grid-cols-5 gap-2">
                  {activeQuiz.questions.map((q, index) => (
                    <button
                      key={q.id}
                      onClick={() => { if (canJumpTo(index)) setActiveQuestionIndex(index); }}
                      className={`w-full aspect-square rounded-xl border flex flex-col items-center justify-center font-bold text-xs transition ${
                        activeQuestionIndex === index ? "ring-2 ring-brand-500" : ""
                      } ${!canJumpTo(index) ? "opacity-50 cursor-not-allowed" : "hover:scale-105"} ${getBubbleClass(q.id, q.question_type)}`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View: Grading Report */}
        {currentView === "grading_report" && gradingResult && activeQuiz && (
          <div className="flex flex-col gap-6">
            <div className="bg-gray-900/40 p-6 rounded-2xl border border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="w-20 h-20 rounded-full bg-brand-500/10 border-4 border-brand-500 flex items-center justify-center font-black text-2xl text-brand-400">
                  {gradingResult.score.toFixed(1)}
                </div>
                <div>
                  <h2 className="text-xl font-bold">Kết quả ôn tập: {activeQuiz.title}</h2>
                  <p className="text-xs text-gray-400 mt-1">Môn học: {activeQuiz.subject} | Thời gian làm bài: {Math.ceil(gradingResult.timeSpentSeconds / 60)} phút</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <button onClick={() => retakeQuiz(activeQuiz.id)} className="bg-brand-600 hover:bg-brand-500 text-white font-bold py-2 px-4 rounded-lg text-sm transition">Làm lại</button>
                <button onClick={() => setCurrentView("dashboard")} className="bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded-lg text-sm transition">Trang chủ</button>
              </div>
            </div>

            {/* Questions breakdown */}
            <div className="flex flex-col gap-4">
              <h3 className="font-bold text-lg text-gray-300">Chi tiết kết quả chấm điểm</h3>
              
              {activeQuiz.questions.map((q, idx) => {
                const detail = gradingResult.details.find((d) => d.question_id === q.id) || {};
                const score = detail.final_score || 0;
                
                return (
                  <div key={q.id} className="bg-gray-900/40 p-5 rounded-xl border border-white/5 flex flex-col gap-3">
                    <div className="flex justify-between items-center border-b border-gray-850 pb-2">
                      <span className="font-bold text-xs text-brand-400">Câu hỏi {idx + 1} ({q.question_type === "multiple_choice" ? "Trắc nghiệm" : "Tự luận"})</span>
                      <span className={`text-xs font-black px-2 py-0.5 rounded border ${
                        score === q.max_score ? "bg-green-950/60 border-green-700 text-green-300" : "bg-red-950/60 border-red-700 text-red-300"
                      }`}>
                        Điểm: {score.toFixed(1)} / {q.max_score.toFixed(1)}
                      </span>
                    </div>

                    <p className="font-semibold text-sm leading-relaxed text-gray-200">{q.question_text}</p>

                    {/* MCQ Choices comparison */}
                    {q.question_type === "multiple_choice" && (
                      <div className="text-xs text-gray-400 flex flex-col gap-1.5 mt-2">
                        {Object.entries(q.options || {}).map(([key, value]) => (
                          <div key={key} className={`p-2 rounded flex items-center justify-between ${
                            key === q.correct_answer ? "bg-green-950/30 border border-green-800 text-green-300" : ""
                          }`}>
                            <span><strong>{key}.</strong> {value}</span>
                            {key === q.correct_answer && <span className="font-bold"><i className="fas fa-circle-check mr-1"></i>Đáp án mẫu</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Essay answer and AI Grading feedbacks */}
                    {q.question_type === "essay" && (
                      <div className="flex flex-col gap-3 mt-2">
                        <div className="bg-gray-950 p-3 rounded-lg border border-gray-850">
                          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1">Đáp án của học sinh:</span>
                          <p className="text-xs text-gray-300 italic">"{detail.answers_history?.[detail.answers_history.length - 1]?.selected || "(Trống)"}"</p>
                        </div>

                        {detail.ai_feedback && (
                          <div className="bg-brand-950/30 p-3 rounded-lg border border-brand-900 text-xs text-gray-300">
                            <span className="font-bold text-brand-400 block mb-1"><i className="fas fa-sparkles mr-1"></i>Nhận xét từ AI Chấm thi:</span>
                            <p>{detail.ai_feedback}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* View: History */}
        {currentView === "history" && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-2xl font-bold">Lịch sử làm bài thi</h2>
                <p className="text-xs text-gray-400 mt-1">Quản lý và ôn lại các đề thi đã làm trên hệ thống.</p>
              </div>

              <div className="flex gap-2">
                <button onClick={clearAllHistory} className="bg-red-950/40 text-red-400 border border-red-900/50 text-xs font-bold px-3 py-2 rounded-lg transition hover:bg-red-950">
                  Xóa tất cả
                </button>
              </div>
            </div>

            {historyList.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {historyList.map((item) => (
                  <div key={item.id} className="bg-gray-900/40 p-4 rounded-xl border border-white/5 flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-gray-500 font-bold">{new Date(item.submittedAt || item.submitted_at).toLocaleDateString()}</span>
                        <span className="bg-brand-500/10 text-brand-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-brand-500/20">Đạt điểm: {item.score.toFixed(1)}/10</span>
                      </div>
                      <h4 className="font-bold text-sm text-gray-200 mt-2 line-clamp-2">Lượt làm bài #{item.id.slice(0, 8)}</h4>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-gray-850 pt-3">
                      <button onClick={() => retakeQuiz(item.quiz_id)} className="bg-brand-600/20 text-brand-400 text-xs font-bold px-3 py-1.5 rounded-lg border border-brand-500/20 hover:bg-brand-600 hover:text-white transition">
                        Làm lại
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center p-12 bg-gray-900/20 rounded-xl border border-dashed border-gray-800">
                <p className="text-gray-500 text-sm">Chưa có lịch sử làm bài thi.</p>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setShowSettings(false)}></div>
          <div className="bg-[#111827] border border-white/10 max-w-sm w-full rounded-2xl p-6 relative z-10 flex flex-col gap-4">
            <h3 className="font-bold text-lg"><i className="fas fa-key text-brand-500 mr-2"></i>Cài đặt Cấu hình AI</h3>
            
            <div className="flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-gray-400">AI Provider:</label>
                <div className="grid grid-cols-2 gap-2">
                  {["gemini", "openai"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setSettings((prev) => ({ ...prev, provider: p, model: p === "gemini" ? "gemini-3.5-flash" : "gpt-4o-mini" }))}
                      className={`p-2 rounded border font-bold capitalize transition ${
                        settings.provider === p ? "border-brand-500 bg-brand-500/10 text-brand-400" : "border-gray-800 bg-gray-950 text-gray-500"
                      }`}
                    >
                      {p === "gemini" ? "Google Gemini" : "OpenAI"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-gray-400">API Key:</label>
                <input
                  type={showApiKey ? "text" : "password"}
                  value={settings.apiKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                  className="w-full bg-gray-950 border border-gray-850 p-2.5 rounded focus:outline-none focus:border-brand-500 text-gray-300 font-mono"
                  placeholder="Dán API Key..."
                />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="text-[10px] text-right text-gray-500 hover:text-white mt-1">
                  {showApiKey ? "Ẩn" : "Hiện"} API Key
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-gray-400">Model:</label>
                <select
                  value={settings.model}
                  onChange={(e) => setSettings((prev) => ({ ...prev, model: e.target.value }))}
                  className="w-full bg-gray-950 border border-gray-850 p-2 rounded text-gray-300"
                >
                  {settings.provider === "gemini" ? (
                    <>
                      <option value="gemini-3.5-flash">gemini-3.5-flash (Khuyên dùng)</option>
                      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                      <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                      <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                    </>
                  ) : (
                    <>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="gpt-4o">gpt-4o</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-850 text-sm font-semibold">
              <button onClick={saveSettings} className="flex-1 bg-brand-600 hover:bg-brand-500 py-2.5 rounded-lg text-white">Lưu</button>
              <button onClick={() => setShowSettings(false)} className="bg-gray-800 hover:bg-gray-700 py-2.5 px-4 rounded-lg text-gray-400">Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
