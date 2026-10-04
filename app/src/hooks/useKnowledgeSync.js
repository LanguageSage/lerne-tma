import { useEffect } from 'react';
import { startKnowledgeSync, stopKnowledgeSync } from '../services/knowledgeSyncOrchestrator.js';

/**
 * React hook to manage Knowledge Sync Orchestrator lifecycle across user logins,
 * logouts, user switches, and unmounting.
 * 
 * @param {string|number|null} userId - The active user's ID
 */
export function useKnowledgeSync(userId) {
  useEffect(() => {
    if (!userId) {
      stopKnowledgeSync();
      return;
    }

    startKnowledgeSync(userId);

    return () => {
      stopKnowledgeSync();
    };
  }, [userId]);
}
