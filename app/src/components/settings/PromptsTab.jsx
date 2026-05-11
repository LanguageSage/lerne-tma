import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';

export const PromptsTab = () => {
  const { userPrompts, updateUserPrompt } = useSettingsStore();
  const { showToast } = useUiStore();

  const saveUserPrompts = async () => {
    const prompts = useSettingsStore.getState().userPrompts;
    try {
      await api.post('/user/prompts', prompts);
      showToast("Промпты сохранены", "success");
    } catch (err) {
      showToast("Ошибка сохранения промптов");
    }
  };

  return (
    <motion.div key="prompts" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>Промпты генерации</h3>
      <div className="form-group">
        <label>Системные инструкции</label>
        <p className="field-hint">Определяют стиль перевода и глубину анализа</p>
        <textarea 
          value={userPrompts.translation_prompt || ''} 
          onChange={e => updateUserPrompt('translation_prompt', e.target.value)} 
          rows={8} 
          placeholder="You are a language teacher..."
        />
      </div>
      <button className="btn btn-primary btn-small" onClick={saveUserPrompts}>Сохранить промпты</button>
    </motion.div>
  );
};
