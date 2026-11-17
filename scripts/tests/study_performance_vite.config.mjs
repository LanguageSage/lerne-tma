import config from './knowledge_http_vite.config.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async environment => {
  const base = await config(environment);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const files = ['app/src/components/common/MarkdownRenderer.jsx', 'app/src/components/deckgrid/CardList.jsx',
    'app/src/components/deckgrid/DeckActionsMenu.jsx', 'app/src/components/deckgrid/DeckCardItem.jsx',
    'app/src/components/deckgrid/DeckGrid.jsx', 'app/src/components/deckgrid/DraggableCardItem.jsx',
    'app/src/components/modals/CardActionModal.jsx', 'app/src/components/study/GradeButtons.jsx',
    'app/src/components/study/StudyView.jsx', 'app/src/hooks/useAppInitialization.js',
    'app/src/hooks/useCardNavigation.js', 'app/src/hooks/useCardNotes.js',
    'app/src/hooks/useCardSelectMode.js', 'app/src/hooks/useStudyNavigation.js',
    'app/src/hooks/useStudySession.js', 'app/src/services/api.js',
    'app/src/services/cardCutoverPreflight.js', 'app/src/services/knowledgeCaptureService.js',
    'app/src/services/knowledgeContentService.js', 'app/src/services/knowledgeDbService.js',
    'app/src/services/knowledgeSyncService.js', 'app/src/services/offlineApi.js',
    'app/src/services/syncService.js', 'app/src/store/slices/createDeckSlice.js',
    'app/src/store/useDeckStore.js', 'app/src/store/useSessionStore.js',
    'app/src/utils/structuredStudyCard.js'];
  const sources = new Map(process.env.STUDY_BASELINE === '1' ? files.map(file => [
    path.resolve(root, file).replaceAll('\\', '/'),
    execFileSync('git', ['show', `cf9dfe06416ee7ceb1b6f04445afdc5381527581:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true }),
  ]) : []);
  return { ...base, plugins: [{ name: 'reviewed-study-baseline', enforce: 'pre',
    load(id) { return sources.get(id.split('?')[0]); },
    transform(code, id) {
      if (id.split('?')[0].endsWith('/app/src/hooks/useStudySession.js')) {
        // Observe completion in both revisions without changing the application.
        return code + '\nexport const studyRefreshCount = () => refreshRequests.size;\n';
      }
    },
  }, ...base.plugins] };
};
