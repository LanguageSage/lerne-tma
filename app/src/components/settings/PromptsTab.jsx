import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit2, Check, Plus, ArrowLeft, Lightbulb } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { renderFlag } from '../deckgrid/FlagIcons';
import api from '../../services/api';

const getCleanInstruction = (text) => {
  if (!text) return "";
  
  // Remove JSON instructions
  const index = text.toUpperCase().indexOf("RETURN ONLY A JSON");
  let clean = index !== -1 ? text.substring(0, index).trim() : text.trim();
  
  // Remove prefix possibilities
  const prefixes = [
    'Переведи "{phrase}" на немецкий. Проанализируй перевод:',
    'Переведи "{phrase}" на английский. Проанализируй перевод:',
    'Переведи "{phrase}" на норвежский. Проанализируй перевод:',
    'Проанализируй немецкое предложение или слово "{phrase}".',
    'Проанализируй английское предложение или слово "{phrase}".',
    'Проанализируй норвежское предложение или слово "{phrase}".'
  ];
  
  for (const prefix of prefixes) {
    if (clean.toLowerCase().startsWith(prefix.toLowerCase())) {
      clean = clean.substring(prefix.length).trim();
      break;
    }
  }
  
  return clean;
};

export const PromptsTab = () => {
  const { showToast } = useUiStore();
  const { activeLanguage, getLanguageInfo } = useLanguageStore();
  const langInfo = getLanguageInfo();

  const [promptsList, setPromptsList] = useState([]);
  const [activePromptId, setActivePromptId] = useState(null);
  const [systemPresets, setSystemPresets] = useState([]);
  const [defaults, setDefaults] = useState({ de: "", ru: "" });
  const [loading, setLoading] = useState(false);
  
  // Editor state
  const [editingPrompt, setEditingPrompt] = useState(null);

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/user/prompts?target_language=${activeLanguage}`);
      setPromptsList(res.data.custom_prompts || []);
      setActivePromptId(res.data.active_prompt_id);
      setSystemPresets(res.data.system_presets || []);
      setDefaults(res.data.defaults || { de: "", ru: "" });
    } catch (err) {
      showToast("Ошибка загрузки промптов");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, [activeLanguage]);

  const handleActivate = async (promptId) => {
    try {
      if (promptId === null) {
        await api.post('/user/prompts/deactivate', { target_language: activeLanguage });
        setActivePromptId(null);
        showToast("Активирован промпт по умолчанию", "success");
      } else {
        await api.post(`/user/prompts/${promptId}/activate`, { target_language: activeLanguage });
        setActivePromptId(promptId);
        showToast("Промпт активирован", "success");
      }
      fetchPrompts();
    } catch (err) {
      showToast("Не удалось активировать промпт");
    }
  };

  const handleDelete = async (promptId) => {
    if (!window.confirm("Удалить этот промпт?")) return;
    try {
      await api.delete(`/user/prompts/${promptId}`);
      showToast("Промпт успешно удален", "success");
      fetchPrompts();
    } catch (err) {
      showToast("Не удалось удалить промпт");
    }
  };

  const handleSavePrompt = async () => {
    if (!editingPrompt.name || !editingPrompt.name.trim()) {
      showToast("Укажите название промпта");
      return;
    }
    const finalTranslation = editingPrompt.isSplit 
      ? editingPrompt.translation_prompt 
      : editingPrompt.instruction;

    const finalContext = editingPrompt.isSplit 
      ? editingPrompt.context_prompt 
      : editingPrompt.instruction;

    try {
      await api.post('/user/prompts', {
        id: editingPrompt.id,
        name: editingPrompt.name,
        translation_prompt: finalTranslation,
        context_prompt: finalContext,
        target_language: activeLanguage
      });
      showToast(editingPrompt.id ? "Промпт обновлен" : "Промпт создан", "success");
      setEditingPrompt(null);
      fetchPrompts();
    } catch (err) {
      showToast("Ошибка сохранения промпта");
    }
  };

  const handleCreateNew = () => {
    let activeTranslation = defaults.de;
    let activeContext = defaults.ru;
    
    if (activePromptId !== null) {
      const active = promptsList.find(p => p.id === activePromptId);
      if (active) {
        activeTranslation = active.translation_prompt;
        activeContext = active.context_prompt;
      }
    }
    
    const cleanDe = getCleanInstruction(activeTranslation);
    const cleanRu = getCleanInstruction(activeContext);

    setEditingPrompt({
      id: null,
      name: `Промпт для ${langInfo.label}`,
      instruction: cleanDe || cleanRu || "",
      translation_prompt: cleanDe,
      context_prompt: cleanRu,
      isSplit: false
    });
  };

  const handleEditPrompt = (prompt) => {
    const cleanDe = getCleanInstruction(prompt.translation_prompt);
    const cleanRu = getCleanInstruction(prompt.context_prompt);

    setEditingPrompt({
      id: prompt.id,
      name: prompt.name,
      instruction: cleanDe || cleanRu || "",
      translation_prompt: cleanDe,
      context_prompt: cleanRu,
      isSplit: false
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
              value={editingPrompt.instruction} 
              onChange={e => setEditingPrompt({ ...editingPrompt, instruction: e.target.value })} 
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
      <p className="field-hint" style={{ marginBottom: '15px' }}>
        Персональные и стандартные промпты для изучения {langInfo.label.toLowerCase()} языка.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '5px' }}>
          Стандартный промпт ({langInfo.name})
        </div>

        {systemPresets.map(preset => {
          const isPresetActive = activePromptId === null;
          return (
            <div key={preset.id} className={`prompt-template-card glass ${isPresetActive ? 'active' : ''}`} style={{
              padding: '14px 16px',
              borderRadius: '12px',
              border: isPresetActive ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
              background: isPresetActive ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.02)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.92rem', color: isPresetActive ? '#38bdf8' : '#f1f5f9' }}>
                    {preset.name}
                  </span>
                  {preset.badge && (
                    <span style={{ 
                      fontSize: '0.68rem', 
                      padding: '2px 6px', 
                      borderRadius: '4px', 
                      background: isPresetActive ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                      color: isPresetActive ? '#38bdf8' : '#94a3b8',
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
                  <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}>
                    <Check size={14} /> Активен
                  </span>
                ) : (
                  <button className="btn-secondary btn-tiny" onClick={() => handleActivate(null)}>
                    Активировать
                  </button>
                )}

                <button 
                  className="btn-secondary btn-tiny" 
                  style={{ padding: '6px' }} 
                  onClick={() => setEditingPrompt({
                    id: null,
                    name: `${preset.name} (Копия)`,
                    instruction: preset.instruction,
                    translation_prompt: preset.instruction,
                    context_prompt: preset.instruction,
                    isSplit: false
                  })}
                  title="Создать копию и настроить"
                >
                  <Edit2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {promptsList.length > 0 && (
          <>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '15px' }}>
              Мои промпты для {langInfo.label.toLowerCase()} языка
            </div>
            {promptsList.map(p => (
              <div key={p.id} className={`prompt-template-card glass ${activePromptId === p.id ? 'active' : ''}`} style={{
                padding: '12px 16px',
                borderRadius: '12px',
                border: activePromptId === p.id ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.05)',
                background: activePromptId === p.id ? 'rgba(56, 189, 248, 0.05)' : 'rgba(255,255,255,0.02)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: activePromptId === p.id ? '#38bdf8' : '#f1f5f9' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                    Пользовательский шаблон ({p.target_language.toUpperCase()})
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {activePromptId === p.id ? (
                    <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginRight: '5px' }}>
                      <Check size={14} /> Активен
                    </span>
                  ) : (
                    <button className="btn-secondary btn-tiny" onClick={() => handleActivate(p.id)}>
                      Активировать
                    </button>
                  )}
                  
                  <button 
                    className="btn-secondary btn-tiny" 
                    style={{ padding: '6px' }} 
                    onClick={() => handleEditPrompt(p)}
                    title="Редактировать"
                  >
                    <Edit2 size={12} />
                  </button>
                  
                  <button 
                    className="btn-secondary btn-tiny" 
                    style={{ padding: '6px', color: '#f43f5e' }} 
                    onClick={() => handleDelete(p.id)}
                    title="Удалить"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </motion.div>
  );
};
