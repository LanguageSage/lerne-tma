import React from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';

export const PresetsTab = ({ 
  newPresetName, 
  setNewPresetName, 
  saveCurrentAsPreset, 
  presets, 
  applyPreset, 
  deletePreset 
}) => {
  const { adminSettings } = useSettingsStore();

  return (
    <motion.div key="presets" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>Управление пресетами</h3>
      <div className="preset-save-box glass">
        <input 
          placeholder="Имя нового пресета..." 
          value={newPresetName} 
          onChange={e => setNewPresetName(e.target.value)} 
        />
        <button className="btn btn-primary btn-small" onClick={saveCurrentAsPreset}>Сохранить текущие</button>
      </div>
      
      <div className="presets-list scrollable">
        {presets.length === 0 ? <p className="hint">Нет сохраненных пресетов</p> : 
          presets.map((p, idx) => (
            <div key={idx} className="preset-item glass">
              <div className="preset-info">
                <strong>{p.name}</strong>
                <span>{p.settings?.AI_PROVIDER} | {p.settings?.DEFAULT_MODEL?.split('/').pop()}</span>
              </div>
              <div className="preset-actions">
                <button className="apply-btn" onClick={() => applyPreset(p)}>Применить</button>
                <button className="delete-btn-minimal" onClick={() => deletePreset(idx)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))
        }
      </div>
    </motion.div>
  );
};
