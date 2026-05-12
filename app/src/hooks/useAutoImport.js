import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';

export const useAutoImport = () => {
  const { showToast, userProfile } = useUiStore();
  const { fetchDecks } = useDeckStore();
  
  const [importShareId, setImportShareId] = useState(null);
  const [importingAuto, setImportingAuto] = useState(false);
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

  useEffect(() => {
    const processAutoImport = async () => {
      if (!importShareId || importingAuto) return;
      if (!userProfile) return;

      setImportingAuto(true);
      console.log("Starting auto-import for:", importShareId);
      showToast("⌛ Обработка ссылки...", "info");
      
      try {
        const res = await api.post('/share/import', { share_id: importShareId });
        if (res.data.status === 'ok') {
          const msg = res.data.type === 'deck'
            ? `✅ Колода «${res.data.deck_name}» добавлена!`
            : '✅ Карточка добавлена во Входящие!';
          
          showToast(msg, 'success');
          setImportShareId(null);
          await fetchDecks(userProfile.user_id);
        }
      } catch (err) {
        console.error("Auto-import error:", err);
        const errorMsg = err.response?.data?.detail || "Ошибка при добавлении.";
        showToast(`❌ ${errorMsg}`, "error");
        setImportShareId(null);
      } finally {
        setImportingAuto(false);
      }
    };

    processAutoImport();
  }, [importShareId, userProfile, fetchDecks, showToast, importingAuto]);

  return { importShareId, setImportShareId, checkStartParam };
};
