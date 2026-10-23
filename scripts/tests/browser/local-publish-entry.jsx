import React from '../../../app/node_modules/react/index.js';
import { createRoot } from '../../../app/node_modules/react-dom/client.js';
import { LocalPublishButton } from '../../../app/src/components/common/LocalPublishButton.jsx';
import { syncService } from '../../../app/src/services/syncService.js';
import { StudyHeader } from '../../../app/src/components/study/StudyHeader.jsx';
import { useUiStore } from '../../../app/src/store/useUiStore.js';
import { LanguageProvider } from '../../../app/src/i18n/i18nContext.jsx';
import '../../../app/src/index.css';
import '../../../app/src/App.css';

window.publishOrder = [];
syncService.sync = async () => { window.publishOrder.push('sync'); return { success: true }; };
const root = createRoot(document.getElementById('harness'));
window.renderPublish = id => root.render(React.createElement(LocalPublishButton, {
  cardId: id, beforeOpen: async () => { window.publishOrder.push('save'); return { id }; },
}));
window.renderStudyHeader = () => {
  useUiStore.setState({ hasInitialized: true, userProfile: { user_id: 900000001, first_name: 'Local Test', is_guest: false } });
  root.render(React.createElement(LanguageProvider, null, React.createElement(StudyHeader, { card: { id: 101 },
    deckName: 'Урок A1 · Grundlagen und häufig verwendete Ausdrücke', isTrainerDeck: true,
    onBack() {}, onOpenCreator() {}, onOpenEditor() {}, onOpenSettings() {},
  })));
};
