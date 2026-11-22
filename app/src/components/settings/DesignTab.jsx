import React, { useEffect, useState, useCallback } from 'react';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useSettingsStore } from '../../store/useSettingsStore';
import { normalizeDesignConfig, DEFAULT_DESIGN_CONFIG_V2 } from '../../design/designConfig.js';
import { DesignToolbar } from './design/DesignToolbar';
import { DesignSectionTabs } from './design/DesignSectionTabs';
import { GeneralDesignSection } from './design/sections/GeneralDesignSection';
import { FrontDesignSection } from './design/sections/FrontDesignSection';
import { BackDesignSection } from './design/sections/BackDesignSection';
import { ExerciseDesignSection } from './design/sections/ExerciseDesignSection';
import { CardListDesignSection } from './design/sections/CardListDesignSection';

/**
 * DesignTab — главный оркестратор редактора дизайна.
 *
 * Архитектура:
 * - Разделён на 5 внутренних вкладок: General, Front, Back, Exercise, CardList.
 * - Все изменения записываются только во временное состояние designEditorDraft (в памяти Zustand).
 * - Live preview изолирован внутри DesignPreviewScope (или временного предпросмотра в памяти).
 * - Личный дизайн сохраняется в USER_SETTINGS_<id>.designV2 только по кнопке «Сохранить мой дизайн».
 * - Общий дизайн по умолчанию (GLOBAL_DESIGN_V2) из редактора не изменяется.
 */
export const DesignTab = () => {
  useInterfaceLocale();

  const [activeSection, setActiveSection] = useState('general');

  const designEditorDraft = useSettingsStore(s => s.designEditorDraft);
  const activeDesignConfig = useSettingsStore(s => s.activeDesignConfig);
  const patchDesignEditorDraft = useSettingsStore(s => s.patchDesignEditorDraft);
  const resetDesignEditorSection = useSettingsStore(s => s.resetDesignEditorSection);
  const initDesignEditor = useSettingsStore(s => s.initDesignEditor);

  // Инициализация временного состояния редактора при открытии
  useEffect(() => {
    initDesignEditor();
  }, [initDesignEditor]);

  // Текущая рабочая конфигурация для редактора
  const currentConfig = designEditorDraft
    ?? (activeDesignConfig ? normalizeDesignConfig(activeDesignConfig) : null)
    ?? DEFAULT_DESIGN_CONFIG_V2;

  const handleFieldChange = useCallback((dotPath, value) => {
    patchDesignEditorDraft(dotPath, value);
  }, [patchDesignEditorDraft]);

  const handleResetSection = useCallback((sectionId) => {
    resetDesignEditorSection(sectionId);
  }, [resetDesignEditorSection]);

  return (
    <div className="design-tab-container" style={{ padding: '4px 0 24px 0' }}>
      {/* Верхний тулбар: Пресеты, Сохранить личный дизайн, Переключение режимов, Копировать/Экспорт/Импорт JSON */}
      <DesignToolbar
        activeSection={activeSection}
        onResetSection={handleResetSection}
      />

      {/* Переключатель разделов: Общее / Лицевая / Обратная / Упражнения / Список */}
      <DesignSectionTabs
        activeSection={activeSection}
        onSelectSection={setActiveSection}
      />

      {/* Активная секция настроек */}
      <div className="design-section-body">
        {activeSection === 'general' && (
          <GeneralDesignSection
            config={currentConfig}
            onChangeField={handleFieldChange}
          />
        )}
        {activeSection === 'front' && (
          <FrontDesignSection
            config={currentConfig}
            onChangeField={handleFieldChange}
          />
        )}
        {activeSection === 'back' && (
          <BackDesignSection
            config={currentConfig}
            onChangeField={handleFieldChange}
          />
        )}
        {activeSection === 'exercises' && (
          <ExerciseDesignSection
            config={currentConfig}
            onChangeField={handleFieldChange}
          />
        )}
        {activeSection === 'cardList' && (
          <CardListDesignSection
            config={currentConfig}
            onChangeField={handleFieldChange}
          />
        )}
      </div>
    </div>
  );
};
