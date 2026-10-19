import React from 'react';
import './components/common/Common.css';
import { GameView } from './components/game/GameView';
import { Toast } from './components/common/Toast';
import { useUiStore } from './store/useUiStore';
import { useInterfaceLocale } from './i18n/useInterfaceLocale';
import { setInterfaceLanguage, tr } from './i18n/locale';
import { DEFAULT_DESIGN_CONFIG_V2 } from './design/designConfig';
import { applyPublishedDesignTokens } from './design/designTokens';

applyPublishedDesignTokens(DEFAULT_DESIGN_CONFIG_V2);

export default function App() {
  const language = useInterfaceLocale();
  const toast = useUiStore(state => state.toast);
  return <div id="app-container" className="app-container">
    <label className="game-language">{tr('Язык интерфейса')}
      <select aria-label={tr('Язык интерфейса')} value={language} onChange={event => setInterfaceLanguage(event.target.value)}>
        <option value="ru">Русский</option><option value="uk">Українська</option><option value="en">English</option>
      </select>
    </label>
    <GameView />
    <Toast toast={toast} />
  </div>;
}
