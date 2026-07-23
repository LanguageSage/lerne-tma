export const getTextShadow = (effect, color) => {
  switch (effect) {
    case 'shadow':
      return '0 2px 4px rgba(0,0,0,0.5)';
    case 'glow':
      return `0 0 10px ${color}aa, 0 2px 4px rgba(0,0,0,0.5)`;
    case 'neon':
      return `0 0 5px #fff, 0 0 10px ${color}, 0 0 20px ${color}, 0 2px 4px rgba(0,0,0,0.5)`;
    case 'outline':
      return `-1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.3)`;
    case 'glass':
      return `0 0 15px rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.2)`;
    case 'none':
    default:
      return 'none';
  }
};

export const getContextShadow = (effect, color) => {
  switch (effect) {
    case 'shadow':
      return '0 1px 2px rgba(0,0,0,0.3)';
    case 'glow':
      return `0 0 8px ${color}88, 0 1px 2px rgba(0,0,0,0.3)`;
    case 'neon':
      return `0 0 4px #fff, 0 0 8px ${color}, 0 0 12px ${color}`;
    case 'outline':
      return `-0.5px -0.5px 0 rgba(0,0,0,0.6), 0.5px -0.5px 0 rgba(0,0,0,0.6), -0.5px 0.5px 0 rgba(0,0,0,0.6), 0.5px 0.5px 0 rgba(0,0,0,0.6)`;
    case 'none':
    default:
      return 'none';
  }
};

export const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];

export const getResolvedStyle = (settingStyle, cardId) => {
  if (settingStyle !== 'auto') return settingStyle;
  if (!cardId) return 'standard';
  const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return availableStyles[sum % availableStyles.length];
};
