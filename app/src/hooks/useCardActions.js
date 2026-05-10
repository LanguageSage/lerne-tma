import { useStudySession } from './useStudySession';
import { useCardEditor } from './useCardEditor';
import { useAiActions } from './useAiActions';

export const useCardActions = () => {
  const studySession = useStudySession();
  const cardEditor = useCardEditor();
  const aiActions = useAiActions();

  return {
    ...studySession,
    ...cardEditor,
    ...aiActions
  };
};

