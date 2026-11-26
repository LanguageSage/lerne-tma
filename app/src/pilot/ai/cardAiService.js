import { validateNativeV2Content, nativeV2Version } from '../../utils/nativeV2Contract.js';
import { offlineApi } from '../../services/offlineApi.js';
import { resolveActiveAiSelection } from './registry.js';

const LANG_NAMES = {
  de: 'German',
  en: 'English',
  no: 'Norwegian (Bokmål)',
  nb: 'Norwegian (Bokmål)',
  uk: 'Ukrainian',
  ru: 'Russian',
};

const NATIVE_V2_TYPE_SPECS = `Native V2 card types (always return schema_version: 2 and a valid "card" object):
- standard: { type: "standard", data: { prompt: string, answer: string }, info: InfoBlock[], explanation: string, level: CEFR|null }
- theory: { type: "theory", data: { text: string, summary: string }, info: InfoBlock[], explanation: string, level: CEFR|null }
- trainer: { type: "trainer", data: { parts: Array<{type:"text",text:string}|{type:"input",answers:[string,...]}|{type:"choice",distractors:"auto"|null,options:[{text:string,correct:boolean},...]}>, back_note: string }, info: InfoBlock[], explanation: string, level: CEFR|null }
- quiz: { type: "quiz", data: { prompt: string, options: [{text:string,correct:boolean}, ... (>=2 unique options, >=1 correct)], back_note: string }, info: InfoBlock[], explanation: string, level: CEFR|null }
- match: { type: "match", data: { pairs: [{left:string,right:string}, ... (>=2 pairs, unique left and right)], back_note: string }, info: InfoBlock[], explanation: string, level: CEFR|null }
- puzzle: { type: "puzzle", data: { tokens: [string, ... (>=2 non-whitespace tokens)], translation: string }, info: InfoBlock[], explanation: string, level: CEFR|null }
- word_bank: { type: "word_bank", data: { options: [string, ... (unique)], parts: Array<{type:"text",text:string}|{type:"gap",option:integer_index}> }, info: InfoBlock[], explanation: string, level: CEFR|null }
- free_text: { type: "free_text", data: { prompt: string, sample_answer: string, accepted_answers: string[] }, info: InfoBlock[], explanation: string, level: CEFR|null }
- editable_text: { type: "editable_text", data: { source_text: string, correct_text: string, accepted_answers: string[] }, info: InfoBlock[], explanation: string, level: CEFR|null }
InfoBlock = { type: "note"|"hint"|"task"|"source"|"translation", text: string } | { type: "options", items: string[] }.
CEFR level is one of "A1", "A2", "B1", "B2", "C1", "C2".`;

export function parseStrictJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('ИИ вернул пустой ответ');
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : text;
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('ИИ вернул некорректный JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Ожидался JSON-объект от ИИ');
  }
  return parsed;
}

function langLabel(code) {
  const clean = String(code || 'de').trim().toLowerCase();
  return LANG_NAMES[clean] || clean.toUpperCase();
}

function mergePreservingAuthoredMedia(originalCard, aiCard) {
  const merged = {
    ...aiCard,
    type: originalCard?.type || aiCard?.type || 'standard',
    info: Array.isArray(aiCard?.info) ? aiCard.info : (originalCard?.info || []),
    explanation: typeof aiCard?.explanation === 'string' ? aiCard.explanation : (originalCard?.explanation || ''),
    level: aiCard?.level ?? originalCard?.level ?? null,
    data: aiCard?.data || originalCard?.data || {},
  };
  if (originalCard?.id != null) merged.id = originalCard.id;
  if (originalCard?.image) merged.image = originalCard.image;
  if (Array.isArray(originalCard?.layout)) merged.layout = originalCard.layout;
  if (originalCard?.metadata) merged.metadata = originalCard.metadata;
  return {
    schema_version: nativeV2Version,
    card: merged,
  };
}

function sanitizeCardInputForPrompt(envelope) {
  const card = envelope?.card || {};
  return {
    type: card.type || 'standard',
    data: card.data || {},
    info: card.info || [],
    explanation: card.explanation || '',
    level: card.level || null,
  };
}

export async function generateCardAction({
  phrase = '',
  contentV2 = null,
  targetLanguage = 'de',
  nativeLanguage = 'ru',
  actionType = 'full_card',
  userRequest = '',
  signal = undefined,
} = {}) {
  const { provider, model } = resolveActiveAiSelection();
  const targetName = langLabel(targetLanguage);
  const nativeName = langLabel(nativeLanguage);
  const inputEnvelope = contentV2 && typeof contentV2 === 'object'
    ? contentV2
    : {
      schema_version: nativeV2Version,
      card: {
        type: 'standard',
        data: { prompt: String(phrase || '').trim(), answer: '' },
        info: [],
        explanation: '',
        level: null,
      },
    };
  const originalCard = sanitizeCardInputForPrompt(inputEnvelope);

  let systemPrompt;
  let userPayload;

  if (actionType === 'explain_rule') {
    systemPrompt = [
      `You are a ${targetName} language tutor writing explanations in ${nativeName}.`,
      'Analyze the provided Native V2 flashcard and return strictly a JSON object: {"explanation": "...", "level": "A1|A2|B1|B2|C1|C2"}.',
      'Explain grammar, usage, articles, and concise examples cleanly in Markdown without repeating the raw JSON.',
    ].join('\n');
    userPayload = JSON.stringify({ card: originalCard }, null, 2);
  } else if (actionType === 'quiz_analysis') {
    systemPrompt = [
      `You are a ${targetName} language tutor writing explanations in ${nativeName}.`,
      NATIVE_V2_TYPE_SPECS,
      'Return strictly JSON matching the same Native V2 schema: {"schema_version": 2, "card": ...}.',
      `Preserve card.type ("${originalCard.type}") and keep existing correct answer choices unless clearly broken; explain why the correct option works and distractors are wrong inside card.explanation (in ${nativeName}) and card.data.back_note.`,
    ].join('\n\n');
    userPayload = JSON.stringify({ card: originalCard }, null, 2);
  } else if (actionType === 'custom_directive') {
    if (!String(userRequest || '').trim()) {
      throw new Error('Введите запрос для ИИ-редактирования карточки');
    }
    systemPrompt = [
      `You are editing a Lerne Native V2 ${targetName} flashcard (${nativeName} explanations).`,
      NATIVE_V2_TYPE_SPECS,
      'Return strictly JSON: {"schema_version": 2, "card": ...}.',
      `Apply the separate user_request while keeping card.type = "${originalCard.type}" valid under the Native V2 schema.`,
    ].join('\n\n');
    userPayload = JSON.stringify({ card: originalCard, user_request: String(userRequest).trim() }, null, 2);
  } else {
    systemPrompt = [
      `You are creating or enriching a Lerne Native V2 ${targetName} flashcard (${nativeName} translations & explanations).`,
      NATIVE_V2_TYPE_SPECS,
      'Return strictly JSON: {"schema_version": 2, "card": ...}.',
      `Keep card.type = "${originalCard.type}". Keep already-authored non-empty prompt/exercise structure, fill missing answers/translations/options/examples/explanation (in ${nativeName}) and CEFR level.`,
    ].join('\n\n');
    userPayload = JSON.stringify({ card: originalCard }, null, 2);
  }

  const rawText = await provider.generateChat({
    systemPrompt,
    userMessage: userPayload,
    model,
    temperature: actionType === 'explain_rule' ? 0.3 : 0.25,
    maxOutputTokens: 2048,
    jsonMode: true,
    signal,
  });

  const parsed = parseStrictJsonObject(rawText);
  let candidateEnvelope;

  if (actionType === 'explain_rule') {
    const explanation = String(parsed.explanation || parsed.card?.explanation || '').trim();
    if (!explanation) {
      throw new Error('ИИ не вернул текст пояснения');
    }
    const level = parsed.level || parsed.card?.level || originalCard.level;
    candidateEnvelope = mergePreservingAuthoredMedia(inputEnvelope.card, {
      ...originalCard,
      explanation,
      ...(level ? { level } : {}),
    });
  } else {
    const aiCard = parsed.card && typeof parsed.card === 'object' ? parsed.card : parsed;
    if (!aiCard || typeof aiCard !== 'object' || !aiCard.data) {
      throw new Error('Ответ ИИ не содержит структуру карточки Native V2 (card.data)');
    }
    candidateEnvelope = mergePreservingAuthoredMedia(inputEnvelope.card, aiCard);
  }

  validateNativeV2Content(candidateEnvelope, { writable: true });
  return { status: 'ok', content_v2: candidateEnvelope, provider: provider.id, model };
}

export async function generateBatchStandardCards({
  text = '',
  deckId = null,
  targetLanguage = 'de',
  nativeLanguage = 'ru',
  signal = undefined,
} = {}) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error('Введите хотя бы одну фразу для пакетной генерации');
  }
  const limited = lines.slice(0, 30);
  const { provider, model } = resolveActiveAiSelection();
  const targetName = langLabel(targetLanguage);
  const nativeName = langLabel(nativeLanguage);

  const systemPrompt = [
    `You generate concise ${targetName} vocabulary flashcards with ${nativeName} translations.`,
    `For EVERY line in the input array (preserve exact count and order), output one object in JSON:`,
    `{"cards": [{"prompt": string, "answer": string, "explanation": string, "level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2"}]}`,
    `For nouns include grammatical articles if applicable in ${targetName}. Explanations must be in ${nativeName}. Return strictly valid JSON.`,
  ].join('\n');

  const rawText = await provider.generateChat({
    systemPrompt,
    userMessage: JSON.stringify({ phrases: limited }),
    model,
    temperature: 0.2,
    maxOutputTokens: Math.min(4096, 300 + limited.length * 160),
    jsonMode: true,
    signal,
  });

  const parsed = parseStrictJsonObject(rawText);
  const items = Array.isArray(parsed.cards) ? parsed.cards : [];
  if (!items.length) {
    throw new Error('ИИ не вернул список карточек');
  }

  const validEnvelopes = [];
  let failedCount = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const prompt = String(item?.prompt || limited[i] || '').trim();
    const answer = String(item?.answer || '').trim();
    const explanation = String(item?.explanation || '').trim();
    const level = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(String(item?.level || '').toUpperCase())
      ? String(item.level).toUpperCase()
      : null;

    const envelope = {
      schema_version: nativeV2Version,
      card: {
        type: 'standard',
        data: { prompt, answer },
        info: [],
        explanation,
        ...(level ? { level } : {}),
      },
    };
    try {
      validateNativeV2Content(envelope, { writable: true });
      validEnvelopes.push(envelope);
    } catch {
      failedCount += 1;
    }
  }

  if (!validEnvelopes.length) {
    throw new Error('Ни одна из сгенерированных карточек не прошла проверку Native V2');
  }

  if (!deckId) {
    return {
      status: 'ok',
      cards: validEnvelopes.map((content_v2) => ({ content_v2 })),
      generated_count: validEnvelopes.length,
      failed_count: failedCount,
    };
  }

  const savedCards = [];
  for (const content_v2 of validEnvelopes) {
    if (signal?.aborted) {
      throw new DOMException('Batch AI generation canceled', 'AbortError');
    }
    try {
      const saved = await offlineApi.handle('post', '/cards/save', {
        request_id: crypto.randomUUID(),
        deck_id: Number(deckId),
        content_v2,
      });
      if (saved?.data) savedCards.push(saved.data);
    } catch {
      failedCount += 1;
    }
  }

  return {
    status: 'ok',
    cards: savedCards,
    saved_cards: savedCards,
    generated_count: savedCards.length,
    save_result: {
      cards: savedCards,
      failed_count: failedCount,
    },
  };
}
