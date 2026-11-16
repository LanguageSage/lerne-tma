import { getPrimaryKnowledgeItemForCard, enqueueKnowledgeAttempt, createKnowledgeAttempt, resolveAwaitingKnowledgeAttempts } from './knowledgeDbService.js';
import { studyContent } from '../utils/structuredStudyCard.js';
import { getLocalDb } from './localDb.js';
import { getUserId } from '../utils/auth.js';
import { waitForDeckKnowledge } from './knowledgeContentService.js';

const STANDARD_GRADE_RATINGS = ['again', 'hard', 'good', 'easy'];

export const knowledgeRatingForGrade = (grade, isExtended) => (
  isExtended ? `ext_${grade}` : STANDARD_GRADE_RATINGS[grade] ?? `unknown_${grade}`
);

export const captureStudyKnowledgeAttempt = async ({ userId, card, grade, isExtended, eventTime, exerciseEvidence }) => {
  // Feature flag via env (defaults to true if not explicitly 'false')
  if (import.meta.env && import.meta.env.VITE_KNOWLEDGE_LAYER_ENABLED === 'false') return;

  if (!card || !userId || String(getUserId()) !== String(userId)) return;

  try {
    const database = getLocalDb();
    const supportFields = exerciseEvidence?.supportEvidence ? {
      support_evidence: structuredClone(exerciseEvidence.supportEvidence),
      ...(exerciseEvidence.taskSupport ? { task_support: structuredClone(exerciseEvidence.taskSupport) } : {}),
    } : {};
    const ratingStr = knowledgeRatingForGrade(grade, isExtended);

    const cardType = studyContent(card)?.type;

    let evaluationData;

    if (exerciseEvidence) {
      // It's a hybrid evaluation (objective evidence + self_rating)
      evaluationData = {
        schema_version: 2,
        card_type: cardType,
        evaluation_type: 'hybrid',
        correct: exerciseEvidence.isCorrect ?? null,
        score: null, // Partial score not yet implemented by Lerne evaluators
        rating: ratingStr,
        knowledge_role: 'primary',
        knowledge_difficulty: null,
        exercise_evidence: {
          auto_evaluated: true,
          completed: typeof exerciseEvidence.completed === 'boolean' ? exerciseEvidence.completed : Boolean(exerciseEvidence.isCorrect),
          first_try_correct: Boolean(exerciseEvidence.isFirstTry),
          attempt_count: exerciseEvidence.attemptCount,
          mistake_count: exerciseEvidence.mistakeCount,
          partial_score: null,
          ...supportFields,
          ...(exerciseEvidence.gradingSummary ? { grading_summary: exerciseEvidence.gradingSummary } : {})
        }
      };
    } else {
      // Standard self-rated flashcard
      evaluationData = {
        schema_version: 1,
        card_type: cardType,
        evaluation_type: 'self_rating',
        correct: null,
        score: null,
        rating: ratingStr,
        knowledge_role: 'primary',
        knowledge_difficulty: null
      };
    }

    const payload = {
      user_id: userId,
      card_id: card.id,
      review_id: null, // Offline local DB doesn't produce TMAReviewHistory ids synchronously
      event_time: eventTime || new Date().toISOString(),
      evaluation_data: structuredClone(evaluationData)
    };

    const preparing = waitForDeckKnowledge(database, card.deck_id);
    if (preparing) {
      // Persist before waiting: a reload/network failure must not discard a
      // confirmed grade's evidence. The sync service resumes it after reload.
      await enqueueKnowledgeAttempt({ ...payload, client_event_id: crypto.randomUUID(),
        knowledge_item_id: null, _knowledge_deck_id: card.deck_id, sync_status: 'awaiting_content' }, database);
      try { await preparing; } catch { return; }
      if (String(getUserId()) === String(userId)) await resolveAwaitingKnowledgeAttempts(database, card.deck_id, userId);
      return;
    }
    const primaryKi = await getPrimaryKnowledgeItemForCard(card.id, database);
    if (!primaryKi) {
      console.log(`[KnowledgeCapture] no_primary_knowledge_item for card ${card.id}`);
      return;
    }
    const attempt = createKnowledgeAttempt({ ...payload, knowledge_item_id: primaryKi.id });

    if (String(getUserId()) !== String(userId)) return;
    await enqueueKnowledgeAttempt(attempt, database);
  } catch (error) {
    // Rule 6: Knowledge Layer никогда не должен блокировать обучение
    console.error("[KnowledgeCapture] Error capturing attempt:", error);
  }
};
