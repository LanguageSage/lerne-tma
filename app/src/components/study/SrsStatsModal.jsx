import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, TrendingUp, Calendar, AlertTriangle, Award, Clock } from 'lucide-react';
import api from '../../services/api';
import './SrsStatsModal.css';

export const SrsStatsDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    api.get('/study/stats')
      .then((res) => {
        if (isMounted) {
          setStats(res.data);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Failed to load SRS stats:", err);
          setError("Не удалось загрузить аналитику");
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
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

  if (loading) {
    return (
      <div className="srs-loading-state">
        <div className="srs-spinner" />
        <p>Анализируем прогресс интервалов...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="srs-error-state">
        <AlertTriangle size={32} color="#ef4444" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
                {/* Top Metrics Row */}
                <div className="srs-metrics-grid">
                  <div className="srs-metric-card primary">
                    <div className="srs-metric-top">
                      <span className="srs-metric-label">Retention Rate</span>
                      <TrendingUp size={16} color="#4ade80" />
                    </div>
                    <div className="srs-metric-val">{retention == null ? '-' : `${retention}%`}</div>
                    <div className="srs-metric-sub">
                      {retention == null ? 'Нет данных' : retention >= 90 ? '🌟 Отличное удержание' : retention >= 80 ? '✅ Оптимальный темп' : '⚠️ Рекомендуется чаще повторять'}
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
                <div className="srs-section-card">
                  <div className="srs-section-header">
                    <h4>Зрелость памяти</h4>
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
                    <div className="srs-leech-notice">
                      <AlertTriangle size={15} color="#f87171" />
                      <span><strong>{leechCount}</strong> {leechCount === 1 ? 'сложная карточка (Leech)' : 'сложных карточек (Leech)'} — рекомендуем пересмотреть формулировки.</span>
                    </div>
                  )}
                </div>

                {/* 7-Day Forecast */}
                {forecast.length > 0 && (
                  <div className="srs-section-card">
                    <div className="srs-section-header">
                      <h4>
                        <Calendar size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
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
    </>
  );
};

export const SrsStatsModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="srs-modal-overlay" onClick={onClose}>
        <motion.div
          className="srs-modal-container glass"
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ duration: 0.25 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="srs-modal-header">
            <div className="srs-title-wrapper">
              <div className="srs-icon-badge">
                <Sparkles size={20} color="#a855f7" />
              </div>
              <div>
                <h3>Статистика памяти (SRS)</h3>
                <p>Эффективность интервального повторения</p>
              </div>
            </div>
            <button className="srs-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <div className="srs-modal-body">
            <SrsStatsDashboard />
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

