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
 * DesignTab — главный оркестратор редактора дизайна (Admin-only).
 *
 * Архитектура:
 * - Разделён на 5 внутренних вкладок: General, Front, Back, Exercise, CardList.
 * - Все изменения записываются в adminDraftDesignV2 (в памяти Zustand).
 * - Live preview изолирован внутри DesignPreviewScope (CSS-переменные только в превью).
 * - Глобальное приложение меняется ТОЛЬКО после явного нажатия «Опубликовать для всех».
 */
export const DesignTab = () => {
  useInterfaceLocale();

  const [activeSection, setActiveSection] = useState('general');

  const adminDraftDesignV2 = useSettingsStore(s => s.adminDraftDesignV2);
  const publishedDesignV2 = useSettingsStore(s => s.publishedDesignV2);
  const patchAdminDraft = useSettingsStore(s => s.patchAdminDraft);
  const resetDraftSection = useSettingsStore(s => s.resetDraftSection);
  const initAdminDraftFromPublished = useSettingsStore(s => s.initAdminDraftFromPublished);

  // Инициализация черновика из опубликованного дизайна при первом открытии
  useEffect(() => {
    initAdminDraftFromPublished();
  }, [initAdminDraftFromPublished]);

  // Текущая рабочая конфигурация для редактора
  const currentConfig = adminDraftDesignV2
    ?? (publishedDesignV2?.config ? normalizeDesignConfig(publishedDesignV2.config) : null)
    ?? DEFAULT_DESIGN_CONFIG_V2;

  const handleFieldChange = useCallback((dotPath, value) => {
    patchAdminDraft(dotPath, value);
  }, [patchAdminDraft]);

  const handleResetSection = useCallback((sectionId) => {
    resetDraftSection(sectionId);
  }, [resetDraftSection]);

  return (
    <div className="design-tab-container" style={{ padding: '4px 0 24px 0' }}>
      {/* Верхний тулбар: Пресеты, Сохранить черновик, Опубликовать, Копировать/Импорт JSON */}
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
