import { tr } from '../i18n/locale';
export const FLAG_COLORS = {
  0: { id: 0, get name() { return tr("Без флага"); }, hex: null },
  1: { id: 1, get name() { return tr("Красный"); }, hex: '#ef4444' },
  2: { id: 2, get name() { return tr("Оранжевый"); }, hex: '#f97316' },
  3: { id: 3, get name() { return tr("Зеленый"); }, hex: '#22c55e' },
  4: { id: 4, get name() { return tr("Синий"); }, hex: '#3b82f6' },
  5: { id: 5, get name() { return tr("Розовый"); }, hex: '#ec4899' },
  6: { id: 6, get name() { return tr("Бирюзовый"); }, hex: '#06b6d4' },
  7: { id: 7, get name() { return tr("Фиолетовый"); }, hex: '#a855f7' },
};

export const getFlagStyle = (flagId) => {
  const flag = FLAG_COLORS[flagId];
  if (!flag || !flag.hex) return {};
  return {
    boxShadow: `0 0 20px ${flag.hex}70, inset 0 0 12px ${flag.hex}30`,
    borderColor: flag.hex,
    borderWidth: '1.5px',
    borderStyle: 'solid',
    backgroundColor: `${flag.hex}14`
  };
};
