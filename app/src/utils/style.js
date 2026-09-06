import { CARD_LIST_BG_PRESETS } from '../constants/appConstants';

export const getTextShadow = (effect, color) => {
  switch (effect) {
    case 'shadow':
      return '0 0.08em 0.16em rgba(0,0,0,0.5)';
    case 'glow':
      return `0 0 0.22em ${color}aa, 0 0.06em 0.12em rgba(0,0,0,0.5)`;
    case 'neon':
      return `0 0 0.12em #fff, 0 0 0.25em ${color}, 0 0 0.45em ${color}, 0 0.06em 0.12em rgba(0,0,0,0.5)`;
    case 'outline':
      return `-1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8), 0 0.06em 0.12em rgba(0,0,0,0.3)`;
    case 'glass':
      return `0 0 0.35em rgba(255,255,255,0.3), 0 0.06em 0.12em rgba(0,0,0,0.2)`;
    case 'none':
    default:
      return 'none';
  }
};

export const getContextShadow = (effect, color) => {
  switch (effect) {
    case 'shadow':
      return '0 0.06em 0.12em rgba(0,0,0,0.3)';
    case 'glow':
      return `0 0 0.18em ${color}88, 0 0.05em 0.1em rgba(0,0,0,0.3)`;
    case 'neon':
      return `0 0 0.1em #fff, 0 0 0.2em ${color}, 0 0 0.35em ${color}`;
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

export const getCardListBgStyle = (previewCardBg = 'dark_obsidian') => {
  const preset = CARD_LIST_BG_PRESETS.find(p => p.id === previewCardBg);
  if (preset) {
    return {
      className: preset.bgClass,
      style: {
        '--card-list-accent': preset.accent,
        '--card-list-hover-border': `${preset.accent}66`,
      }
    };
  }

  if (previewCardBg === 'dark_obsidian' || previewCardBg === 'dark_minimal' || 
      previewCardBg === 'dark_midnight' || previewCardBg === 'dark_emerald' || 
      previewCardBg === 'dark_mocha') {
    return {
      className: `bg-${previewCardBg.replace('_', '-')}`,
      style: {
        '--card-list-accent': '#38bdf8',
        '--card-list-hover-border': 'rgba(56, 189, 248, 0.4)',
      }
    };
  }

  return {
    className: '',
    style: {
      background: previewCardBg || '#1e293b',
      '--card-list-accent': '#38bdf8',
      '--card-list-hover-border': 'rgba(56, 189, 248, 0.4)',
    }
  };
};
