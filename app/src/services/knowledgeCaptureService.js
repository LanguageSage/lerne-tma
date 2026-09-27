import { getPrimaryKnowledgeItemForCard, enqueueKnowledgeAttempt, createKnowledgeAttempt } from './knowledgeDbService.js';
import { detectExerciseType } from '../utils/exerciseDetector.js';

export const captureStudyKnowledgeAttempt = async ({ userId, card, grade, isExtended, eventTime, exerciseEvidence }) => {
  // Feature flag via env (defaults to true if not explicitly 'false')
  if (import.meta.env && import.meta.env.VITE_KNOWLEDGE_LAYER_ENABLED === 'false') return;

  if (!card || !userId) return;

  try {
    const primaryKi = await getPrimaryKnowledgeItemForCard(card.id);
    if (!primaryKi) {
      console.log(`[KnowledgeCapture] no_primary_knowledge_item for card ${card.id}`);
      return;
    }
    const primaryKiId = primaryKi.id;

    // Determine semantic rating string based on extended or standard
    let ratingStr;
    if (isExtended) {
      ratingStr = `ext_${grade}`;
    } else {
      ratingStr = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[grade] || `unknown_${grade}`;
    }

    const cardType = detectExerciseType(card, 'classic') || 'standard';

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
          completed: exerciseEvidence.isCorrect, // they only reach GradeButtons if they finally solved it
          first_try_correct: exerciseEvidence.isFirstTry,
          attempt_count: exerciseEvidence.attemptCount,
          mistake_count: exerciseEvidence.mistakeCount,
          partial_score: null
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

    const attempt = createKnowledgeAttempt({
      user_id: userId,
      knowledge_item_id: primaryKiId,
      card_id: card.id,
      review_id: null, // Offline local DB doesn't produce TMAReviewHistory ids synchronously
      event_time: eventTime || new Date().toISOString(),
      evaluation_data: evaluationData
    });

    await enqueueKnowledgeAttempt(attempt);
  } catch (error) {
    // Rule 6: Knowledge Layer никогда не должен блокировать обучение
    console.error("[KnowledgeCapture] Error capturing attempt:", error);
  }
};
