import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { FONT_OPTIONS } from '../designConstants';
import { GeneralDesignPreview } from '../GeneralDesignPreview';
import '../DesignEditor.css';

const SECTIONS = { background: 'Фон приложения', panels: 'Панели и стекло', buttons: 'Кнопки', typography: 'Типографика интерфейса', details: 'Акценты и детали' };
const PALETTES = [
  ['Синий', '#1a1a2e', '#16213e', '#0f3460'],
  ['Слива', '#241934', '#191a2d', '#101522'],
  ['Изумруд', '#153b32', '#122824', '#101923'],
  ['Графит', '#242833', '#171b24', '#0b1019'],
];
const STATES = { normal: 'Обычная', hover: 'При наведении', pressed: 'При нажатии', disabled: 'Недоступна' };

function editableColor(value, fallback = '#ffffff') {
  if (/^#[0-9a-f]{6}$/i.test(value || '')) return value;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value || '');
  return rgb ? `#${rgb.slice(1, 4).map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}` : fallback;
}
function legacyAlpha(value, fallback) {
  const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i.exec(value || '');
  return rgba ? Math.max(0, Math.min(1, Number(rgba[1]))) : fallback;
}

const SelectControl = ({ label, value, options, onChange }) => (
  <label className="design-editor-select">{tr(label)}
    <select aria-label={tr(label)} value={value} onChange={e => onChange(e.target.value)}>
      {Object.entries(options).map(([id, name]) => <option key={id} value={id}>{tr(name)}</option>)}
    </select>
  </label>
);

export const GeneralDesignSection = React.memo(({ config, onChangeField }) => {
  const [section, setSection] = useState('background');
  const [role, setRole] = useState('primary');
  const [state, setState] = useState('normal');
  const global = config.global;
  const background = global.background;
  const button = global.buttons[role];
  const buttonState = button[state];
  const surfaceColor = global.panels.color || editableColor(global.glassBg);
  const borderColor = global.panels.borderColor || editableColor(global.glassBorder);
  const surfaceOpacity = global.panels.color ? global.glassOpacity : legacyAlpha(global.glassBg, global.glassOpacity);
  const borderOpacity = global.panels.borderColor ? global.panels.borderOpacity : legacyAlpha(global.glassBorder, global.panels.borderOpacity);
  const color = (label, path, value) => <ColorControl label={tr(label)} value={value} onChange={v => onChangeField(`global.${path}`, v)} presetColors={[]} />;
  const slider = (label, path, value, min, max, step = 1, unit = '') => <SliderControl label={tr(label)} value={value} min={min} max={max} step={step} unit={unit} onChange={v => onChangeField(`global.${path}`, v)} />;

  return (
    <div className="general-design-section">
      <GeneralDesignPreview />
      <nav className="design-editor-nav" aria-label={tr('Общие настройки дизайна')}>
        {Object.entries(SECTIONS).map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{tr(label)}</button>)}
      </nav>
      <section className="design-editor-fields" aria-label={tr(SECTIONS[section])}>
        <h3>{tr(SECTIONS[section])}</h3>
        {section === 'background' && <>
          <SelectControl label="Режим фона" value={background.mode} options={{ ...(background.mode === 'legacy' ? { legacy: 'Сохранённый фон' } : {}), solid: 'Сплошной цвет', linear: 'Линейный градиент', radial: 'Радиальный градиент' }} onChange={v => onChangeField('global.background.mode', v)} />
          <div className="design-editor-palettes">
            {PALETTES.map(([name, color1, color2, color3]) => <button type="button" key={name} onClick={() => onChangeField('global.background', { ...background, mode: 'radial', color1, color2, color3, colorCount: 3 })}>
              <span aria-hidden="true" style={{ background: `linear-gradient(90deg, ${color1}, ${color2}, ${color3})` }} />{tr(name)}
            </button>)}
          </div>
          {background.mode === 'legacy' ? <p className="design-editor-note">{tr('Сохранённый фон сохранится до выбора нового режима.')}</p> : <>
            {color('Оттенок 1', 'background.color1', background.color1)}
            {background.mode !== 'solid' && <>
              <SelectControl label="Количество оттенков" value={background.colorCount} options={{ 2: 'Два', 3: 'Три' }} onChange={v => onChangeField('global.background.colorCount', Number(v))} />
              {color('Оттенок 2', 'background.color2', background.color2)}
              {background.colorCount === 3 && color('Оттенок 3', 'background.color3', background.color3)}
            </>}
            {background.mode === 'linear' && slider('Направление градиента', 'background.angle', background.angle, 0, 360, 1, '°')}
          </>}
          {(background.mode === 'radial' || background.glow > 0) && <>
            {slider('Положение по горизонтали', 'background.positionX', background.positionX, 0, 100, 1, '%')}
            {slider('Положение по вертикали', 'background.positionY', background.positionY, 0, 100, 1, '%')}
          </>}
          {slider('Интенсивность фонового свечения', 'background.glow', background.glow, 0, 1, 0.05)}
        </>}
        {section === 'panels' && <>
          {color('Цвет поверхности', 'panels.color', surfaceColor)}
          <SliderControl label={tr('Непрозрачность поверхности')} value={surfaceOpacity} min={0} max={1} step={0.01} unit="" onChange={v => onChangeField('global', { ...global, glassOpacity: v, panels: { ...global.panels, color: surfaceColor } })} />
          <SliderControl label={tr('Размытие фона')} value={parseFloat(global.glassBlur)} min={0} max={40} step={1} unit="px" onChange={v => onChangeField('global.glassBlur', `${v}px`)} />
          {color('Цвет рамок', 'panels.borderColor', borderColor)}
          <SliderControl label={tr('Непрозрачность рамок')} value={borderOpacity} min={0} max={1} step={0.01} unit="" onChange={v => onChangeField('global.panels', { ...global.panels, borderColor: borderColor, borderOpacity: v })} />
          <SliderControl label={tr('Скругление панелей')} value={parseFloat(global.commonRadius)} min={0} max={40} step={1} unit="px" onChange={v => onChangeField('global.commonRadius', `${v}px`)} />
          {slider('Интенсивность тени', 'panels.shadow', global.panels.shadow, 0, 1, 0.05)}
          {slider('Внутренний световой блик', 'panels.innerLight', global.panels.innerLight, 0, 1, 0.05)}
        </>}
        {section === 'buttons' && <>
          <SelectControl label="Вид кнопки" value={role} options={{ primary: 'Основная', secondary: 'Второстепенная' }} onChange={setRole} />
          <SelectControl label="Состояние кнопки" value={state} options={STATES} onChange={setState} />
          <SelectControl label="Фон кнопки" value={buttonState.mode} options={{ solid: 'Сплошной цвет', linear: 'Линейный градиент' }} onChange={v => onChangeField(`global.buttons.${role}.${state}.mode`, v)} />
          {color('Фон: оттенок 1', `buttons.${role}.${state}.color1`, buttonState.color1)}
          {buttonState.mode === 'linear' && <>
            {color('Фон: оттенок 2', `buttons.${role}.${state}.color2`, buttonState.color2)}
            {slider('Направление градиента кнопки', `buttons.${role}.${state}.angle`, buttonState.angle, 0, 360, 1, '°')}
          </>}
          {color('Цвет текста кнопки', `buttons.${role}.${state}.textColor`, buttonState.textColor)}
          {color('Цвет иконок кнопки', `buttons.${role}.${state}.iconColor`, buttonState.iconColor)}
          {color('Цвет рамки кнопки', `buttons.${role}.${state}.borderColor`, buttonState.borderColor)}
          {slider('Толщина рамки кнопки', `buttons.${role}.borderWidth`, button.borderWidth, 0, 4, 0.5, 'px')}
          {slider('Скругление кнопки', `buttons.${role}.radius`, button.radius, 0, 40, 1, 'px')}
          {slider('Высота кнопки', `buttons.${role}.height`, button.height, 36, 72, 1, 'px')}
          {slider('Тень кнопки', `buttons.${role}.shadow`, button.shadow, 0, 1, 0.05)}
          <p className="design-editor-note">{tr('Настройки не меняют кнопки оценки SRS и цвета ошибок.')}</p>
        </>}
        {section === 'typography' && <>
          <SelectControl label="Шрифт интерфейса" value={global.uiFont} options={Object.fromEntries(FONT_OPTIONS.map(o => [o.value, o.label]))} onChange={v => onChangeField('global.uiFont', v)} />
          {color('Цвет заголовков', 'typography.headingColor', global.typography.headingColor)}
          {color('Цвет основного текста', 'typography.textColor', global.typography.textColor)}
          {color('Цвет второстепенного текста', 'typography.secondaryColor', global.typography.secondaryColor)}
          {slider('Размер заголовков', 'typography.headingSize', global.typography.headingSize, 1, 3, 0.05, 'rem')}
          {slider('Размер служебного текста', 'typography.serviceSize', global.typography.serviceSize, 0.65, 1.25, 0.05, 'rem')}
          {slider('Интервал заголовков', 'typography.headingLineHeight', global.typography.headingLineHeight, 1, 2, 0.05)}
          {slider('Межстрочный интервал', 'typography.lineHeight', global.typography.lineHeight, 1, 2, 0.05)}
          <p className="design-editor-note">{tr('Текст учебных карточек настраивается отдельно.')}</p>
        </>}
        {section === 'details' && <>
          {color('Основной акцент', 'accentColor', global.accentColor)}
          {color('Дополнительный акцент', 'details.secondaryAccent', global.details.secondaryAccent)}
          {color('Информационные метки', 'details.infoColor', global.details.infoColor)}
          {color('Нейтральные иконки', 'details.iconColor', global.details.iconColor)}
          {color('Разделители', 'details.dividerColor', global.details.dividerColor)}
          {slider('Выделение активных элементов', 'details.activeIntensity', global.details.activeIntensity, 0, 1, 0.05)}
        </>}
      </section>
    </div>
  );
});
GeneralDesignSection.displayName = 'GeneralDesignSection';
