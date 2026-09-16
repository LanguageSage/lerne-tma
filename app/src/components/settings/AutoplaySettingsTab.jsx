import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useSettingsStore } from '../../store/useSettingsStore';
import { buildAutoplaySequence } from '../../utils/autoplaySequence';
import { VOICES_BY_LANG, getTtsVoiceForLang } from '../../constants/languageConstants';
import './AutoplaySettingsTab.css';

const PRESETS = [
  { id: 'normal', label: 'Обычный', phrases: 1, cycles: 1 },
  { id: 'reinforce', label: 'Закрепление', phrases: 3, cycles: 2 },
  { id: 'intensive', label: 'Интенсивный', phrases: 5, cycles: 3 },
];

export const AutoplaySettingsTab = () => {
  useInterfaceLocale();
  const settings = useSettingsStore();
  const update = settings.setAutoplaySettings;
  const setTtsVoice = settings.setTtsVoice;
  const setTtsSpeed = settings.setTtsSpeed;
  const setTtsSpeedRu = settings.setTtsSpeedRu;

  const currentGermanVoice = getTtsVoiceForLang('de', settings.adminSettings, settings.ttsVoices);
  const cycle = buildAutoplaySequence({ ...settings, autoplayCycleRepeat: 1 });
  const preset = PRESETS.find(p => p.phrases === settings.autoplayFrontRepeat && p.cycles === settings.autoplayCycleRepeat);
  const numberField = (key, label, min, max, unit = '') => (
    <label className="auto-setting">
      <span>{label}</span>
      <select value={settings[key]} onChange={e => update({ [key]: Number(e.target.value) })}>
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(n =>
          <option key={n} value={n}>{n}{unit}</option>)}
      </select>
    </label>
  );
  return (
    <div className="auto-settings">
      <h3>{tr("Авто-режим")}</h3>
      <fieldset>
        <legend>{tr("Порядок карточек")}</legend>
        <label className="auto-setting">
          <span>{tr("Порядок")}</span>
          <select value={settings.autoplayOrder} onChange={e => update({ autoplayOrder: e.target.value })}>
            <option value="list">{tr("По списку")}</option>
            <option value="srs">{tr("По SRS")}</option>
            <option value="random">{tr("Рандом")}</option>
          </select>
        </label>
        {settings.autoplayOrder === 'srs' && <p>{tr("Карточки к повторению и новые карточки.")}</p>}
        {settings.autoplayOrder === 'random' && <p>{tr("Все карточки в случайном порядке, без повторов внутри круга.")}</p>}
      </fieldset>
      <fieldset>
        <legend>{tr("Последовательность и количество")}</legend>
        <div className="auto-presets">
          {PRESETS.map(p => <button key={p.id} type="button" aria-pressed={preset?.id === p.id}
            onClick={() => update({ autoplayFrontRepeat: p.phrases, autoplayCycleRepeat: p.cycles })}>
            {tr(p.label)}
          </button>)}
        </div>
        {!preset && <p>{tr("Своя настройка")}</p>}
        {numberField('autoplayFrontRepeat', tr("Количество фраз в цикле"), 1, 10)}
        <div className="auto-sequence" aria-live="polite">
          <strong>{tr("Один цикл")}</strong>
          <div className="auto-sequence-steps">
            {cycle.map((side, i) => <span key={i}>
              {i > 0 && <span aria-hidden="true"> → </span>}
              {side === 'front' ? tr("Фраза") : tr("Перевод")}
            </span>)}
          </div>
          <p>{tr("На карточку: фраза — {{phrases}}, перевод — {{translations}}.", {
            phrases: settings.autoplayFrontRepeat * settings.autoplayCycleRepeat,
            translations: settings.autoplayCycleRepeat,
          })}</p>
        </div>
      </fieldset>
      <fieldset>
        <legend>{tr("Повторы и паузы")}</legend>
        {numberField('autoplayCycleRepeat', tr("Циклов на карточку"), 1, 10)}
        {numberField('autoplayGap', tr("Между озвучиваниями"), 0, 30, tr("с"))}
        {numberField('autoplayCardPause', tr("Перед следующей карточкой"), 0, 30, tr("с"))}
      </fieldset>
      <fieldset>
        <legend>{tr("Озвучка")}</legend>
        <label className="auto-setting">
          <span>{tr("Голос озвучки (немецкий)")}</span>
          <select
            value={currentGermanVoice}
            onChange={e => {
              const voiceVal = e.target.value;
              setTtsVoice('de', voiceVal);
            }}
          >
            {(VOICES_BY_LANG.de || []).map(v => (
              <option key={v.value} value={v.value}>
                {v.label} ({v.gender === 'f' ? tr("Женский") : tr("Мужской")})
              </option>
            ))}
          </select>
        </label>

        {[
          ['autoplayPhraseSpeed', tr("Скорость фразы"), 'de'],
          ['autoplayTranslationSpeed', tr("Скорость перевода"), 'ru'],
        ].map(([key, label, langCode]) => <label key={key} className="auto-speed">
          <span>{label} <output>{settings[key] > 0 ? '+' : ''}{settings[key]}%</output></span>
          <input type="range" min="-50" max="50" step="5" value={settings[key]}
            onChange={e => {
              const val = Number(e.target.value);
              update({ [key]: val });
              if (langCode === 'de' && setTtsSpeed) setTtsSpeed(`${val >= 0 ? '+' : ''}${val}%`);
              if (langCode === 'ru' && setTtsSpeedRu) setTtsSpeedRu(`${val >= 0 ? '+' : ''}${val}%`);
            }} />
        </label>)}
        {[
          ['autoplayForceFrontAudio', tr("Генерировать фразу заново")],
          ['autoplayForceBackAudio', tr("Генерировать перевод заново")],
        ].map(([key, label]) => <label className="auto-checkbox" key={key}>
          <input type="checkbox" checked={settings[key]} onChange={e => update({ [key]: e.target.checked })} />
          <span>{label}</span>
        </label>)}
        <p>{tr("Новая озвучка сохраняется для карточки. Повторы используют её до следующего запуска.")}</p>
      </fieldset>
      <fieldset>
        <legend>{tr("Завершение")}</legend>
        <label className="auto-checkbox">
          <input type="checkbox" checked={settings.autoplayLoop}
            onChange={e => update({ autoplayLoop: e.target.checked })} />
          <span>{tr("Повторять колоду")}</span>
        </label>
        {!settings.autoplayLoop && <p>{tr("Остановиться после колоды")}</p>}
      </fieldset>
    </div>
  );
};
