/**
 * DesignToolbar — панель управления личным дизайном пользователя (Design V2).
 * Preset picker, Save personal design, Switch global/personal, Local preview toggle, Copy/Export/Import JSON, Reset, Revert, Undo.
 */
import React, { useRef, useState } from 'react';
import { Save, Upload, Download, RotateCcw, Globe, ChevronDown, Copy, Check, Eye, Undo2, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { normalizeDesignConfig } from '../../../design/designConfig.js';
import { DESIGN_PRESETS } from '../../../design/designPresets.js';
import { isPersonalDesignActive, hasSavedPersonalDesign } from '../../../design/personalDesignMigration.js';
import { tr } from '../../../i18n/locale';

export const DesignToolbar = ({ activeSection, onResetSection }) => {
  const designEditorDraft = useSettingsStore(s => s.designEditorDraft);
  const activeDesignConfig = useSettingsStore(s => s.activeDesignConfig);
  const personalDesignV2 = useSettingsStore(s => s.personalDesignV2);
  const hasUnsavedDesignChanges = useSettingsStore(s => s.hasUnsavedDesignChanges);
  const isLocalPreviewActive = useSettingsStore(s => s.designPreviewInApp);
  const toggleDesignPreviewInApp = useSettingsStore(s => s.toggleDesignPreviewInApp);
  const setDesignEditorDraft = useSettingsStore(s => s.setDesignEditorDraft);
  const revertDesignEditorChanges = useSettingsStore(s => s.revertDesignEditorChanges);
  const savePersonalDesignToServer = useSettingsStore(s => s.savePersonalDesignToServer);
  const setPersonalDesignEnabled = useSettingsStore(s => s.setPersonalDesignEnabled);
  const applyDesignEditorSections = useSettingsStore(s => s.applyDesignEditorSections);

  const personalPreset = personalDesignV2?.preset;
  const isPersonalActive = isPersonalDesignActive(personalDesignV2);
  const hasSavedPersonal = hasSavedPersonalDesign(personalDesignV2);
  const hasUnsaved = hasUnsavedDesignChanges();

  const [presetOpen, setPresetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toolMessage, setToolMessage] = useState('');
  const [actionError, setActionError] = useState(null);
  const [undoDraft, setUndoDraft] = useState(null);
  const importRef = useRef(null);

  const busy = saving || switchingMode;

  // Пресет задаёт только лицевую/обратную стороны и список карточек: «Общее» и упражнения не трогаем.
  const handlePresetSelect = (preset) => {
    setUndoDraft(applyDesignEditorSections(preset.configV2, ['front', 'back', 'cardList']));
    setPresetOpen(false);
    setToolMessage(tr('Пресет применён. Раздел «Общее» не изменён.'));
  };

  const handleUndo = () => {
    if (!undoDraft) return;
    setDesignEditorDraft(undoDraft);
    setUndoDraft(null);
    setToolMessage(tr('Изменение отменено'));
  };

  const runServerAction = async (setBusy, operation, successMessage, fallbackError) => {
    setBusy(true);
    setActionError(null);
    const result = await operation();
    setBusy(false);
    if (result?.success) {
      setUndoDraft(null);
      setToolMessage(successMessage);
    } else {
      setActionError(result?.error || fallbackError);
    }
  };

  const handleSavePersonal = () => {
    if (!designEditorDraft) return;
    return runServerAction(setSaving, () => savePersonalDesignToServer(designEditorDraft), tr('Мой дизайн сохранён'), tr('Ошибка сохранения'));
  };

  const handleUseGlobal = () =>
    runServerAction(setSwitchingMode, () => setPersonalDesignEnabled(false), tr('Включён общий дизайн. Ваши личные настройки сохранены.'), tr('Ошибка переключения'));

  const handleEnablePersonal = () =>
    runServerAction(setSwitchingMode, () => setPersonalDesignEnabled(true), tr('Включён ваш личный дизайн'), tr('Ошибка переключения'));

  const handleToggleLocalPreview = () => {
    const next = toggleDesignPreviewInApp();
    setToolMessage(next ? tr('Предпросмотр применён в этом окне') : tr('Предпросмотр выключен'));
    setTimeout(() => setToolMessage(''), 3000);
  };

  const exportSource = designEditorDraft ?? activeDesignConfig;

  const handleCopyJson = () => {
    if (!exportSource) return;
    navigator.clipboard.writeText(JSON.stringify(normalizeDesignConfig(exportSource), null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setToolMessage(tr('Не удалось скопировать JSON')));
  };

  const handleExportJson = () => {
    if (!exportSource) return;
    const blob = new Blob([JSON.stringify(normalizeDesignConfig(exportSource), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lerne-design-v2.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportJson = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid config');
        const source = parsed.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config)
          ? parsed.config
          : parsed;
        const normalized = normalizeDesignConfig(source);
        setUndoDraft(designEditorDraft);
        setDesignEditorDraft(normalized);
        setToolMessage(tr('JSON импортирован в редактор'));
      } catch {
        setToolMessage(tr('Некорректный JSON: настройки не изменены'));
      }
    };
    reader.onerror = () => setToolMessage(tr('Не удалось прочитать файл'));
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResetSectionClick = () => {
    if (designEditorDraft) setUndoDraft(designEditorDraft);
    onResetSection?.(activeSection);
  };

  const handleRevertClick = () => {
    if (designEditorDraft) setUndoDraft(designEditorDraft);
    revertDesignEditorChanges();
    setToolMessage(tr('Несохранённые изменения сброшены'));
  };

  const myPresetConfig = personalPreset || (hasSavedPersonal ? personalDesignV2.config : null);

  return (
    <div className="design-toolbar">
      <div className="design-toolbar-mode" style={{ width: '100%', fontSize: '0.82rem', color: '#cbd5e1', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <span>{isPersonalActive ? tr('Активен: Мой дизайн') : tr('Активен: Общий дизайн')}</span>
        {hasUnsaved && <span style={{ color: '#fbbf24' }}>• {tr('Есть несохранённые изменения')}</span>}
      </div>

      {/* Preset picker */}
      <div className="design-toolbar-group">
        <div className="design-preset-dropdown">
          <button
            type="button"
            className="design-toolbar-btn design-toolbar-preset"
            onClick={() => setPresetOpen(v => !v)}
          >
            🎨 {tr('Пресет')} <ChevronDown size={14} />
          </button>
          {presetOpen && (
            <div className="design-preset-menu">
              {[...DESIGN_PRESETS, ...(myPresetConfig ? [{ id: 'personal', name: tr('Мой дизайн'), configV2: myPresetConfig }] : [])].map(preset => (
                <button
                  type="button"
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

      {/* Save personal / Switch global-personal / Preview / Admin publish */}
      <div className="design-toolbar-group">
        <button
          type="button"
          className="design-toolbar-btn"
          onClick={handleSavePersonal}
          disabled={busy || !designEditorDraft}
          title={tr('Сохранить как личный дизайн')}
        >
          <Save size={15} />
          {saving ? tr('Сохранение...') : tr('Сохранить мой дизайн')}
        </button>

        {isPersonalActive ? (
          <button
            type="button"
            className="design-toolbar-btn"
            onClick={handleUseGlobal}
            disabled={busy}
            title={tr('Переключиться на общий дизайн без удаления личных настроек')}
          >
            <Globe size={15} />
            {tr('Использовать общий дизайн')}
          </button>
        ) : hasSavedPersonal ? (
          <button
            type="button"
            className="design-toolbar-btn"
            onClick={handleEnablePersonal}
            disabled={busy}
            title={tr('Повторно включить сохранённый личный дизайн')}
          >
            <Sparkles size={15} />
            {tr('Включить мой дизайн')}
          </button>
        ) : null}

        <button
          type="button"
          className={`design-toolbar-btn ${isLocalPreviewActive ? 'design-toolbar-local-active' : ''}`}
          onClick={handleToggleLocalPreview}
          disabled={!designEditorDraft}
          title={isLocalPreviewActive ? tr('Отключить временный предпросмотр') : tr('Применить изменения для предпросмотра')}
        >
          <Eye size={15} />
          {isLocalPreviewActive ? tr('Только у меня: ВКЛ') : tr('Применить только у меня')}
        </button>
      </div>

      {/* Undo / revert */}
      <div className="design-toolbar-group">
        <button type="button" className="design-toolbar-btn" onClick={handleUndo} disabled={!undoDraft} title={tr('Отменить')} aria-label={tr('Отменить')}>
          <Undo2 size={15} /> {tr('Отменить')}
        </button>
        <button
          type="button"
          className="design-toolbar-btn"
          onClick={handleRevertClick}
          disabled={!hasUnsaved}
          title={tr('Сбросить несохранённые изменения')}
          aria-label={tr('Сбросить изменения')}
        >
          <RotateCcw size={15} /> {tr('Сбросить изменения')}
        </button>
      </div>

      {/* JSON tools & section reset */}
      <div className="design-toolbar-group">
        <button type="button" className="design-toolbar-btn" onClick={handleExportJson} title={tr('Экспорт JSON')} aria-label={tr('Экспорт JSON')}><Download size={15} /></button>
        <button type="button" className="design-toolbar-btn" onClick={handleCopyJson} title={tr('Копировать JSON')} aria-label={tr('Копировать JSON')}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>

        <button
          type="button"
          className="design-toolbar-btn"
          onClick={() => importRef.current?.click()}
          title={tr('Импорт JSON')} aria-label={tr('Импорт JSON')}
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
          type="button"
          className="design-toolbar-btn"
          onClick={handleResetSectionClick}
          title={tr('Сбросить раздел')} aria-label={tr('Сбросить раздел')}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      {toolMessage && <div role="status" className="design-toolbar-status">{toolMessage}</div>}
      {actionError && (
        <div role="alert" className="design-toolbar-error">{actionError}</div>
      )}
    </div>
  );
};
