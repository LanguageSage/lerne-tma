import { studyContent } from './structuredStudyCard.js';
import { stripMarkdown } from './text.js';
import { shuffleFY } from './shuffle.js';
import { getAudioUrl } from './media.js';

/**
 * Parses a Russian back translation text into clean question and option translations.
 * Format on card back:
 * [Question in Russian]
 *
 * 1. [Option 1]
 * 2. ✅ [Option 2]
 * 3. [Option 3]
 * 4. [Option 4]
 */
export const parseBackTranslation = (backText) => {
  if (!backText) {
    return { question: '', optionsRu: [] };
  }

  const parts = backText.trim().split(/\n\s*\n/);
  const question = parts[0] ? stripMarkdown(parts[0].trim()) : '';
  const optionsBlock = parts.slice(1).join('\n').trim();

  const lines = optionsBlock.split('\n').map(l => l.trim()).filter(Boolean);
  const optionsRu = lines.map(line => {
    // Strip prefixes like "1. ", "2) ", "✅ ", "1. ✅ "
    return line
      .replace(/^[0-9]{1,2}[.)]\s*/, '')
      .replace(/^(?:✅|\*|▫️|-)\s*/u, '')
      .replace(/^(?:✅|\*|▫️|-)\s*/u, '')
      .trim();
  });

  return { question, optionsRu };
};

/**
 * Transforms a real database / Dexie card into a structured question object for the LiD exam ticket.
 * Automatically couples German options with their exact Russian translations and shuffles choices
 * so users cannot rely on muscle / positional memory.
 */
export const transformCardToExamQuestion = (card, examIndex = 1, { shuffle = true } = {}) => {
  // ИНВАРИАНТ: Данные вопроса и картинки извлекаются НАПРЯМУЮ из карточки (card.image_url / card.image_path). Внешние файлы запрещены.
  if (!card) return null;

  const content = studyContent(card);
  if (content?.type !== 'quiz') return null;
  const rawBack = content.data.back_note || '';
  const rawContext = content.explanation || '';
  const audioUrl = getAudioUrl(card.audio_url || card.audio_path);
  const rawMedia = card.image_url || card.media_url || card.image_path || card.image || '';

  // Canonical media URL resolution directly from card
  let resolvedImage = null;
  if (rawMedia && typeof rawMedia === 'string') {
    if (rawMedia.startsWith('http://') || rawMedia.startsWith('https://') || rawMedia.startsWith('data:') || rawMedia.startsWith('blob:') || rawMedia.startsWith('/api/media/')) {
      resolvedImage = rawMedia;
    } else {
      const cleanPath = rawMedia.replace(/^(images|audio|videos)\//, '').replace(/^\/lid_images\//, '');
      resolvedImage = `/api/media/images/${cleanPath}`;
    }
  }

  const questionDe = content.data.prompt;

  const OPT_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

  // 2. Resolve Russian translation data directly from card / API
  const apiTrans = card.translationRu || card.translation_ru || null;
  const { question: parsedRuQ, optionsRu: parsedOptionsRu } = parseBackTranslation(rawBack);

  const questionRu = apiTrans?.question || parsedRuQ || '';
  const contextRu = apiTrans?.context || '';

  // 3. Form tightly-coupled pairs: { textDe, textRu, isCorrect }
  const optionPairs = content.data.options.map((option, idx) => {
    const origLetter = OPT_LETTERS[idx] || String(idx + 1);
    const isCorrect = option.correct;
    const cleanText = option.text;

    const optRu = (apiTrans && apiTrans[origLetter]) ||
                  parsedOptionsRu[idx] ||
                  '';

    return {
      text: cleanText,
      textRu: optRu,
      isCorrect,
      origLetter
    };
  });

  // 4. Randomly shuffle options if requested (default true)
  const finalPairs = shuffle ? shuffleFY(optionPairs) : [...optionPairs];

  const options = [];
  let correctOption = 'a';
  const translationRu = {
    question: questionRu,
    context: contextRu
  };

  finalPairs.forEach((pair, idx) => {
    const optId = OPT_LETTERS[idx] || String(idx + 1);
    if (pair.isCorrect) {
      correctOption = optId;
    }

    options.push({
      id: optId,
      text: pair.text,
      translationRu: pair.textRu,
      isCorrect: pair.isCorrect,
      origId: pair.origLetter
    });

    if (pair.textRu) {
      translationRu[optId] = pair.textRu;
    }
  });

  // 5. Official BAMF catalog question number:
  // 1..100 (Politik), 101..200 (Geschichte), 201..300 (Mensch), 1..10 (Bundesland)
  let bamfNumber = card.bamf_num || card.bamfNumber || null;
  if (!bamfNumber && card.translationRu?.num) {
    bamfNumber = card.translationRu.num;
  }
  if (!bamfNumber) {
    const pos = card.position || 0;
    const deckName = (card.deck_name || '').toLowerCase();
    if (pos > 0) {
      if (deckName.includes('1.') || deckName.includes('politik')) {
        bamfNumber = pos;
      } else if (deckName.includes('2.') || deckName.includes('geschichte')) {
        bamfNumber = pos > 100 ? pos : 100 + pos;
      } else if (deckName.includes('3.') || deckName.includes('mensch')) {
        bamfNumber = pos > 100 ? pos : 200 + pos;
      } else {
        bamfNumber = pos; // 1..10
      }
    }
  }

  return {
    id: card.id,
    examIndex,
    category: card.deck_name || 'Leben in Deutschland',
    question: questionDe,
    options,
    correctOption,
    cardBack: rawBack,
    cardContext: rawContext,
    context: rawContext,
    audioUrl,
    image: resolvedImage,
    translationRu,
    bamfNumber,
    rawCard: card
  };
};
