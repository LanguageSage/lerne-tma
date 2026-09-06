import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, SlidersHorizontal, CheckCircle2 } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SrsStatsDashboard } from '../study/SrsStatsModal';

export const SrsTab = () => {
  useInterfaceLocale();
  const { 
    srsExtendedGrades, 
    setSrsExtendedGrades, 
    autoplayOrder, 
    setAutoplayOrder 
  } = useSettingsStore();

  return (
    <motion.div
      key="srs"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="settings-section srs-tab-section"
      style={{ paddingBottom: '30px' }}
    >
      <div className="srs-tab-header" style={{ marginBottom: '16px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 6px 0' }}>
          <Sparkles size={20} color="#a855f7" />{tr("Интервальные повторения (SRS)")}{' '}</h3>
        <p className="tab-description" style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8' }}>{tr("Управление алгоритмом интервалов SM-2 и статистика долгосрочной памяти.")}{' '}</p>
      </div>

      {/* Настройки режима изучения */}
      <div className="link-telegram-section glass" style={{ marginBottom: '20px', padding: '16px', borderRadius: '16px' }}>
        <h4 style={{ margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem' }}>
          <SlidersHorizontal size={16} color="#38bdf8" />{tr("Параметры изучения")}{' '}</h4>

        {/* Тумблер 8 кнопок */}
        <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ paddingRight: '12px' }}>
            <span style={{ fontWeight: 600, display: 'block', fontSize: '0.9rem', color: '#f8fafc' }}>{tr("8 кнопок оценки (Расширенный выбор)")}{' '}</span>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginTop: '3px', lineHeight: 1.35 }}>{tr("Компактные кнопки 1–8 с динамически рассчитанными интервалами вместо 4 стандартных кнопок.")}{' '}</span>
          </div>
          <label className="switch" style={{ flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={srsExtendedGrades}
              onChange={(e) => setSrsExtendedGrades(e.target.checked)}
            />
            <span className="slider"></span>
          </label>
        </div>

        {/* Наглядное превью шкалы */}
        {srsExtendedGrades && (
          <div style={{ marginTop: '12px', background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(168, 85, 247, 0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={13} />{' '}{tr("Пример шкалы при изучении:")}{' '}</span>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{tr("динамический расчет")}</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
              {[
                { n: '1', v: tr("5м"), bg: '#dc2626' },
                { n: '2', v: tr("1д"), bg: '#ea580c' },
                { n: '3', v: tr("2д"), bg: '#d97706' },
                { n: '4', v: tr("4д"), bg: '#65a30d' },
                { n: '5', v: tr("8д"), bg: '#059669' },
                { n: '6', v: tr("11д"), bg: '#0891b2' },
                { n: '7', v: tr("13д"), bg: '#2563eb' },
                { n: '8', v: tr("20д"), bg: '#7c3aed' },
              ].map((b) => (
                <div
                  key={b.n}
                  style={{
                    flex: 1,
                    maxWidth: '42px',
                    height: '38px',
                    background: b.bg,
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 700,
                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                    fontSize: '0.75rem'
                  }}
                >
                  <span style={{ fontSize: '0.8rem', lineHeight: 1 }}>{b.n}</span>
                  <span style={{ fontSize: '0.62rem', opacity: 0.9 }}>{b.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Переключатель порядка */}
        <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 2px 0' }}>
          <div style={{ paddingRight: '12px' }}>
            <span style={{ fontWeight: 600, display: 'block', fontSize: '0.9rem', color: '#f8fafc' }}>{tr("Приоритет карточек в колоде")}{' '}</span>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginTop: '3px', lineHeight: 1.35 }}>{tr("Сначала созревшие по расписанию SRS или строго по порядку колоды.")}{' '}</span>
          </div>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setAutoplayOrder('srs')}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                border: '1px solid',
                borderColor: autoplayOrder === 'srs' ? '#a855f7' : 'rgba(255,255,255,0.15)',
                background: autoplayOrder === 'srs' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255,255,255,0.05)',
                color: autoplayOrder === 'srs' ? '#e9d5ff' : '#94a3b8',
                cursor: 'pointer'
              }}
            >{tr("По SRS")}{' '}</button>
            <button
              type="button"
              onClick={() => setAutoplayOrder('list')}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                border: '1px solid',
                borderColor: autoplayOrder === 'list' ? '#a855f7' : 'rgba(255,255,255,0.15)',
                background: autoplayOrder === 'list' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255,255,255,0.05)',
                color: autoplayOrder === 'list' ? '#e9d5ff' : '#94a3b8',
                cursor: 'pointer'
              }}
            >{tr("По списку")}{' '}</button>
          </div>
        </div>
      </div>

      {/* Встроенная аналитика памяти */}
      <SrsStatsDashboard />
    </motion.div>
  );
};
