import { tr } from '../../i18n/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Move, Trash2, X } from 'lucide-react';

/**
 * Floating bottom dock that appears in select-mode.
 * Contains range-input row + batch action buttons (Copy / Move / Delete / Cancel).
 *
 * Props:
 *   selectMode          {object}   – return value of useCardSelectMode, spread with filteredCards
 *   handleBatchDeleteCards {fn}    – async delete action from useCardActions
 */
export const FloatingBatchDock = ({ selectMode, handleBatchDeleteCards }) => {
  const {
    isSelectMode,
    selectedCardIds,
    setSelectedCardIds,
    setIsSelectMode,
    filteredCards,
    rangeInput,
    setRangeInput,
    handleSelectAll,
    handleApplyRange,
    toggleSelectMode,
    setBatchModalMode,
    setIsBatchMoveModalOpen,
  } = selectMode;

  return (
    <AnimatePresence>
      {isSelectMode && (
        <motion.div
          className="batch-actions-bar"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Row 1: Range input */}
          <form className="batch-range-row" onSubmit={handleApplyRange}>
            <div className="batch-range-input-wrapper">
              <input
                type="text"
                className="batch-range-input"
                placeholder={tr("№ карт: 1-10, 15...")}
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
              />
              {rangeInput && (
                <button
                  type="button"
                  className="batch-range-clear-btn"
                  onClick={() => setRangeInput('')}
                  title={tr("Очистить")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="batch-range-apply-btn"
              disabled={!rangeInput.trim()}
            >
              {tr("Выбрать")}
            </button>
            <button
              type="button"
              className="batch-range-all-btn"
              onClick={handleSelectAll}
              title={
                selectedCardIds.size === filteredCards.length && filteredCards.length > 0
                  ? tr("Снять выбор со всех")
                  : tr("Выбрать все карточки")
              }
            >
              {selectedCardIds.size === filteredCards.length && filteredCards.length > 0
                ? tr("Снять все")
                : tr("Все ({{p0}})", { p0: filteredCards.length })}
            </button>
          </form>

          {/* Row 2: Action buttons */}
          <div className="batch-buttons-row">
            <button
              type="button"
              className="batch-action-btn copy-btn"
              disabled={selectedCardIds.size === 0}
              onClick={() => { setBatchModalMode('copy'); setIsBatchMoveModalOpen(true); }}
              title={tr("Копировать выбранные карточки")}
            >
              <Copy size={15} />
              <span className="batch-btn-label">{tr("Копировать")}</span>
              <span className="batch-btn-count">({selectedCardIds.size})</span>
            </button>

            <button
              type="button"
              className="batch-action-btn move-btn"
              disabled={selectedCardIds.size === 0}
              onClick={() => { setBatchModalMode('move'); setIsBatchMoveModalOpen(true); }}
              title={tr("Переместить выбранные карточки")}
            >
              <Move size={15} />
              <span className="batch-btn-label">{tr("Переместить")}</span>
              <span className="batch-btn-count">({selectedCardIds.size})</span>
            </button>

            <button
              type="button"
              className="batch-action-btn delete-btn"
              disabled={selectedCardIds.size === 0}
              onClick={async () => {
                const ids = Array.from(selectedCardIds);
                const ok = await handleBatchDeleteCards(ids);
                if (ok) {
                  setSelectedCardIds(new Set());
                  setIsSelectMode(false);
                }
              }}
              title={tr("Удалить выбранные карточки")}
            >
              <Trash2 size={15} />
              <span className="batch-btn-label">{tr("Удалить")}</span>
              <span className="batch-btn-count">({selectedCardIds.size})</span>
            </button>

            <button
              type="button"
              className="batch-action-cancel-btn"
              onClick={toggleSelectMode}
              title={tr("Отмена")}
            >
              <X size={18} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
