import { useRef, useState } from 'react';
import { tr } from '../i18n/locale';
import { useDeckStore } from '../store/useDeckStore';
import { useUiStore } from '../store/useUiStore';
import { downloadCardText, loadCardTextExport } from '../services/cardTextExport';
import { CardTextExportError, CARD_TEXT_EXPORT_WARNINGS } from '../utils/cardTextSerializer';

export function useCardTextExport() {
  const [isExporting, setIsExporting] = useState(false);
  const pending = useRef(false);
  const exportText = async target => {
    if (pending.current) return;
    pending.current = true;
    setIsExporting(true);
    const showToast = useUiStore.getState().showToast;
    try {
      const { folders, decks } = useDeckStore.getState();
      const result = await loadCardTextExport({ ...target, folders, decks });
      if (!result.cardCount) {
        showToast(tr('Нет карточек для экспорта'), 'info');
        return;
      }
      downloadCardText(result);
      if (result.warnings.length) {
        showToast(tr('Файл скачан. Ограничения импорта:') + ' '
          + result.warnings.map(warning => tr(CARD_TEXT_EXPORT_WARNINGS[warning])).join(' '), 'info');
      } else {
        showToast(tr('Экспортировано карточек: {{count}}', { count: result.cardCount }), 'success');
      }
    } catch (error) {
      showToast(error instanceof CardTextExportError
        ? tr('Не удалось экспортировать «{{deck}}», карточка {{number}}: пустой FRONT или конфликт с маркерами импорта.',
          { deck: error.deckName, number: error.cardNumber })
        : tr('Не удалось экспортировать карточки. Повторите попытку.'), 'error');
    } finally {
      pending.current = false;
      setIsExporting(false);
    }
  };
  return { exportText, isExporting };
}
