import { useState, useRef, useEffect } from 'react';

export const useAutoImport = () => {
  const [importShareId, setImportShareId] = useState(null);
  const lastProcessedParam = useRef(null);

  const checkStartParam = () => {
    const tg = window.Telegram?.WebApp;
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace('#', '?'));
    
    let startParam = tg?.initDataUnsafe?.start_param || 
                      urlParams.get('tgWebAppStartParam') ||
                      urlParams.get('startapp') ||
                      urlParams.get('start') ||
                      urlParams.get('share_id') ||
                      hashParams.get('tgWebAppStartParam') ||
                      hashParams.get('startapp') ||
                      hashParams.get('start') ||
                      hashParams.get('share_id');
    
    if (startParam) {
      startParam = String(startParam).trim();
      if (startParam.includes('?')) startParam = startParam.split('?')[0];
      if (startParam.includes('&')) startParam = startParam.split('&')[0];
      if (startParam.includes('#')) startParam = startParam.split('#')[0];
    }
    
    if (startParam && (
      startParam.startsWith('c_') || 
      startParam.startsWith('d_') || 
      startParam.startsWith('f_') || 
      startParam.startsWith('collab_')
    )) {
      if (startParam !== lastProcessedParam.current) {
        console.log("New share parameter detected:", startParam);
        lastProcessedParam.current = startParam;
        setImportShareId(startParam);

        // Clean up URL search parameter if present so page refreshes don't re-open processed link
        try {
          const url = new URL(window.location.href);
          let modified = false;
          ['tgWebAppStartParam', 'startapp', 'start', 'share_id'].forEach(param => {
            if (url.searchParams.has(param)) {
              url.searchParams.delete(param);
              modified = true;
            }
          });
          if (modified) {
            window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
          }
        } catch {
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
    const timer = setTimeout(() => {
      checkStartParam();
    }, 0);
    return () => clearTimeout(timer);
  }, []);


  return { importShareId, setImportShareId, clearImportShareId, checkStartParam };
};
