import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Sparkles, 
  TrendingUp, 
  Calendar, 
  AlertTriangle, 
  Award, 
  Clock, 
  RefreshCw, 
  SlidersHorizontal,
  Layers,
  CheckCircle2
} from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import api from '../../services/api';
import '../study/SrsStatsModal.css';

export const SrsTab = () => {
  const { 
    srsExtendedGrades, 
    setSrsExtendedGrades, 
    autoplayOrder, 
    setAutoplayOrder 
  } = useSettingsStore();

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchStats = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.get('/study/stats');
      setStats(res.data);
      setError(null);
    } catch (err) {
      console.error("Failed to load SRS stats in SrsTab:", err);
      setError("Не удалось загрузить актуальную аналитику");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const total = stats?.total_cards || 0;
  const newCount = stats?.new_cards || 0;
  const learningCount = stats?.learning_cards || 0;
  const youngCount = stats?.young_cards || 0;
  const matureCount = stats?.mature_cards || 0;
  const leechCount = stats?.leech_cards || 0;
  const retention = stats?.retention_rate;
  const forecast = stats?.forecast_7d || [];

  const newPct = total > 0 ? (newCount / total) * 100 : 0;
  const learnPct = total > 0 ? (learningCount / total) * 100 : 0;
  const youngPct = total > 0 ? (youngCount / total) * 100 : 0;
  const maturePct = total > 0 ? (matureCount / total) * 100 : 0;
  const maxForecastCount = Math.max(1, ...forecast.map(f => f.count));

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
          <Sparkles size={20} color="#a855f7" />
          Интервальные повторения (SRS)
        </h3>
        <p className="tab-description" style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8' }}>
          Управление алгоритмом интервалов SM-2 и статистика долгосрочной памяти.
        </p>
      </div>

      {/* SRS Configuration Controls */}
      <div className="link-telegram-section glass" style={{ marginBottom: '20px', padding: '16px', borderRadius: '16px' }}>
        <h4 style={{ margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem' }}>
          <SlidersHorizontal size={16} color="#38bdf8" />
          Настройки режима изучения
        </h4>

        {/* 8-Button Grade Scale Toggle */}
        <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ paddingRight: '12px' }}>
            <span style={{ fontWeight: 600, display: 'block', fontSize: '0.9rem', color: '#f8fafc' }}>
              8 кнопок оценки (Расширенный выбор)
            </span>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginTop: '3px', lineHeight: 1.35 }}>
              Компактные цифровые кнопки 1–8 с динамическими промежуточными интервалами вместо 4 стандартных кнопок.
            </span>
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

        {/* Visual Preview of 8 buttons when enabled */}
        {srsExtendedGrades && (
          <div style={{ marginTop: '12px', background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(168, 85, 247, 0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={13} /> Пример шкалы при изучении:
              </span>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>динамический расчет</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
              {[
                { n: '1', v: '5м', bg: '#dc2626' },
                { n: '2', v: '1д', bg: '#ea580c' },
                { n: '3', v: '2д', bg: '#d97706' },
                { n: '4', v: '4д', bg: '#65a30d' },
                { n: '5', v: '8д', bg: '#059669' },
                { n: '6', v: '11д', bg: '#0891b2' },
                { n: '7', v: '13д', bg: '#2563eb' },
                { n: '8', v: '20д', bg: '#7c3aed' },
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

        {/* Repetition Order Switcher */}
        <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 2px 0' }}>
          <div style={{ paddingRight: '12px' }}>
            <span style={{ fontWeight: 600, display: 'block', fontSize: '0.9rem', color: '#f8fafc' }}>
              Приоритет карточек в колоде
            </span>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginTop: '3px', lineHeight: 1.35 }}>
              Сначала созревшие по расписанию SRS или строго по порядку колоды.
            </span>
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
            >
              По SRS
            </button>
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
            >
              По списку
            </button>
          </div>
        </div>
      </div>

      {/* SRS Analytics Dashboard */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem' }}>
          <Layers size={16} color="#a855f7" />
          Статистика памяти
        </h4>
        <button
          type="button"
          onClick={() => fetchStats(true)}
          disabled={loading || refreshing}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '0.76rem',
            padding: '4px 8px',
            borderRadius: '6px'
          }}
          title="Обновить аналитику"
        >
          <RefreshCw size={13} className={refreshing ? 'srs-spin' : ''} />
          <span>{refreshing ? 'Обновление...' : 'Обновить'}</span>
        </button>
      </div>

      {loading ? (
        <div className="srs-loading-state" style={{ padding: '30px 0' }}>
          <div className="srs-spinner" />
          <p>Загрузка статистики памяти...</p>
        </div>
      ) : error ? (
        <div className="srs-error-state" style={{ padding: '20px', borderRadius: '12px' }}>
          <AlertTriangle size={24} color="#ef4444" />
          <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem' }}>{error}</p>
        </div>
      ) : (
        <div className="srs-dashboard-content">
          {/* Top Metrics Row */}
          <div className="srs-metrics-grid" style={{ marginBottom: '14px' }}>
            <div className="srs-metric-card primary">
              <div className="srs-metric-top">
                <span className="srs-metric-label">Retention Rate</span>
                <TrendingUp size={16} color="#4ade80" />
              </div>
              <div className="srs-metric-val">{retention == null ? '-' : `${retention}%`}</div>
              <div className="srs-metric-sub">
                {retention == null ? 'Нет данных' : retention >= 90 ? '🌟 Отличное удержание' : retention >= 80 ? '✅ Оптимальный темп' : '⚠️ Повторяйте чаще'}
              </div>
            </div>

            <div className="srs-metric-card">
              <div className="srs-metric-top">
                <span className="srs-metric-label">Всего карточек</span>
                <Award size={16} color="#60a5fa" />
              </div>
              <div className="srs-metric-val">{total}</div>
              <div className="srs-metric-sub">В вашей базе</div>
            </div>

            <div className="srs-metric-card">
              <div className="srs-metric-top">
                <span className="srs-metric-label">Повторений (30д)</span>
                <Clock size={16} color="#f59e0b" />
              </div>
              <div className="srs-metric-val">{stats?.total_reviews_30d || 0}</div>
              <div className="srs-metric-sub">Оценок дано</div>
            </div>
          </div>

          {/* Memory Maturity Breakdown */}
          <div className="srs-section-card" style={{ marginBottom: '14px' }}>
            <div className="srs-section-header">
              <h4 style={{ fontSize: '0.9rem' }}>Зрелость памяти</h4>
              <span className="srs-mature-badge">
                {total > 0 ? `${Math.round(((youngCount + matureCount) / total) * 100)}% изучено` : '0%'}
              </span>
            </div>

            {/* Stacked Progress Bar */}
            <div className="srs-stacked-bar">
              <div className="srs-bar-segment mature" style={{ width: `${maturePct}%` }} title={`Освоено: ${matureCount}`} />
              <div className="srs-bar-segment young" style={{ width: `${youngPct}%` }} title={`Закрепляются: ${youngCount}`} />
              <div className="srs-bar-segment learning" style={{ width: `${learnPct}%` }} title={`В процессе: ${learningCount}`} />
              <div className="srs-bar-segment new" style={{ width: `${newPct}%` }} title={`Новые: ${newCount}`} />
            </div>

            {/* Legend Grid */}
            <div className="srs-legend-grid">
              <div className="srs-legend-item">
                <span className="srs-dot mature" />
                <div className="srs-legend-info">
                  <span className="srs-legend-name">Освоены (≥ 21 дн)</span>
                  <span className="srs-legend-count">{matureCount}</span>
                </div>
              </div>
              <div className="srs-legend-item">
                <span className="srs-dot young" />
                <div className="srs-legend-info">
                  <span className="srs-legend-name">Закрепляются (&lt; 21 дн)</span>
                  <span className="srs-legend-count">{youngCount}</span>
                </div>
              </div>
              <div className="srs-legend-item">
                <span className="srs-dot learning" />
                <div className="srs-legend-info">
                  <span className="srs-legend-name">В процессе (Учеба)</span>
                  <span className="srs-legend-count">{learningCount}</span>
                </div>
              </div>
              <div className="srs-legend-item">
                <span className="srs-dot new" />
                <div className="srs-legend-info">
                  <span className="srs-legend-name">Новые (Не начаты)</span>
                  <span className="srs-legend-count">{newCount}</span>
                </div>
              </div>
            </div>

            {leechCount > 0 && (
              <div className="srs-leech-notice" style={{ marginTop: '12px' }}>
                <AlertTriangle size={15} color="#f87171" />
                <span><strong>{leechCount}</strong> {leechCount === 1 ? 'сложная карточка (Leech)' : 'сложных карточек (Leech)'} — рекомендуем пересмотреть формулировки.</span>
              </div>
            )}
          </div>

          {/* 7-Day Repetition Forecast */}
          {forecast.length > 0 && (
            <div className="srs-section-card">
              <div className="srs-section-header">
                <h4 style={{ fontSize: '0.9rem' }}>
                  <Calendar size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                  План повторений на 7 дней
                </h4>
              </div>

              <div className="srs-forecast-chart">
                {forecast.map((item, idx) => {
                  const heightPct = Math.max(12, Math.round((item.count / maxForecastCount) * 100));
                  const isToday = idx === 0;

                  return (
                    <div key={item.date || idx} className={`srs-forecast-col ${isToday ? 'today' : ''}`}>
                      <span className="srs-forecast-val">{item.count}</span>
                      <div className="srs-forecast-bar-track">
                        <div
                          className="srs-forecast-bar-fill"
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <span className="srs-forecast-day">
                        {isToday ? 'Сегодня' : item.day_name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};
