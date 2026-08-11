import { useState, useRef, useEffect } from 'react';

export const useAutoImport = () => {
  const [importShareId, setImportShareId] = useState(null);
  const lastProcessedParam = useRef(null);

  const checkStartParam = () => {
    const tg = window.Telegram?.WebApp;
    const startParam = tg?.initDataUnsafe?.start_param || 
                      new URLSearchParams(window.location.search).get('tgWebAppStartParam') ||
                      new URLSearchParams(window.location.hash.replace('#', '?')).get('tgWebAppStartParam');
    
    if (startParam && (startParam.startsWith('c_') || startParam.startsWith('d_') || startParam.startsWith('f_'))) {
      if (startParam !== lastProcessedParam.current) {
        console.log("New share parameter detected:", startParam);
        lastProcessedParam.current = startParam;
        setImportShareId(startParam);

        // Clean up URL search parameter if present so page refreshes don't re-open processed link
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has('tgWebAppStartParam')) {
            url.searchParams.delete('tgWebAppStartParam');
            window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
          }
        } catch (e) {
          // ignore
        }
      }
    }
  };

  const clearImportShareId = () => {
    setImportShareId(null);
    // Keep lastProcessedParam.current populated to prevent visibilitychange loops
  };

  useEffect(() => {
    checkStartParam();
  }, []);

  return { importShareId, setImportShareId, clearImportShareId, checkStartParam };
};
