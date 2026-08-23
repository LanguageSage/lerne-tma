import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit2, Check, Plus, ArrowLeft, Lightbulb } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { renderFlag } from '../deckgrid/FlagIcons';
import api from '../../services/api';


export const PromptsTab = () => {
  const { showToast } = useUiStore();
  const { activeLanguage, getLanguageInfo } = useLanguageStore();
  const langInfo = getLanguageInfo();

  const [activeCategoryTab, setActiveCategoryTab] = useState('standard'); // 'standard' | 'trainer' | 'exam'
  const [promptsList, setPromptsList] = useState([]);
  const [activeStandardPromptId, setActiveStandardPromptId] = useState(null);
  const [activeTrainerPromptId, setActiveTrainerPromptId] = useState(null);
  const [activeExamPromptId, setActiveExamPromptId] = useState(null);
  const [activeStandardPresetId, setActiveStandardPresetId] = useState('preset_b1');
  const [activeTrainerPresetId, setActiveTrainerPresetId] = useState('preset_trainer');
  const [activeExamPresetId, setActiveExamPresetId] = useState('preset_exam');
  
  const [systemPresets, setSystemPresets] = useState([]);
  const [defaults, setDefaults] = useState({ de: "", ru: "" });
  const [, setLoading] = useState(false);
  
  // Editor state
  const [editingPrompt, setEditingPrompt] = useState(null);

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/user/prompts?target_language=${activeLanguage}`);
      if (res && res.data) {
        setPromptsList(res.data.custom_prompts || []);
        setActiveStandardPromptId(res.data.active_standard_prompt_id || null);
        setActiveTrainerPromptId(res.data.active_trainer_prompt_id || null);
        setActiveExamPromptId(res.data.active_exam_prompt_id || null);
        setActiveStandardPresetId(res.data.active_standard_preset_id || 'preset_b1');
        setActiveTrainerPresetId(res.data.active_trainer_preset_id || 'preset_trainer');
        setActiveExamPresetId(res.data.active_exam_preset_id || 'preset_exam');
        setSystemPresets(res.data.system_presets || []);
        setDefaults(res.data.defaults || { de: "", ru: "" });
      }
    } catch (err) {
      console.error("fetchPrompts error:", err);
      showToast("Ошибка загрузки промптов", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, [activeLanguage]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentActivePromptId = activeCategoryTab === 'exam' 
    ? activeExamPromptId 
    : (activeCategoryTab === 'trainer' ? activeTrainerPromptId : activeStandardPromptId);

  const currentActivePresetId = activeCategoryTab === 'exam' 
    ? activeExamPresetId 
    : (activeCategoryTab === 'trainer' ? activeTrainerPresetId : activeStandardPresetId);

  const handleActivate = async (promptId) => {
    try {
      if (promptId === null) {
        await api.post('/user/prompts/deactivate', { target_language: activeLanguage, prompt_type: activeCategoryTab });
        if (activeCategoryTab === 'exam') setActiveExamPromptId(null);
        else if (activeCategoryTab === 'trainer') setActiveTrainerPromptId(null);
        else setActiveStandardPromptId(null);
        showToast("Активирован промпт по умолчанию", "success");
      } else {
        await api.post(`/user/prompts/${promptId}/activate`, { target_language: activeLanguage, prompt_type: activeCategoryTab });
        if (activeCategoryTab === 'exam') setActiveExamPromptId(promptId);
        else if (activeCategoryTab === 'trainer') setActiveTrainerPromptId(promptId);
        else setActiveStandardPromptId(promptId);
        showToast("Промпт активирован", "success");
      }
      fetchPrompts();
    } catch {
      showToast("Не удалось активировать промпт");
    }
  };

  const handleActivatePreset = async (presetId) => {
    try {
      await api.post(`/user/prompts/preset/${presetId}/activate`, { target_language: activeLanguage });
      fetchPrompts();
      showToast("Системный промпт активирован", "success");
    } catch {
      showToast("Не удалось активировать пресет");
    }
  };

  const handleDelete = async (promptId) => {
    if (!window.confirm("Удалить этот промпт?")) return;
    try {
      await api.delete(`/user/prompts/${promptId}`);
      showToast("Промпт успешно удален", "success");
      fetchPrompts();
    } catch {
      showToast("Не удалось удалить промпт");
    }
  };

  const handleSavePrompt = async () => {
    if (!editingPrompt.name || !editingPrompt.name.trim()) {
      showToast("Укажите название промпта");
      return;
    }
    const mainText = editingPrompt.instruction || editingPrompt.translation_prompt || editingPrompt.context_prompt || '';

    const finalTranslation = editingPrompt.isSplit 
      ? (editingPrompt.translation_prompt || mainText) 
      : mainText;

    const finalContext = editingPrompt.isSplit 
      ? (editingPrompt.context_prompt || mainText) 
      : mainText;

    try {
      await api.post('/user/prompts', {
        id: editingPrompt.id,
        name: editingPrompt.name,
        translation_prompt: finalTranslation,
        context_prompt: finalContext,
        target_language: activeLanguage,
        prompt_type: editingPrompt.prompt_type || activeCategoryTab
      });
      showToast(editingPrompt.id ? "Промпт обновлен" : "Промпт создан", "success");
      setEditingPrompt(null);
      fetchPrompts();
    } catch {
      showToast("Ошибка сохранения промпта");
    }
  };

  const handleCreateNew = () => {
    let activeTranslation = defaults.de;
    let activeContext = defaults.ru;
    
    if (activeCategoryTab === 'exam') {
      const examPreset = systemPresets.find(p => p.id === 'preset_exam');
      activeTranslation = examPreset 
        ? (examPreset.instruction || examPreset.translation_prompt || '') 
        : `Создавай экзаменационные карточки с выбором вариантов ответа (Multiple Choice) с [*] и [ ] на лицевой стороне и точным переводом с грамматическим разбором без примеров на обороте.`;
      activeContext = activeTranslation;
    } else if (activeCategoryTab === 'trainer') {
      activeTranslation = `Генерируй карточки для изучения грамматики языка ${langInfo.name}. Оборачивай проверяемую грамматическую форму в фигурные скобки {слово} в предложении на лицевой стороне (например: Ich sehe {den} Hund). На обратной стороне напиши подробный и развернутый грамматический разбор правила.`;
      activeContext = activeTranslation;
    } else if (currentActivePromptId !== null) {
      const active = promptsList.find(p => p.id === currentActivePromptId);
      if (active) {
        activeTranslation = active.translation_prompt || active.instruction || '';
        activeContext = active.context_prompt || active.instruction || '';
      }
    }

    const defaultTitle = activeCategoryTab === 'exam' 
      ? `Экзаменационный промпт (${langInfo.label})` 
      : (activeCategoryTab === 'trainer' ? `Грамматический промпт (${langInfo.label})` : `Мой промпт (${langInfo.label})`);

    setEditingPrompt({
      id: null,
      name: defaultTitle,
      instruction: activeTranslation,
      translation_prompt: activeTranslation,
      context_prompt: activeContext,
      isSplit: false,
      prompt_type: activeCategoryTab
    });
  };

  if (editingPrompt) {
    return (
      <motion.div key="prompt-editor" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="settings-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
          <button className="btn-secondary btn-tiny" style={{ padding: '6px' }} onClick={() => setEditingPrompt(null)}>
            <ArrowLeft size={16} />
          </button>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{editingPrompt.id ? "Редактирование" : "Создание промпта"} ({langInfo.label})</span>
            {renderFlag(langInfo.code, 18)}
          </h3>
        </div>
        
        <div style={{
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start'
        }}>
          <Lightbulb size={20} style={{ color: '#38bdf8', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '0.85rem', lineHeight: '1.4', color: '#e2e8f0' }}>
            <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '4px' }}>Инструкция для ИИ ({langInfo.name})</strong>
            Задайте правила разбора слов, грамматики и примеры для {langInfo.label.toLowerCase()} языка.
          </div>
        </div>
        
        <div className="form-group">
          <label>Название шаблона</label>
          <input 
            type="text" 
            value={editingPrompt.name} 
            onChange={e => setEditingPrompt({ ...editingPrompt, name: e.target.value })} 
            placeholder={`Например: Промпт B1 (${langInfo.label})`} 
          />
        </div>

        {!editingPrompt.isSplit ? (
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ margin: 0 }}>Инструкция для ИИ</label>
              {systemPresets.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Заполнить уровнем:</span>
                  {systemPresets.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      className="btn-secondary btn-tiny"
                      style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '6px' }}
                      onClick={() => setEditingPrompt({
                        ...editingPrompt,
                        instruction: preset.instruction,
                        translation_prompt: preset.instruction,
                        context_prompt: preset.instruction
                      })}
                    >
                      ⚡ {preset.level || preset.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="field-hint">Правила разбора слов, разбора грамматики и количество примеров в создаваемой карточке</p>
            <textarea 
              value={editingPrompt.instruction || editingPrompt.translation_prompt || ''} 
              onChange={e => setEditingPrompt({ 
                ...editingPrompt, 
                instruction: e.target.value,
                translation_prompt: e.target.value,
                context_prompt: e.target.value 
              })} 
              rows={6} 
              placeholder="объясни слова с переводом на русский и подробно грамматику, затем 3 примера..."
            />
            <div style={{ marginTop: '8px' }}>
              <button 
                type="button"
                className="btn-link"
                style={{ fontSize: '0.75rem', color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => setEditingPrompt({
                  ...editingPrompt,
                  isSplit: true,
                  translation_prompt: editingPrompt.translation_prompt || editingPrompt.instruction,
                  context_prompt: editingPrompt.context_prompt || editingPrompt.instruction
                })}
              >
                ⚙️ Раздельные инструкции для {langInfo.label.toLowerCase()} и русского
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label>Инструкции при вводе на {langInfo.label.toLowerCase()} языке</label>
              <p className="field-hint">Правила разбора {langInfo.label.toLowerCase()} слова</p>
              <textarea 
                value={editingPrompt.translation_prompt} 
                onChange={e => setEditingPrompt({ ...editingPrompt, translation_prompt: e.target.value })} 
                rows={4} 
                placeholder={`Инструкция при вводе ${langInfo.label.toLowerCase()} слова...`}
              />
            </div>

            <div className="form-group" style={{ marginTop: '15px' }}>
              <label>Инструкции при вводе на русском (для перевода на {langInfo.label.toLowerCase()})</label>
              <p className="field-hint">Правила перевода и разбора русского слова</p>
              <textarea 
                value={editingPrompt.context_prompt} 
                onChange={e => setEditingPrompt({ ...editingPrompt, context_prompt: e.target.value })} 
                rows={4} 
                placeholder="Инструкция при вводе русского слова..."
              />
            </div>

            <div style={{ marginTop: '8px' }}>
              <button 
                type="button"
                className="btn-link"
                style={{ fontSize: '0.75rem', color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => setEditingPrompt({
                  ...editingPrompt,
                  isSplit: false,
                  instruction: editingPrompt.translation_prompt || editingPrompt.context_prompt || editingPrompt.instruction
                })}
              >
                ← Объединить в единую инструкцию
              </button>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button className="btn btn-primary btn-small" style={{ flex: 1 }} onClick={handleSavePrompt}>Сохранить</button>
          <button className="btn btn-secondary btn-small" style={{ flex: 1 }} onClick={() => setEditingPrompt(null)}>Отмена</button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div key="prompts-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="settings-section">
      <div className="section-header-with-btn">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Промпты ({langInfo.label})</span>
          {renderFlag(langInfo.code, 18)}
        </h3>
        <button className="btn btn-primary btn-tiny" onClick={handleCreateNew}>
          <Plus size={14} /> Создать промпт
        </button>
      </div>

      {/* Category Tabs: Standard Vocabulary vs Grammar Trainer vs Exam Test */}
      <div style={{ display: 'flex', gap: '6px', margin: '14px 0 16px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
        <button
          type="button"
          onClick={() => setActiveCategoryTab('standard')}
          style={{
            flex: 1,
            padding: '8px 8px',
            borderRadius: '10px',
            fontSize: '0.82rem',
            fontWeight: 600,
            background: activeCategoryTab === 'standard' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.03)',
            color: activeCategoryTab === 'standard' ? '#38bdf8' : '#94a3b8',
            border: activeCategoryTab === 'standard' ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out'
          }}
        >
          📖 Перевод
        </button>
        <button
          type="button"
          onClick={() => setActiveCategoryTab('trainer')}
          style={{
            flex: 1,
            padding: '8px 8px',
            borderRadius: '10px',
            fontSize: '0.82rem',
            fontWeight: 600,
            background: activeCategoryTab === 'trainer' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.03)',
            color: activeCategoryTab === 'trainer' ? '#c084fc' : '#94a3b8',
            border: activeCategoryTab === 'trainer' ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out'
          }}
        >
          🎯 Тренажёр
        </button>
        <button
          type="button"
          onClick={() => setActiveCategoryTab('exam')}
          style={{
            flex: 1,
            padding: '8px 8px',
            borderRadius: '10px',
            fontSize: '0.82rem',
            fontWeight: 600,
            background: activeCategoryTab === 'exam' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.03)',
            color: activeCategoryTab === 'exam' ? '#4ade80' : '#94a3b8',
            border: activeCategoryTab === 'exam' ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out'
          }}
        >
          📝 Тесты
        </button>
      </div>

      <p className="field-hint" style={{ marginBottom: '15px' }}>
        {activeCategoryTab === 'exam'
          ? `Инструкции ИИ для экзаменационных тестов с выбором ответа [*] / [ ] и подробным разбором.`
          : (activeCategoryTab === 'trainer' 
              ? `Инструкции ИИ для авто-создания карточек-тренажеров со скобками {слово} и подробным разбором правил.`
              : `Персональные и стандартные промпты для изучения слов и фраз ${langInfo.label.toLowerCase()} языка.`
            )
        }
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ 
          fontSize: '0.8rem', 
          fontWeight: 600, 
          color: activeCategoryTab === 'exam' ? '#4ade80' : (activeCategoryTab === 'trainer' ? '#c084fc' : '#38bdf8'), 
          textTransform: 'uppercase', 
          letterSpacing: '0.5px', 
          marginTop: '5px' 
        }}>
          Системные пресеты ({activeCategoryTab === 'exam' ? 'Экзамен' : (activeCategoryTab === 'trainer' ? 'Тренажёр' : langInfo.name)})
        </div>

        {systemPresets.filter(p => (p.prompt_type || 'standard') === activeCategoryTab).map(preset => {
          const isPresetActive = currentActivePromptId === null 
            ? currentActivePresetId === preset.id 
            : (promptsList.find(p => p.id === currentActivePromptId)?.name === preset.name);

          return (
            <div key={preset.id} className={`prompt-template-card glass ${isPresetActive ? 'active' : ''}`} style={{
              padding: '14px 16px',
              borderRadius: '12px',
              border: isPresetActive 
                ? (activeCategoryTab === 'exam' ? '1px solid #22c55e' : (activeCategoryTab === 'trainer' ? '1px solid #a855f7' : '1px solid #38bdf8')) 
                : '1px solid rgba(255,255,255,0.08)',
              background: isPresetActive 
                ? (activeCategoryTab === 'exam' ? 'rgba(34, 197, 94, 0.12)' : (activeCategoryTab === 'trainer' ? 'rgba(168, 85, 247, 0.12)' : 'rgba(56, 189, 248, 0.08)')) 
                : 'rgba(255,255,255,0.02)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ 
                    fontWeight: 600, 
                    fontSize: '0.92rem', 
                    color: isPresetActive 
                      ? (activeCategoryTab === 'exam' ? '#4ade80' : (activeCategoryTab === 'trainer' ? '#c084fc' : '#38bdf8')) 
                      : '#f1f5f9' 
                  }}>
                    {preset.name}
                  </span>
                  {preset.badge && (
                    <span style={{ 
                      fontSize: '0.68rem', 
                      padding: '2px 6px', 
                      borderRadius: '4px', 
                      background: isPresetActive 
                        ? (activeCategoryTab === 'exam' ? 'rgba(34, 197, 94, 0.25)' : (activeCategoryTab === 'trainer' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(56, 189, 248, 0.2)')) 
                        : 'rgba(255, 255, 255, 0.08)',
                      color: isPresetActive 
                        ? (activeCategoryTab === 'exam' ? '#4ade80' : (activeCategoryTab === 'trainer' ? '#c084fc' : '#38bdf8')) 
                        : '#94a3b8',
                      fontWeight: 500
                    }}>
                      {preset.badge}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px', lineHeight: '1.3' }}>
                  {preset.description}
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isPresetActive ? (
                  <span style={{ 
                    fontSize: '0.75rem', 
                    color: activeCategoryTab === 'exam' ? '#4ade80' : (activeCategoryTab === 'trainer' ? '#c084fc' : '#38bdf8'), 
                    fontWeight: 600, 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px', 
                    padding: '4px 8px' 
                  }}>
                    <Check size={14} /> Активен
                  </span>
                ) : (
                  <button className="btn-secondary btn-tiny" onClick={() => handleActivatePreset(preset.id)}>
                    Активировать
                  </button>
                )}

                <button 
                  className="btn-secondary btn-tiny" 
                  style={{ padding: '6px' }} 
                  onClick={() => {
                    const textContent = preset.instruction || preset.translation_prompt || preset.context_prompt || '';
                    setEditingPrompt({
                      id: null,
                      name: `${preset.name} (Копия)`,
                      instruction: textContent,
                      translation_prompt: textContent,
                      context_prompt: textContent,
                      isSplit: false,
                      prompt_type: preset.prompt_type || activeCategoryTab
                    });
                  }}
                  title="Создать копию и настроить"
                >
                  <Edit2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {promptsList.filter(p => (p.prompt_type || 'standard') === activeCategoryTab).length > 0 && (
          <>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '15px' }}>
              Мои промпты ({activeCategoryTab === 'trainer' ? 'Тренажёр' : langInfo.label})
            </div>
            {promptsList.filter(p => (p.prompt_type || 'standard') === activeCategoryTab).map(p => {
              const isCustomActive = currentActivePromptId === p.id;
              return (
                <div key={p.id} className={`prompt-template-card glass ${isCustomActive ? 'active' : ''}`} style={{
                  padding: '12px 16px',
                  borderRadius: '12px',
                  border: isCustomActive ? (activeCategoryTab === 'trainer' ? '1px solid #a855f7' : '1px solid #38bdf8') : '1px solid rgba(255,255,255,0.05)',
                  background: isCustomActive ? (activeCategoryTab === 'trainer' ? 'rgba(168, 85, 247, 0.12)' : 'rgba(56, 189, 248, 0.08)') : 'rgba(255,255,255,0.02)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isCustomActive ? (activeCategoryTab === 'trainer' ? '#c084fc' : '#38bdf8') : '#f1f5f9' }}>
                      {p.name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isCustomActive ? (
                      <button className="btn-secondary btn-tiny" style={{ opacity: 0.7 }} onClick={() => handleActivate(null)}>
                        Деактивировать
                      </button>
                    ) : (
                      <button className="btn-secondary btn-tiny" onClick={() => handleActivate(p.id)}>
                        Активировать
                      </button>
                    )}
                    <button 
                      className="btn-secondary btn-tiny" 
                      style={{ padding: '6px' }} 
                      onClick={() => {
                        const textContent = p.instruction || p.translation_prompt || p.context_prompt || '';
                        setEditingPrompt({ 
                          ...p, 
                          instruction: textContent,
                          translation_prompt: p.translation_prompt || textContent,
                          context_prompt: p.context_prompt || textContent,
                          isSplit: Boolean(p.translation_prompt && p.context_prompt && p.translation_prompt !== p.context_prompt) 
                        });
                      }}
                    >
                      <Edit2 size={12} />
                    </button>
                    <button className="btn-secondary btn-tiny" style={{ padding: '6px', color: '#ef4444' }} onClick={() => handleDelete(p.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </motion.div>
  );
};
