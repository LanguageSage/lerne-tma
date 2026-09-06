import { tr } from '../i18n/locale';
/**
 * 16 Bundesländer (Federal States of Germany)
 * Contains codes, German and Russian names, capitals, and theme styling.
 */

export const BUNDESLAENDER = [
  {
    code: 'BW',
    nameDe: 'Baden-Württemberg',
    get nameRu() { return tr("Баден-Вюртемберг"); },
    capital: 'Stuttgart',
    symbol: '🦁',
    color: '#fbbf24',
    gradient: 'linear-gradient(135deg, #1e293b 0%, #d97706 100%)',
    flagColors: ['#000000', '#fbbf24'],
    get shortDesc() { return tr("Stuttgart • 10 вопросов"); }
  },
  {
    code: 'BY',
    nameDe: 'Bayern',
    get nameRu() { return tr("Бавария"); },
    capital: 'München',
    symbol: '🥨',
    color: '#38bdf8',
    gradient: 'linear-gradient(135deg, #0284c7 0%, #bae6fd 100%)',
    flagColors: ['#ffffff', '#0284c7'],
    get shortDesc() { return tr("München • 10 вопросов"); }
  },
  {
    code: 'BE',
    nameDe: 'Berlin',
    get nameRu() { return tr("Берлин"); },
    capital: 'Berlin',
    symbol: '🐻',
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #b91c1c 0%, #f87171 100%)',
    flagColors: ['#ffffff', '#ef4444'],
    get shortDesc() { return tr("Hauptstadt • 10 вопросов"); }
  },
  {
    code: 'BB',
    nameDe: 'Brandenburg',
    get nameRu() { return tr("Бранденбург"); },
    capital: 'Potsdam',
    symbol: '🦅',
    color: '#f87171',
    gradient: 'linear-gradient(135deg, #991b1b 0%, #fca5a5 100%)',
    flagColors: ['#ef4444', '#ffffff'],
    get shortDesc() { return tr("Potsdam • 10 вопросов"); }
  },
  {
    code: 'HB',
    nameDe: 'Bremen',
    get nameRu() { return tr("Бремен"); },
    capital: 'Bremen',
    symbol: '🗝️',
    color: '#f43f5e',
    gradient: 'linear-gradient(135deg, #be123c 0%, #fda4af 100%)',
    flagColors: ['#e11d48', '#ffffff'],
    get shortDesc() { return tr("Stadtstaat • 10 вопросов"); }
  },
  {
    code: 'HH',
    nameDe: 'Hamburg',
    get nameRu() { return tr("Гамбург"); },
    capital: 'Hamburg',
    symbol: '⚓',
    color: '#e11d48',
    gradient: 'linear-gradient(135deg, #881337 0%, #f43f5e 100%)',
    flagColors: ['#e11d48', '#ffffff'],
    get shortDesc() { return tr("Hansestadt • 10 вопросов"); }
  },
  {
    code: 'HE',
    nameDe: 'Hessen',
    get nameRu() { return tr("Гессен"); },
    capital: 'Wiesbaden',
    symbol: '🦁',
    color: '#60a5fa',
    gradient: 'linear-gradient(135deg, #1d4ed8 0%, #93c5fd 100%)',
    flagColors: ['#ef4444', '#ffffff'],
    get shortDesc() { return tr("Wiesbaden • 10 вопросов"); }
  },
  {
    code: 'MV',
    nameDe: 'Mecklenburg-Vorpommern',
    get nameRu() { return tr("Мекленбург-Передняя Померания"); },
    capital: 'Schwerin',
    symbol: '🐂',
    color: '#38bdf8',
    gradient: 'linear-gradient(135deg, #0369a1 0%, #e0f2fe 100%)',
    flagColors: ['#0284c7', '#ffffff', '#eab308', '#dc2626'],
    get shortDesc() { return tr("Schwerin • 10 вопросов"); }
  },
  {
    code: 'NI',
    nameDe: 'Niedersachsen',
    get nameRu() { return tr("Нижняя Саксония"); },
    capital: 'Hannover',
    symbol: '🐎',
    color: '#fb7185',
    gradient: 'linear-gradient(135deg, #475569 0%, #e2e8f0 100%)',
    flagColors: ['#000000', '#dc2626', '#eab308'],
    get shortDesc() { return tr("Hannover • 10 вопросов"); }
  },
  {
    code: 'NW',
    nameDe: 'Nordrhein-Westfalen',
    get nameRu() { return tr("Северный Рейн-Вестфалия"); },
    capital: 'Düsseldorf',
    symbol: '🌊',
    color: '#4ade80',
    gradient: 'linear-gradient(135deg, #15803d 0%, #86efac 100%)',
    flagColors: ['#16a34a', '#ffffff', '#dc2626'],
    get shortDesc() { return tr("Düsseldorf • 10 вопросов"); }
  },
  {
    code: 'RP',
    nameDe: 'Rheinland-Pfalz',
    get nameRu() { return tr("Рейнланд-Пфальц"); },
    capital: 'Mainz',
    symbol: '🍇',
    color: '#a855f7',
    gradient: 'linear-gradient(135deg, #6b21a8 0%, #d8b4fe 100%)',
    flagColors: ['#000000', '#dc2626', '#eab308'],
    get shortDesc() { return tr("Mainz • 10 вопросов"); }
  },
  {
    code: 'SL',
    nameDe: 'Saarland',
    get nameRu() { return tr("Саар"); },
    capital: 'Saarbrücken',
    symbol: '⚒️',
    color: '#818cf8',
    gradient: 'linear-gradient(135deg, #3730a3 0%, #a5b4fc 100%)',
    flagColors: ['#000000', '#dc2626', '#eab308'],
    get shortDesc() { return tr("Saarbrücken • 10 вопросов"); }
  },
  {
    code: 'SN',
    nameDe: 'Sachsen',
    get nameRu() { return tr("Саксония"); },
    capital: 'Dresden',
    symbol: '👑',
    color: '#22c55e',
    gradient: 'linear-gradient(135deg, #14532d 0%, #4ade80 100%)',
    flagColors: ['#ffffff', '#16a34a'],
    get shortDesc() { return tr("Dresden • 10 вопросов"); }
  },
  {
    code: 'ST',
    nameDe: 'Sachsen-Anhalt',
    get nameRu() { return tr("Саксония-Анхальт"); },
    capital: 'Magdeburg',
    symbol: '🏰',
    color: '#facc15',
    gradient: 'linear-gradient(135deg, #854d0e 0%, #fef08a 100%)',
    flagColors: ['#eab308', '#000000'],
    get shortDesc() { return tr("Magdeburg • 10 вопросов"); }
  },
  {
    code: 'SH',
    nameDe: 'Schleswig-Holstein',
    get nameRu() { return tr("Шлезвиг-Гольштейн"); },
    capital: 'Kiel',
    symbol: '🌊',
    color: '#06b6d4',
    gradient: 'linear-gradient(135deg, #0e7490 0%, #a5f3fc 100%)',
    flagColors: ['#0284c7', '#ffffff', '#dc2626'],
    get shortDesc() { return tr("Kiel • 10 вопросов"); }
  },
  {
    code: 'TH',
    nameDe: 'Thüringen',
    get nameRu() { return tr("Тюрингия"); },
    capital: 'Erfurt',
    symbol: '⭐',
    color: '#f97316',
    gradient: 'linear-gradient(135deg, #9a3412 0%, #fdba74 100%)',
    flagColors: ['#ffffff', '#dc2626'],
    get shortDesc() { return tr("Erfurt • 10 вопросов"); }
  }
];

export const getBundeslandByCode = (code) => {
  if (!code) return null;
  return BUNDESLAENDER.find(b => b.code.toUpperCase() === code.toUpperCase()) || null;
};
