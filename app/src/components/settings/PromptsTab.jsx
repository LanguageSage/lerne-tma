import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit2, Check, Plus, ArrowLeft, Lightbulb } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { renderFlag } from '../deckgrid/FlagIcons';
import api from '../../services/api';


export const PromptsTab = () => {
  useInterfaceLocale();
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
      showToast(tr("Ошибка загрузки промптов"), "error");
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
        showToast(tr("Активирован промпт по умолчанию"), "success");
      } else {
        await api.post(`/user/prompts/${promptId}/activate`, { target_language: activeLanguage, prompt_type: activeCategoryTab });
        if (activeCategoryTab === 'exam') setActiveExamPromptId(promptId);
        else if (activeCategoryTab === 'trainer') setActiveTrainerPromptId(promptId);
        else setActiveStandardPromptId(promptId);
        showToast(tr("Промпт активирован"), "success");
      }
      fetchPrompts();
    } catch {
      showToast(tr("Не удалось активировать промпт"));
    }
  };

  const handleActivatePreset = async (presetId) => {
    try {
      await api.post(`/user/prompts/preset/${presetId}/activate`, { target_language: activeLanguage });
      fetchPrompts();
      showToast(tr("Системный промпт активирован"), "success");
    } catch {
      showToast(tr("Не удалось активировать пресет"));
    }
  };

  const handleDelete = async (promptId) => {
    if (!window.confirm(tr("Удалить этот промпт?"))) return;
    try {
      await api.delete(`/user/prompts/${promptId}`);
      showToast(tr("Промпт успешно удален"), "success");
      fetchPrompts();
    } catch {
      showToast(tr("Не удалось удалить промпт"));
    }
  };

  const handleSavePrompt = async () => {
    if (!editingPrompt.name || !editingPrompt.name.trim()) {
      showToast(tr("Укажите название промпта"));
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
      showToast(editingPrompt.id ? tr("Промпт обновлен") : tr("Промпт создан"), "success");
      setEditingPrompt(null);
      fetchPrompts();
    } catch {
      showToast(tr("Ошибка сохранения промпта"));
    }
  };

  const handleCreateNew = () => {
    let activeTranslation = defaults.de;
    let activeContext = defaults.ru;
    
    if (activeCategoryTab === 'exam') {
      const examPreset = systemPresets.find(p => p.id === 'preset_exam');
      activeTranslation = examPreset 
        ? (examPreset.instruction || examPreset.translation_prompt || '') 
        : tr("Создавай экзаменационные карточки с выбором вариантов ответа (Multiple Choice) с [*] и [ ] на лицевой стороне и точным переводом с грамматическим разбором без примеров на обороте.", {  });
      activeContext = activeTranslation;
    } else if (activeCategoryTab === 'trainer') {
      activeTranslation = tr("Генерируй карточки для изучения грамматики языка {{p0}}. Оборачивай проверяемую грамматическую форму в фигурные скобки {слово} в предложении на лицевой стороне (например: Ich sehe {den} Hund). На обратной стороне напиши подробный и развернутый грамматический разбор правила.", { p0: langInfo.name });
      activeContext = activeTranslation;
    } else if (currentActivePromptId !== null) {
      const active = promptsList.find(p => p.id === currentActivePromptId);
      if (active) {
        activeTranslation = active.translation_prompt || active.instruction || '';
        activeContext = active.context_prompt || active.instruction || '';
      }
    }

    const defaultTitle = activeCategoryTab === 'exam' 
      ? tr("Экзаменационный промпт ({{p0}})", { p0: langInfo.label }) 
      : (activeCategoryTab === 'trainer' ? tr("Грамматический промпт ({{p0}})", { p0: langInfo.label }) : tr("Мой промпт ({{p0}})", { p0: langInfo.label }));

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
            <span>{editingPrompt.id ? tr("Редактирование") : tr("Создание промпта")} ({langInfo.label})</span>
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
            <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '4px' }}>{tr("Инструкция для ИИ (")}{langInfo.name})</strong>{tr("Задайте правила разбора слов, грамматики и примеры для")}{' '}{langInfo.label.toLowerCase()}{' '}{tr("языка.")}{' '}</div>
        </div>
        
        <div className="form-group">
          <label>{tr("Название шаблона")}</label>
          <input 
            type="text" 
            value={editingPrompt.name} 
            onChange={e => setEditingPrompt({ ...editingPrompt, name: e.target.value })} 
            placeholder={tr("Например: Промпт B1 ({{p0}})", { p0: langInfo.label })} 
          />
        </div>

        {!editingPrompt.isSplit ? (
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ margin: 0 }}>{tr("Инструкция для ИИ")}</label>
              {systemPresets.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{tr("Заполнить уровнем:")}</span>
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
            <p className="field-hint">{tr("Правила разбора слов, разбора грамматики и количество примеров в создаваемой карточке")}</p>
            <textarea 
              value={editingPrompt.instruction || editingPrompt.translation_prompt || ''} 
              onChange={e => setEditingPrompt({ 
                ...editingPrompt, 
                instruction: e.target.value,
                translation_prompt: e.target.value,
                context_prompt: e.target.value 
              })} 
              rows={6} 
              placeholder={tr("объясни слова с переводом на русский и подробно грамматику, затем 3 примера...")}
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
              >{tr("⚙️ Раздельные инструкции для")}{' '}{langInfo.label.toLowerCase()}{' '}{tr("и русского")}{' '}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label>{tr("Инструкции при вводе на")}{' '}{langInfo.label.toLowerCase()}{' '}{tr("языке")}</label>
              <p className="field-hint">{tr("Правила разбора")}{' '}{langInfo.label.toLowerCase()}{' '}{tr("слова")}</p>
              <textarea 
                value={editingPrompt.translation_prompt} 
                onChange={e => setEditingPrompt({ ...editingPrompt, translation_prompt: e.target.value })} 
                rows={4} 
                placeholder={tr("Инструкция при вводе {{p0}} слова...", { p0: langInfo.label.toLowerCase() })}
              />
            </div>

            <div className="form-group" style={{ marginTop: '15px' }}>
              <label>{tr("Инструкции при вводе на русском (для перевода на")}{' '}{langInfo.label.toLowerCase()})</label>
              <p className="field-hint">{tr("Правила перевода и разбора русского слова")}</p>
              <textarea 
                value={editingPrompt.context_prompt} 
                onChange={e => setEditingPrompt({ ...editingPrompt, context_prompt: e.target.value })} 
                rows={4} 
                placeholder={tr("Инструкция при вводе русского слова...")}
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
              >{tr("← Объединить в единую инструкцию")}{' '}</button>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button className="btn btn-primary btn-small" style={{ flex: 1 }} onClick={handleSavePrompt}>{tr("Сохранить")}</button>
          <button className="btn btn-secondary btn-small" style={{ flex: 1 }} onClick={() => setEditingPrompt(null)}>{tr("Отмена")}</button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div key="prompts-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="settings-section">
      <div className="section-header-with-btn">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{tr("Промпты (")}{langInfo.label})</span>
          {renderFlag(langInfo.code, 18)}
        </h3>
        <button className="btn btn-primary btn-tiny" onClick={handleCreateNew}>
          <Plus size={14} />{' '}{tr("Создать промпт")}{' '}</button>
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
        >{tr("📖 Перевод")}{' '}</button>
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
        >{tr("🎯 Тренажёр")}{' '}</button>
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
        >{tr("📝 Тесты")}{' '}</button>
      </div>

      <p className="field-hint" style={{ marginBottom: '15px' }}>
        {activeCategoryTab === 'exam'
          ? tr("Инструкции ИИ для экзаменационных тестов с выбором ответа [*] / [ ] и подробным разбором.", {  })
          : (activeCategoryTab === 'trainer' 
              ? tr("Инструкции ИИ для авто-создания карточек-тренажеров со скобками {слово} и подробным разбором правил.", {  })
              : tr("Персональные и стандартные промпты для изучения слов и фраз {{p0}} языка.", { p0: langInfo.label.toLowerCase() })
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
        }}>{tr("Системные пресеты (")}{activeCategoryTab === 'exam' ? tr("Экзамен") : (activeCategoryTab === 'trainer' ? tr("Тренажёр") : langInfo.name)})
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
                    <Check size={14} />{' '}{tr("Активен")}{' '}</span>
                ) : (
                  <button className="btn-secondary btn-tiny" onClick={() => handleActivatePreset(preset.id)}>{tr("Активировать")}{' '}</button>
                )}

                <button 
                  className="btn-secondary btn-tiny" 
                  style={{ padding: '6px' }} 
                  onClick={() => {
                    const textContent = preset.instruction || preset.translation_prompt || preset.context_prompt || '';
                    setEditingPrompt({
                      id: null,
                      name: tr("{{p0}} (Копия)", { p0: preset.name }),
                      instruction: textContent,
                      translation_prompt: textContent,
                      context_prompt: textContent,
                      isSplit: false,
                      prompt_type: preset.prompt_type || activeCategoryTab
                    });
                  }}
                  title={tr("Создать копию и настроить")}
                >
                  <Edit2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {promptsList.filter(p => (p.prompt_type || 'standard') === activeCategoryTab).length > 0 && (
          <>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '15px' }}>{tr("Мои промпты (")}{activeCategoryTab === 'trainer' ? tr("Тренажёр") : langInfo.label})
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
                      <button className="btn-secondary btn-tiny" style={{ opacity: 0.7 }} onClick={() => handleActivate(null)}>{tr("Деактивировать")}{' '}</button>
                    ) : (
                      <button className="btn-secondary btn-tiny" onClick={() => handleActivate(p.id)}>{tr("Активировать")}{' '}</button>
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
