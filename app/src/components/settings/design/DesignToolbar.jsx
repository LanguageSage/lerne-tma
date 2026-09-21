/**
 * DesignToolbar — панель управления дизайном для администратора.
 * Preset picker, Save draft, Publish (с confirm), Copy JSON, Import JSON, Reset section, Revert.
 */
import React, { useRef, useState } from 'react';
import { Save, Upload, Download, RotateCcw, Globe, ChevronDown, Copy, Check } from 'lucide-react';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { normalizeDesignConfig } from '../../../design/designConfig.js';
import { DESIGN_PRESETS } from '../../../constants/appConstants';
import { adaptDesignPresetsToV2 } from '../../../design/legacyAdapter.js';
import { tr } from '../../../i18n/locale';

const ADAPTED_PRESETS = adaptDesignPresetsToV2(DESIGN_PRESETS);

export const DesignToolbar = ({ activeSection, onResetSection }) => {
  const adminDraftDesignV2 = useSettingsStore(s => s.adminDraftDesignV2);
  const publishedDesignV2 = useSettingsStore(s => s.publishedDesignV2);
  const setAdminDraftDesignV2 = useSettingsStore(s => s.setAdminDraftDesignV2);
  const revertDraftToPublished = useSettingsStore(s => s.revertDraftToPublished);
  const saveAdminDraftToServer = useSettingsStore(s => s.saveAdminDraftToServer);
  const publishAdminDraftToServer = useSettingsStore(s => s.publishAdminDraftToServer);

  const [presetOpen, setPresetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const importRef = useRef(null);

  const handlePresetSelect = (preset) => {
    setAdminDraftDesignV2(preset.configV2);
    setPresetOpen(false);
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    await saveAdminDraftToServer();
    setSaving(false);
  };

  const handlePublishClick = () => {
    setPublishConfirm(true);
    setPublishError(null);
    setPublishSuccess(false);
  };

  const handlePublishConfirm = async () => {
    setPublishing(true);
    setPublishConfirm(false);
    const result = await publishAdminDraftToServer();
    setPublishing(false);
    if (result?.success) {
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 3000);
    } else {
      setPublishError(result?.error || tr('Ошибка публикации'));
      setTimeout(() => setPublishError(null), 5000);
    }
  };

  const handleCopyJson = () => {
    if (!adminDraftDesignV2) return;
    navigator.clipboard.writeText(JSON.stringify(adminDraftDesignV2, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleImportJson = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const normalized = normalizeDesignConfig(parsed);
        setAdminDraftDesignV2(normalized);
      } catch {
        // Silently ignore invalid JSON
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="design-toolbar">
      {/* Preset picker */}
      <div className="design-toolbar-group">
        <div className="design-preset-dropdown">
          <button
            className="design-toolbar-btn design-toolbar-preset"
            onClick={() => setPresetOpen(v => !v)}
          >
            🎨 {tr('Пресет')} <ChevronDown size={14} />
          </button>
          {presetOpen && (
            <div className="design-preset-menu">
              {ADAPTED_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  className="design-preset-item"
                  onClick={() => handlePresetSelect(preset)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Save / Publish */}
      <div className="design-toolbar-group">
        <button
          className="design-toolbar-btn"
          onClick={handleSaveDraft}
          disabled={saving}
          title={tr('Сохранить черновик на сервере')}
        >
          <Save size={15} />
          {saving ? tr('Сохранение...') : tr('Сохранить черновик')}
        </button>

        {publishConfirm ? (
          <>
            <span className="design-toolbar-confirm-text">{tr('Опубликовать для всех?')}</span>
            <button className="design-toolbar-btn design-toolbar-publish-confirm" onClick={handlePublishConfirm}>
              ✓ {tr('Да')}
            </button>
            <button className="design-toolbar-btn" onClick={() => setPublishConfirm(false)}>
              ✕ {tr('Нет')}
            </button>
          </>
        ) : (
          <button
            className={`design-toolbar-btn design-toolbar-publish ${publishSuccess ? 'design-toolbar-publish--success' : ''}`}
            onClick={handlePublishClick}
            disabled={publishing || !adminDraftDesignV2}
            title={tr('Опубликовать для всех пользователей')}
          >
            {publishSuccess ? <Check size={15} /> : <Globe size={15} />}
            {publishing ? tr('Публикация...') : publishSuccess ? tr('Опубликовано!') : tr('Опубликовать для всех')}
          </button>
        )}
      </div>

      {/* JSON tools */}
      <div className="design-toolbar-group">
        <button className="design-toolbar-btn" onClick={handleCopyJson} title={tr('Копировать JSON')}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>

        <button
          className="design-toolbar-btn"
          onClick={() => importRef.current?.click()}
          title={tr('Импорт JSON')}
        >
          <Upload size={15} />
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportJson}
        />

        <button
          className="design-toolbar-btn"
          onClick={() => onResetSection?.(activeSection)}
          title={tr('Сбросить раздел')}
        >
          <RotateCcw size={15} />
        </button>

        <button
          className="design-toolbar-btn"
          onClick={revertDraftToPublished}
          disabled={!publishedDesignV2}
          title={tr('Вернуть опубликованный')}
        >
          <Download size={15} />
        </button>
      </div>

      {publishError && (
        <div className="design-toolbar-error">{publishError}</div>
      )}
    </div>
  );
};
