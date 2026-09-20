/**
 * DesignPreviewScope — изолированный контейнер для preview.
 *
 * Применяет CSS variables из adminDraftDesignV2 только внутри этого контейнера.
 * Draft НЕ утекает в глобальный DOM.
 * Реальное приложение всегда использует published design через applyPublishedDesignTokens().
 *
 * Использование:
 *   <DesignPreviewScope>
 *     <StudyCardPreview />
 *   </DesignPreviewScope>
 */
import React from 'react';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { designConfigToCssVariables } from '../../../design/designTokens.js';
import { normalizeDesignConfig, DEFAULT_DESIGN_CONFIG_V2 } from '../../../design/designConfig.js';

export const DesignPreviewScope = React.memo(({ children, className = '', style = {} }) => {
  const adminDraft = useSettingsStore(s => s.adminDraftDesignV2);
  const published = useSettingsStore(s => s.publishedDesignV2);

  // Preview показывает draft → published → defaults (в таком приоритете)
  const previewConfig = adminDraft
    ?? (published?.config ? normalizeDesignConfig(published.config) : null)
    ?? DEFAULT_DESIGN_CONFIG_V2;

  const cssVars = designConfigToCssVariables(previewConfig);

  return (
    <div
      className={`design-preview-scope ${className}`}
      style={{ ...cssVars, ...style }}
    >
      {children}
    </div>
  );
});

DesignPreviewScope.displayName = 'DesignPreviewScope';
