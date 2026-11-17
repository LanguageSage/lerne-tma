import config from './knowledge_http_vite.config.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async environment => {
  const base = await config(environment);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const files = ['app/src/hooks/useStudyNavigation.js', 'app/src/hooks/useStudySession.js',
    'app/src/services/knowledgeContentService.js', 'app/src/services/knowledgeCaptureService.js',
    'app/src/store/slices/createDeckSlice.js', 'app/src/services/offlineApi.js',
    'app/src/services/api.js', 'app/src/components/study/StudyView.jsx'];
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
