export const FLAG_COLORS = {
  0: { id: 0, name: 'Без флага', hex: null },
  1: { id: 1, name: 'Красный', hex: '#ef4444' },
  2: { id: 2, name: 'Оранжевый', hex: '#f97316' },
  3: { id: 3, name: 'Зеленый', hex: '#22c55e' },
  4: { id: 4, name: 'Синий', hex: '#3b82f6' },
  5: { id: 5, name: 'Розовый', hex: '#ec4899' },
  6: { id: 6, name: 'Бирюзовый', hex: '#06b6d4' },
  7: { id: 7, name: 'Фиолетовый', hex: '#a855f7' },
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
