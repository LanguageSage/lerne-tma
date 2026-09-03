import { create } from 'zustand';
import rawQuestionsData from '../data/lidQuestions.json';

const STORAGE_LAND_KEY = 'lerne_lid_selected_land';
const STORAGE_REMEMBER_KEY = 'lerne_lid_remember_land';

// Helper to pick N random items from an array without replacement
const pickRandom = (array, count) => {
  if (!array || array.length <= count) return [...(array || [])];
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

export const useLidStore = create((set, get) => ({
  // Land selection
  selectedLandCode: localStorage.getItem(STORAGE_LAND_KEY) || null,
  rememberLandChoice: localStorage.getItem(STORAGE_REMEMBER_KEY) === 'true',
  isLandModalOpen: false,
  isLandChangeMode: false,
  pendingExamMode: null, // 'exam' | 'practice' | null
  setPendingExamMode: (mode) => set({ pendingExamMode: mode }),

  // Exam flow
  examMode: 'exam', // 'exam' | 'practice'
  screen: 'menu', // 'menu' | 'running' | 'results'
  currentQuestionIndex: 0,
  questions: [],
  answers: {}, // { [questionId]: optionId ('a'|'b'|'c'|'d') }
  timeRemaining: 3600, // 60 minutes in seconds
  timeSpent: 0,
  isTimerActive: false,

  // Modal for inspecting specific mistake on results screen
  selectedMistakeCard: null,
  setSelectedMistakeCard: (card) => set({ selectedMistakeCard: card }),

  // Modal controls
  openLandModal: (isChangeMode = false) => {
    set({ isLandModalOpen: true, isLandChangeMode: isChangeMode });
  },

  closeLandModal: () => {
    set({ isLandModalOpen: false, isLandChangeMode: false, pendingExamMode: null });
  },

  selectLand: (code, remember = true) => {
    if (remember) {
      localStorage.setItem(STORAGE_LAND_KEY, code);
      localStorage.setItem(STORAGE_REMEMBER_KEY, 'true');
    } else {
      localStorage.removeItem(STORAGE_LAND_KEY);
      localStorage.setItem(STORAGE_REMEMBER_KEY, 'false');
    }
    const pending = get().pendingExamMode;
    set({
      selectedLandCode: code,
      rememberLandChoice: remember,
      isLandModalOpen: false,
      isLandChangeMode: false,
      pendingExamMode: null
    });
    if (pending) {
      get().startSimulation(pending, code);
    }
  },

  // Generates 33 random questions: 10 from 1-100, 10 from 101-200, 10 from 201-300, 3 from selected Bundesland
  generateExamTicket: (stateCode) => {
    const allQuestions = rawQuestionsData.questions || [];
    const targetState = stateCode || get().selectedLandCode || 'BY';

    const block1 = allQuestions.filter(q => q.block === 1);
    const block2 = allQuestions.filter(q => q.block === 2);
    const block3 = allQuestions.filter(q => q.block === 3);
    const stateQuestions = allQuestions.filter(
      q => q.block === 'state' && q.stateCode?.toUpperCase() === targetState?.toUpperCase()
    );

    const picked1 = pickRandom(block1, 10);
    const picked2 = pickRandom(block2, 10);
    const picked3 = pickRandom(block3, 10);
    const pickedState = pickRandom(stateQuestions, 3);

    // Combine into 33 questions with assigned ticket index (1..33)
    const combined = [...picked1, ...picked2, ...picked3, ...pickedState].map((q, idx) => ({
      ...q,
      examIndex: idx + 1
    }));

    return combined;
  },

  // Start Exam or Practice Mode
  startSimulation: (mode = 'exam', customLand = null) => {
    const targetLand = customLand || get().selectedLandCode;
    if (!targetLand) {
      set({ isLandModalOpen: true, isLandChangeMode: true, pendingExamMode: mode });
      return;
    }
    const ticket = get().generateExamTicket(targetLand);

    set({
      examMode: mode,
      screen: 'running',
      questions: ticket,
      answers: {},
      currentQuestionIndex: 0,
      timeRemaining: 3600,
      timeSpent: 0,
      isTimerActive: true,
      selectedMistakeCard: null,
      pendingExamMode: null
    });
  },

  // Retake only the missed questions in practice mode
  retakeMistakes: () => {
    const { questions, answers } = get();
    const mistakes = questions.filter(q => {
      const ans = answers[q.id];
      return ans !== q.correctOption;
    });

    if (mistakes.length === 0) return;

    set({
      examMode: 'practice',
      screen: 'running',
      questions: mistakes.map((q, idx) => ({ ...q, examIndex: idx + 1 })),
      answers: {},
      currentQuestionIndex: 0,
      timeRemaining: 3600,
      timeSpent: 0,
      isTimerActive: true,
      selectedMistakeCard: null
    });
  },

  // Navigation & Answers
  goToQuestion: (index) => {
    const { questions } = get();
    if (index >= 0 && index < questions.length) {
      set({ currentQuestionIndex: index });
    }
  },

  nextQuestion: () => {
    const { currentQuestionIndex, questions } = get();
    if (currentQuestionIndex < questions.length - 1) {
      set({ currentQuestionIndex: currentQuestionIndex + 1 });
    }
  },

  prevQuestion: () => {
    const { currentQuestionIndex } = get();
    if (currentQuestionIndex > 0) {
      set({ currentQuestionIndex: currentQuestionIndex - 1 });
    }
  },

  setAnswer: (questionId, optionId) => {
    set((state) => ({
      answers: {
        ...state.answers,
        [questionId]: optionId
      }
    }));
  },

  tickTimer: () => {
    const { timeRemaining, isTimerActive, finishSimulation } = get();
    if (!isTimerActive) return;

    if (timeRemaining <= 1) {
      finishSimulation();
    } else {
      set((state) => ({
        timeRemaining: state.timeRemaining - 1,
        timeSpent: state.timeSpent + 1
      }));
    }
  },

  finishSimulation: () => {
    set({
      screen: 'results',
      isTimerActive: false
    });
  },

  resetToMenu: () => {
    set({
      screen: 'menu',
      isTimerActive: false,
      questions: [],
      answers: {},
      selectedMistakeCard: null
    });
  },

  // Getters & computations
  getResults: () => {
    const { questions, answers, timeSpent } = get();
    let correctCount = 0;
    const mistakes = [];
    const correctList = [];

    questions.forEach((q) => {
      const userAns = answers[q.id];
      const isCorrect = userAns === q.correctOption;
      if (isCorrect) {
        correctCount++;
        correctList.push(q);
      } else {
        mistakes.push({
          question: q,
          userAnswer: userAns || null,
          correctOption: q.correctOption
        });
      }
    });

    const isPassed = correctCount >= 17;
    const totalQuestions = questions.length;
    const scorePercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    return {
      score: correctCount,
      total: totalQuestions,
      percent: scorePercent,
      isPassed,
      timeSpent,
      mistakes,
      correctList
    };
  }
}));
