import { tr, getInterfaceLanguage } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Layers, Loader2, CheckCircle2, AlertCircle, FileText, Check, Zap } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useCardActions } from '../../hooks/useCardActions';
import { CardLevelBadge } from '../common/CardLevelBadge';
import { db } from '../../services/localDb';
import { parseBatchCardsText } from '../../utils/batchCardParser';
import api from '../../services/api';

export const BatchCardModal = () => {
  useInterfaceLocale();
  const { isBatchModalOpen, setIsBatchModalOpen, showToast } = useUiStore();
  const { currentDeck } = useDeckStore();
  const { runBatchAiGenerator } = useCardActions();
  const activeLanguage = useLanguageStore(state => state.activeLanguage);
  const targetLanguage = currentDeck?.target_language || activeLanguage || 'de';

  const [activeTab, setActiveTab] = useState('import'); // 'import' | 'ai'
  const [rawText, setRawText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMode, setProcessingMode] = useState(''); // 'ai' | 'direct'
  const [generatedCards, setGeneratedCards] = useState(null);

  const importPlaceholder = useMemo(() => {
    return `@@CARD trainer
FRONT:
Ich [[hatte]] meine Freunde [[angerufen]], bevor ich ins Kino gegangen bin.
BACK:
hatte, angerufen
CONTEXT:
Plusquamperfekt
TAGS:
B1,Grammatik
@@END

@@CARD match
FRONT:
@match
Als ich Kind war => lebte ich auf dem Land.
Als wir geheiratet haben => haben ungefähr 300 Gäste mit uns gefeiert.
BACK:
Соответствия
@@END

@@CARD free_text
FRONT:
@free
Schreiben Sie einen Satz mit „als“.
BACK:
Als ich in Berlin war, besuchte ich das Brandenburger Tor.
@@END`;
  }, []);

  const aiBatchPlaceholder = useMemo(() => {
    if (targetLanguage === 'en') {
      return `The dog\nThe cat\nMy first impression is that the building looks very modern.\nThe house with the big garden.`;
    }
    if (targetLanguage === 'no') {
      return `Hunden\nKatten\nMitt første inntrykk er at bygningen virker veldig moderne.\nHuset med den store hagen.`;
    }
    return `Der Hund\nDie Katze\nMein erster Eindruck ist, dass das Gebäude sehr modern wirkt.\nDas Haus mit dem großen Garten.`;
  }, [targetLanguage]);

  // Auto-switch to import tab if user pastes text with exercises or batch markers
  useEffect(() => {
    if (rawText && (
      rawText.includes('---') ||
      rawText.includes('@@CARD') ||
      rawText.includes('@match') ||
      rawText.includes('@free') ||
      rawText.includes('\n*') ||
      /\{([^}]+)\}/.test(rawText) ||
      /\[\[([^\]]+)\]\]/.test(rawText)
    )) {
      setActiveTab('import');
    }
  }, [rawText]);

  const handleClose = () => {
    if (isProcessing) return;
    setRawText('');
    setIsProcessing(false);
    setProcessingMode('');
    setGeneratedCards(null);
    setIsBatchModalOpen(false);
  };

  const parsedCards = useMemo(() => {
    if (activeTab !== 'import' || !rawText.trim()) return [];
    return parseBatchCardsText(rawText);
  }, [rawText, activeTab]);

  if (!isBatchModalOpen) return null;

  // Lines for AI generation tab
  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const lineCount = lines.length;
  const isOverLimit = lineCount > 30;
  const effectiveCount = isOverLimit ? 30 : lineCount;

  // ── Helper to sync cards into Zustand store & cloud backend ─────────────────
  const updateLocalStores = async (cardsList) => {
    if (!currentDeck?.id) return;
    const { fetchDeckCards, fetchDecks } = useDeckStore.getState();

    // Optional local cache update (safe for cloud-only DB setups)
    try {
      if (db?.cards && cardsList?.length > 0) {
        await db.cards.bulkPut(cardsList);
      }
    } catch {
      // Ignored for cloud-only setups
    }

    // Refresh cards and decks from cloud backend
    try {
      await fetchDeckCards(currentDeck.id);
      await fetchDecks(true);
    } catch (refreshErr) {
      console.warn('Post-save cloud refresh:', refreshErr);
    }
  };

  // ── 1. Batch AI Generator (Plain phrase list) ──────────────────────────────
  const handleAiGenerate = async () => {
    if (lineCount === 0) {
      showToast(tr("Введите хотя бы одну фразу для генерации"), 'error');
      return;
    }

    setIsProcessing(true);
    setProcessingMode('ai');
    setGeneratedCards(null);

    const targetText = lines.slice(0, 30).join('\n');
    const result = await runBatchAiGenerator(targetText, currentDeck?.id);

    setIsProcessing(false);
    setProcessingMode('');

    if (result && result.cards && result.cards.length > 0) {
      const cardsList = result.saved_cards || result.cards;
      setGeneratedCards(cardsList);
      await updateLocalStores(cardsList);
    }
  };

  // ── 2. AI Quiz/Card Enrichment (Generates explanations & translations) ─────
  const handleAiEnrichImport = async () => {
    if (parsedCards.length === 0) {
      showToast(tr("Не удалось распознать карточки в тексте. Проверьте разделители (---)"), 'error');
      return;
    }

    setIsProcessing(true);
    setProcessingMode('ai_enrich');
    try {
      const payloadCards = parsedCards.map((c, idx) => ({
        deck_id: currentDeck?.id || null,
        front: c.front,
        front_text: c.front,
        back: c.back,
        back_text: c.back,
        context: c.context || '',
        card_type: c.card_type,
        level: c.level,
        tags: c.tags,
        position: idx
      }));

      const nativeLang = getInterfaceLanguage();

      const res = await api.post('/ai/enrich-batch', {
        cards: payloadCards,
        deck_id: currentDeck?.id ? String(currentDeck.id) : null,
        target_language: targetLanguage,
        native_language: nativeLang
      });

      const cardsList = res.data?.saved_cards || res.data?.cards || payloadCards;
      setGeneratedCards(cardsList);
      await updateLocalStores(cardsList);

      showToast(tr("ИИ успешно сгенерировал ответы для {{p0}} карточек!", { p0: cardsList.length }), 'success');
    } catch (err) {
      console.error('AI enrich error:', err);
      showToast(tr("Ошибка генерации ИИ: {{p0}}", { p0: err.response?.data?.detail || err.message }), 'error');
    } finally {
      setIsProcessing(false);
      setProcessingMode('');
    }
  };

  // ── 3. Direct Fast Import (Quizzes, Trainers, Standard without AI) ─────────
  const handleDirectImport = async () => {
    if (parsedCards.length === 0) {
      showToast(tr("Не удалось распознать карточки в тексте. Проверьте разделители (---)"), 'error');
      return;
    }

    setIsProcessing(true);
    setProcessingMode('direct');
    try {
      const { deckCards } = useDeckStore.getState();
      const currentPos = deckCards?.length || 0;

      const payloadCards = parsedCards.map((c, idx) => ({
        deck_id: currentDeck?.id || null,
        front: c.front,
        front_text: c.front,
        back: c.back,
        back_text: c.back,
        context: c.context || '',
        card_type: c.card_type,
        level: c.level,
        tags: c.tags,
        position: currentPos + idx,
        source: 'batch_import'
      }));

      const res = await api.post('/cards/bulk-save', { cards: payloadCards });
      const savedCardsList = res.data?.cards || payloadCards;

      setGeneratedCards(savedCardsList);
      await updateLocalStores(savedCardsList);

      showToast(tr("Успешно добавлено {{p0}} карточек!", { p0: savedCardsList.length }), 'success');
    } catch (err) {
      console.error('Bulk save error:', err);
      showToast(tr("Ошибка импорта: {{p0}}", { p0: err.response?.data?.detail || err.message }), 'error');
    } finally {
      setIsProcessing(false);
      setProcessingMode('');
    }
  };

  const handleDone = () => {
    handleClose();
  };

  // Count types for summary
  const quizCount = parsedCards.filter(c => c.card_type === 'quiz').length;
  const trainerCount = parsedCards.filter(c => c.card_type === 'trainer').length;
  const matchCount = parsedCards.filter(c => c.card_type === 'match').length;
  const freeTextCount = parsedCards.filter(c => c.card_type === 'free_text').length;
  const standardCount = parsedCards.filter(c => c.card_type === 'standard').length;

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={handleClose} style={{ zIndex: 1100, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          exit={{ opacity: 0, scale: 0.95, y: 20 }} 
          className="settings-modal" 
          onClick={e => e.stopPropagation()}
          style={{ 
            maxWidth: 540, 
            width: '100%', 
            maxHeight: 'calc(100dvh - 32px)', 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden', 
            padding: '20px',
            margin: 'auto',
            boxSizing: 'border-box'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(168, 85, 247, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c084fc' }}>
                <Layers size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                  {tr("Массовое добавление")}
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  {currentDeck?.name || tr("Текущая колода")}
                </span>
              </div>
            </div>
            <button type="button" onClick={handleClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {/* Mode Switcher Tabs */}
          {!generatedCards && (
            <div style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: 12,
              padding: 3,
              marginBottom: 12,
              gap: 4,
              flexShrink: 0
            }}>
              <button
                type="button"
                onClick={() => setActiveTab('import')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 9,
                  border: 'none',
                  background: activeTab === 'import' ? 'rgba(168, 85, 247, 0.3)' : 'transparent',
                  color: activeTab === 'import' ? '#fff' : 'rgba(255, 255, 255, 0.65)',
                  fontSize: '0.82rem',
                  fontWeight: activeTab === 'import' ? 700 : 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <FileText size={15} />
                <span>{tr("Импорт упражнений")}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('ai')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 9,
                  border: 'none',
                  background: activeTab === 'ai' ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                  color: activeTab === 'ai' ? '#fff' : 'rgba(255, 255, 255, 0.65)',
                  fontSize: '0.82rem',
                  fontWeight: activeTab === 'ai' ? 700 : 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <Sparkles size={15} />
                <span>{tr("Генерация ИИ")}</span>
              </button>
            </div>
          )}

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!generatedCards ? (
              activeTab === 'import' ? (
                /* ── TAB 1: Direct Text Import ── */
                <>
                  <p style={{ fontSize: '0.84rem', color: '#cbd5e1', margin: 0, lineHeight: 1.4 }}>
                    {tr("Вставьте упражнения в формате")} <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 4, color: '#c084fc' }}>@@CARD ... @@END</code> {tr("или карточки с разделителем")} <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 4, color: '#c084fc' }}>---</code>.
                  </p>

                  <div style={{ position: 'relative' }}>
                    <textarea
                      rows={9}
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      disabled={isProcessing}
                      placeholder={importPlaceholder}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: 12,
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        color: 'white',
                        fontSize: '0.88rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                        lineHeight: 1.4
                      }}
                    />
                    
                    {/* Live parsing summary badge bar */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginTop: 6, fontSize: '0.8rem', color: parsedCards.length > 0 ? '#4ade80' : '#94a3b8',
                      flexWrap: 'wrap', gap: 6
                    }}>
                      <span>
                        {parsedCards.length === 0 ? tr("Вставьте упражнения (@@CARD или ---)") : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Check size={14} color="#4ade80" />
                            <strong>{tr("Найдено карточек:")} {parsedCards.length}</strong>
                            {trainerCount > 0 && <span style={{ color: '#c084fc', background: 'rgba(168,85,247,0.15)', padding: '1px 5px', borderRadius: 4 }}>🏋️ Trainer: {trainerCount}</span>}
                            {quizCount > 0 && <span style={{ color: '#4ade80', background: 'rgba(34,197,94,0.15)', padding: '1px 5px', borderRadius: 4 }}>☑️ Quiz: {quizCount}</span>}
                            {matchCount > 0 && <span style={{ color: '#38bdf8', background: 'rgba(56,189,248,0.15)', padding: '1px 5px', borderRadius: 4 }}>🔗 Match: {matchCount}</span>}
                            {freeTextCount > 0 && <span style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '1px 5px', borderRadius: 4 }}>💬 Free text: {freeTextCount}</span>}
                            {standardCount > 0 && <span style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 }}>📖 Standard: {standardCount}</span>}
                          </span>
                        )}
                      </span>
                      <span style={{ opacity: 0.7 }}>{tr("Без лимитов")}</span>
                    </div>
                  </div>

                  {/* Live Preview of parsed cards */}
                  {parsedCards.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '200px', overflowY: 'auto', paddingRight: 4, marginTop: 4 }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                        {tr("Предпросмотр (")}{parsedCards.length}):
                      </span>
                      {parsedCards.map((card, idx) => (
                        <div key={idx} style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(255, 255, 255, 0.07)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                              {card.card_type === 'quiz' && (
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#4ade80', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>☑️ Quiz</span>
                              )}
                              {card.card_type === 'trainer' && (
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#c084fc', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>🏋️ Trainer</span>
                              )}
                              {card.card_type === 'match' && (
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>🔗 Match</span>
                              )}
                              {card.card_type === 'free_text' && (
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>💬 Free text</span>
                              )}
                              {card.card_type === 'standard' && (
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>📖 Standard</span>
                              )}
                              <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.84rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {card.front.split('\n')[0]}
                              </span>
                            </div>
                            <CardLevelBadge card={card} size="sm" />
                          </div>
                          {card.back && (
                            <div style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ color: '#4ade80' }}>✓</span>
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.back}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* ── TAB 2: AI Batch Generation ── */
                <>
                  <p style={{ fontSize: '0.84rem', color: '#cbd5e1', margin: 0, lineHeight: 1.4 }}>{tr("Вставьте список слов или выражений (по одному на строку). ИИ автоматически сгенерирует переводы, контекст и определит уровень языка CEFR.")}{' '}</p>

                  <div style={{ position: 'relative' }}>
                    <textarea
                      rows={8}
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      disabled={isProcessing}
                      placeholder={aiBatchPlaceholder}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: 12,
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        color: 'white',
                        fontSize: '0.9rem',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        boxSizing: 'border-box'
                      }}
                    />
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginTop: 6, fontSize: '0.8rem', color: isOverLimit ? '#f87171' : '#94a3b8'
                    }}>
                      <span>
                        {lineCount === 0 ? tr("Введите список фраз") : tr("Обнаружено строк: {{p0}}", { p0: lineCount })}
                      </span>
                      <span>{tr("Лимит: до 30 строк")}</span>
                    </div>
                  </div>

                  {isOverLimit && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#fca5a5', fontSize: '0.82rem'
                    }}>
                      <AlertCircle size={16} />
                      <span>{tr("Будет обработано первые 30 строк за один запрос.")}</span>
                    </div>
                  )}
                </>
              )
            ) : (
              /* ── Results List ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4ade80', fontWeight: 600, fontSize: '0.95rem' }}>
                  <CheckCircle2 size={20} />
                  <span>{tr("Успешно добавлено карточек:")}{' '}{generatedCards.length}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '350px', overflowY: 'auto', paddingRight: 4 }}>
                  {generatedCards.map((card, idx) => (
                    <div key={idx} style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                          {card.card_type === 'quiz' && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#4ade80', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>☑️ Quiz</span>
                          )}
                          {card.card_type === 'trainer' && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#c084fc', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>🏋️ Trainer</span>
                          )}
                          {card.card_type === 'match' && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>🔗 Match</span>
                          )}
                          {card.card_type === 'free_text' && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>💬 Free text</span>
                          )}
                          {card.card_type === 'puzzle' && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#ec4899', background: 'rgba(236,72,153,0.15)', border: '1px solid rgba(236,72,153,0.3)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>🧩 Puzzle</span>
                          )}
                          {card.card_type === 'standard' && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>📖 Standard</span>
                          )}
                          <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(card.front_text || card.front || '').split('\n')[0]}
                          </span>
                        </div>
                        <CardLevelBadge card={card} size="sm" />
                      </div>
                      <span style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
                        {card.back_text || card.back}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
            {!generatedCards ? (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={handleClose}
                  disabled={isProcessing}
                  style={{ padding: '10px 18px', borderRadius: 12 }}
                >{tr("Отмена")}{' '}</button>

                {activeTab === 'import' ? (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={handleDirectImport}
                      disabled={isProcessing || parsedCards.length === 0}
                      title={tr("Мгновенно сохранить карточки без вызова ИИ")}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '10px 14px', borderRadius: 12, fontSize: '0.86rem'
                      }}
                    >
                      {isProcessing && processingMode === 'direct' ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <Zap size={16} />
                      )}
                      <span>{tr("Создать ({{p0}})", { p0: parsedCards.length })}</span>
                    </button>

                    <button
                      className="btn btn-primary"
                      onClick={handleAiEnrichImport}
                      disabled={isProcessing || parsedCards.length === 0}
                      title={tr("ИИ найдет правильный ответ, переведет вопрос и составит подробное объяснение")}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 20px', borderRadius: 12, fontWeight: 600,
                        background: 'linear-gradient(135deg, #9333ea, #6366f1)'
                      }}
                    >
                      {isProcessing && processingMode === 'ai_enrich' ? (
                        <>
                          <Loader2 size={18} className="spin" />{tr("Генерация ИИ (")}{parsedCards.length})...
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} />{tr("Сгенерировать с ИИ (")}{parsedCards.length})
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleAiGenerate}
                    disabled={isProcessing || lineCount === 0}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 20px', borderRadius: 12, fontWeight: 600
                    }}
                  >
                    {isProcessing && processingMode === 'ai' ? (
                      <>
                        <Loader2 size={18} className="spin" />{tr("Генерация (")}{effectiveCount})...
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />{tr("Сгенерировать (")}{effectiveCount})
                      </>
                    )}
                  </button>
                )}
              </>
            ) : (
              <button
                className="btn btn-primary btn-full"
                onClick={handleDone}
                style={{ padding: '12px', borderRadius: 12, fontWeight: 600 }}
              >{tr("Готово")}{' '}</button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

