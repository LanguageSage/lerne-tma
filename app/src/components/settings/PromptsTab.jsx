import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';

export const PromptsTab = ({ saveUserPrompts }) => {
  const { userPrompts, updateUserPrompt } = useSettingsStore();

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
