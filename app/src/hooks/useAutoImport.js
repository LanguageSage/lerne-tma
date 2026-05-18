import { useState, useRef } from 'react';

export const useAutoImport = () => {
  const [importShareId, setImportShareId] = useState(null);
  const lastProcessedParam = useRef(null);

  const checkStartParam = () => {
    const tg = window.Telegram?.WebApp;
    const startParam = tg?.initDataUnsafe?.start_param || 
                      new URLSearchParams(window.location.search).get('tgWebAppStartParam') ||
                      new URLSearchParams(window.location.hash.replace('#', '?')).get('tgWebAppStartParam');
    
    if (startParam && (startParam.startsWith('c_') || startParam.startsWith('d_'))) {
      if (startParam !== lastProcessedParam.current) {
        console.log("New share parameter detected:", startParam);
        lastProcessedParam.current = startParam;
        setImportShareId(startParam);
      }
    }
  };

  return { importShareId, setImportShareId, checkStartParam };
};
