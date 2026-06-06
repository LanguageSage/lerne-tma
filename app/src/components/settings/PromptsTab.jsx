import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit2, Check, Plus, ArrowLeft } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';

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
        translation_prompt: editingPrompt.translation_prompt,
        context_prompt: editingPrompt.context_prompt
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
    let activeContext = defaults.ru;
    
    if (activePromptId !== null) {
      const active = promptsList.find(p => p.id === activePromptId);
      if (active) {
        activeTranslation = active.translation_prompt;
        activeContext = active.context_prompt;
      }
    }
    
    setEditingPrompt({
      id: null,
      name: "Мой промпт",
      translation_prompt: activeTranslation,
      context_prompt: activeContext
    });
  };

  const handleEditPrompt = (prompt) => {
    setEditingPrompt({
      id: prompt.id,
      name: prompt.name,
      translation_prompt: prompt.translation_prompt,
      context_prompt: prompt.context_prompt
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
          <label>Промпт для немецкого слова/фразы (Германия ➡️ Россия)</label>
          <p className="field-hint">Определяет анализ немецких слов, грамматики и примеры</p>
          <textarea 
            value={editingPrompt.translation_prompt} 
            onChange={e => setEditingPrompt({ ...editingPrompt, translation_prompt: e.target.value })} 
            rows={8} 
            placeholder="Инструкции для немецкого..."
          />
        </div>

        <div className="form-group">
          <label>Промпт для русского слова/фразы (Россия ➡️ Германия)</label>
          <p className="field-hint">Определяет перевод на немецкий и последующий анализ</p>
          <textarea 
            value={editingPrompt.context_prompt} 
            onChange={e => setEditingPrompt({ ...editingPrompt, context_prompt: e.target.value })} 
            rows={8} 
            placeholder="Инструкции для перевода русского..."
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
