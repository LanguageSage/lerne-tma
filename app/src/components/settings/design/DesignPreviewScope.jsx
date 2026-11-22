/**
 * DesignPreviewScope — изолированный контейнер для preview.
 *
 * Применяет CSS variables из временного состояния редактора только внутри этого контейнера.
 */
import React from 'react';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { designConfigToCssVariables } from '../../../design/designTokens.js';
import { normalizeDesignConfig, DEFAULT_DESIGN_CONFIG_V2 } from '../../../design/designConfig.js';

export const DesignPreviewScope = React.memo(({ children, className = '', style = {} }) => {
  const editorDraft = useSettingsStore(s => s.designEditorDraft);
  const activeConfig = useSettingsStore(s => s.activeDesignConfig);

  const previewConfig = editorDraft
    ?? (activeConfig ? normalizeDesignConfig(activeConfig) : null)
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
