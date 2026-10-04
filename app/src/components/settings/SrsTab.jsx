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
    setSrsExtendedGrades
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
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginTop: '3px', lineHeight: 1.35 }}>{tr("Компактные кнопки с динамически рассчитанными интервалами вместо 4 стандартных кнопок.")}{' '}</span>
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
                { v: tr("5м"), bg: '#dc2626' },
                { v: tr("8м"), bg: '#ea580c' },
                { v: tr("10м"), bg: '#d97706' },
                { v: tr("25м"), bg: '#65a30d' },
                { v: tr("1д"), bg: '#059669' },
                { v: tr("2д"), bg: '#0891b2' },
                { v: tr("3д"), bg: '#2563eb' },
                { v: tr("5д"), bg: '#7c3aed' },
              ].map((b, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    maxWidth: '42px',
                    height: '34px',
                    background: b.bg,
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 700,
                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                    fontSize: '0.75rem'
                  }}
                >
                  <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{b.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Встроенная аналитика памяти */}
      <SrsStatsDashboard />
    </motion.div>
  );
};
