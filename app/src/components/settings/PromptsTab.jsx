import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit2, Check, Plus, ArrowLeft, Lightbulb } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';

const getCleanInstruction = (text) => {
  if (!text) return "";
  
  // Remove JSON instructions
  const index = text.toUpperCase().indexOf("RETURN ONLY A JSON");
  let clean = index !== -1 ? text.substring(0, index).trim() : text.trim();
  
  // Remove prefix possibilities
  const prefixes = [
    'Переведи "{phrase}" на немецкий. Проанализируй перевод:',
    'Переведи "{phrase}" на немецкий. Проанализируй перевод',
    'Переведи на немецкий. Проанализируй перевод:',
    'Проанализируй немецкое предложение или слово "{phrase}".',
    'Проанализируй немецкое предложение или слово "{phrase}"',
    'Проанализируй немецкое предложение или слово.',
    'Переведи {phrase} на немецкий. Проанализируй перевод:',
    'Проанализируй немецкое предложение или слово {phrase}.'
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
  const [promptsList, setPromptsList] = useState([]);
  const [activePromptId, setActivePromptId] = useState(null);
  const [defaults, setDefaults] = useState({ de: "", ru: "" });
  const [loading, setLoading] = useState(false);
  
  // Editor state
  const [editingPrompt, setEditingPrompt] = useState(null); // null or { id: null|number, name: "", translation_prompt: "", context_prompt: "" }

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/user/prompts');
      setPromptsList(res.data.custom_prompts || []);
      setActivePromptId(res.data.active_prompt_id);
      setDefaults(res.data.defaults || { de: "", ru: "" });
    } catch (err) {
      showToast("Ошибка загрузки промптов");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  const handleActivate = async (promptId) => {
    try {
      if (promptId === null) {
        await api.post('/user/prompts/deactivate');
        setActivePromptId(null);
        showToast("Активирован промпт по умолчанию", "success");
      } else {
        await api.post(`/user/prompts/${promptId}/activate`);
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
    try {
      await api.post('/user/prompts', {
        id: editingPrompt.id,
        name: editingPrompt.name,
        translation_prompt: editingPrompt.instruction,
        context_prompt: editingPrompt.instruction
      });
      showToast(editingPrompt.id ? "Промпт обновлен" : "Промпт создан", "success");
      setEditingPrompt(null);
      fetchPrompts();
    } catch (err) {
      showToast("Ошибка сохранения промпта");
    }
  };

  const handleCreateNew = () => {
    // Determine active prompt texts to pre-load
    let activeTranslation = defaults.de;
    
    if (activePromptId !== null) {
      const active = promptsList.find(p => p.id === activePromptId);
      if (active) {
        activeTranslation = active.translation_prompt;
      }
    }
    
    setEditingPrompt({
      id: null,
      name: "Мой промпт",
      instruction: getCleanInstruction(activeTranslation)
    });
  };

  const handleEditPrompt = (prompt) => {
    setEditingPrompt({
      id: prompt.id,
      name: prompt.name,
      instruction: getCleanInstruction(prompt.translation_prompt || prompt.context_prompt)
    });
  };

  if (editingPrompt) {
    return (
      <motion.div key="prompt-editor" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="settings-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
          <button className="btn-secondary btn-tiny" style={{ padding: '6px' }} onClick={() => setEditingPrompt(null)}>
            <ArrowLeft size={16} />
          </button>
          <h3 style={{ margin: 0 }}>{editingPrompt.id ? "Редактирование" : "Создание промпта"}</h3>
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
            <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '4px' }}>Простые инструкции</strong>
            Пишите обычным языком, что именно должен сделать искусственный интеллект (какие правила грамматики объяснить, сколько примеров привести и т.д.)
          </div>
        </div>
        
        <div className="form-group">
          <label>Название шаблона</label>
          <input 
            type="text" 
            value={editingPrompt.name} 
            onChange={e => setEditingPrompt({ ...editingPrompt, name: e.target.value })} 
            placeholder="Например: Промпт для уровня B1" 
          />
        </div>

        <div className="form-group">
          <label>Инструкции для анализа и примеров</label>
          <p className="field-hint">Определяет правила разбора слов, грамматики и количество примеров в карточке</p>
          <textarea 
            value={editingPrompt.instruction} 
            onChange={e => setEditingPrompt({ ...editingPrompt, instruction: e.target.value })} 
            rows={10} 
            placeholder="Например: объясни слова с переводом на русский и грамматику, затем дай 3 примера. Очень коротко и ясно..."
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
          <button className="btn btn-primary btn-small" style={{ flex: 1 }} onClick={handleSavePrompt}>Сохранить</button>
          <button className="btn btn-secondary btn-small" style={{ flex: 1 }} onClick={() => setEditingPrompt(null)}>Отмена</button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div key="prompts-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="settings-section">
      <div className="section-header-with-btn">
        <h3>Шаблоны промптов</h3>
        <button className="btn btn-primary btn-tiny" onClick={handleCreateNew}>
          <Plus size={14} /> Создать промпт
        </button>
      </div>
      <p className="field-hint" style={{ marginBottom: '15px' }}>
        Создавайте разные промпты для изменения стиля разбора слов, грамматики или адаптации под нужный уровень владения языком.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* System Default Prompt */}
        <div className={`prompt-template-card glass ${activePromptId === null ? 'active' : ''}`} style={{
          padding: '12px 16px',
          borderRadius: '12px',
          border: activePromptId === null ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.05)',
          background: activePromptId === null ? 'rgba(56, 189, 248, 0.05)' : 'rgba(255,255,255,0.02)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: activePromptId === null ? '#38bdf8' : '#f1f5f9' }}>
              По умолчанию (Системный)
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
              Базовые инструкции для перевода и анализа
            </div>
          </div>
          <div>
            {activePromptId === null ? (
              <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Check size={14} /> Активен
              </span>
            ) : (
              <button className="btn-secondary btn-tiny" onClick={() => handleActivate(null)}>
                Активировать
              </button>
            )}
          </div>
        </div>

        {/* Custom User Prompts */}
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
                Пользовательский шаблон
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

        {promptsList.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '20px', fontSize: '0.8rem', color: '#64748b' }}>
            У вас пока нет собственных промптов. Нажмите «Создать промпт», чтобы добавить свой шаблон.
          </div>
        )}
      </div>
    </motion.div>
  );
};
