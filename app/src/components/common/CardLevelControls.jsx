import { useEffect, useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useUiStore } from '../../store/useUiStore';
import { buildCefrMetaFromClassifierResult, buildManualCefrMeta } from '../../utils/levelUtils';
import { classifySentenceFast } from '../../services/classifier';
import { triggerHaptic } from '../../utils/platform';
import { CardLevelBadge } from './CardLevelBadge';

export function CardLevelControls({ cardData, frontText, update }) {
  const content = cardData.content_v2.card;
  const manualLevel = content.metadata?.cefr?.source === 'manual';
  const showToast = useUiStore(state => state.showToast);
  const [isClassifyingLevel, setIsClassifyingLevel] = useState(false);
  const [isLevelPickerOpen, setIsLevelPickerOpen] = useState(false);
  const timerRef = useRef(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isLevelPickerOpen) return;
    const handleOutsideClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsLevelPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, [isLevelPickerOpen]);

  const handleReclassifyLevel = () => {
    if (isClassifyingLevel) return;
    setIsClassifyingLevel(true);
    setIsLevelPickerOpen(false);
    triggerHaptic('medium');

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const front = frontText.trim();
      const res = classifySentenceFast(front, 'de');
      const newLevel = res.level || 'A1';

      update(card => ({ ...card, level: newLevel, metadata: { ...card.metadata,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level: newLevel }, 'local') } }));

      setIsClassifyingLevel(false);
      triggerHaptic('success');
      showToast(tr("Уровень определен: {{p0}} ({{p1}})", { p0: newLevel, p1: res.reason_short || res.reason }), 'success');
    }, 1000);
  };

  const handleSelectManualLevel = (selectedLevel) => {
    setIsLevelPickerOpen(false);
    triggerHaptic('selection');

    if (selectedLevel === 'auto') {
      handleReclassifyLevel();
      return;
    }

    update(card => ({ ...card, level: selectedLevel, metadata: { ...card.metadata,
      cefr: buildManualCefrMeta(selectedLevel) } }));

    showToast(tr("Уровень установлен: {{p0}} (вручную)", { p0: selectedLevel }), 'info');
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px 6px 8px',
        position: 'relative',
        zIndex: 15,
        pointerEvents: 'auto',
        gap: '6px',
        marginTop: 'auto'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative', flexWrap: 'wrap' }}>
        <div
          style={{
            opacity: isClassifyingLevel ? 0 : 1,
            transform: isClassifyingLevel ? 'scale(0.8)' : 'scale(1)',
            transition: 'opacity 0.25s ease, transform 0.25s ease',
            pointerEvents: isClassifyingLevel ? 'none' : 'auto'
          }}
          title={tr("Нажмите для автоматического пересчета уровня")}
        >
          <CardLevelBadge
            card={cardData}
            size="sm"
            onClick={handleReclassifyLevel}
          />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsLevelPickerOpen(!isLevelPickerOpen);
          }}
          title={tr("Ручная смена уровня CEFR")}
          style={{
            background: 'rgba(255, 255, 255, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            borderRadius: '8px',
            color: 'rgba(255, 255, 255, 0.85)',
            padding: '2px 7px',
            fontSize: '0.68rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            lineHeight: 1.2
          }}
        >
          <SlidersHorizontal size={11} />
          <span>{tr("Правка")}</span>
        </button>

        {isLevelPickerOpen && (
          <div
            ref={pickerRef}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 6px)',
              left: '0',
              background: 'rgba(24, 24, 27, 0.96)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              borderRadius: '12px',
              padding: '6px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              zIndex: 50,
              minWidth: '185px',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '0.68rem', color: 'rgba(255, 255, 255, 0.55)', padding: '2px 6px', fontWeight: 600 }}>{tr("Уровень сложности:")}{' '}</div>

            <button
              type="button"
              onClick={() => handleSelectManualLevel('auto')}
              style={{
                background: !manualLevel ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                border: !manualLevel ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid transparent',
                color: !manualLevel ? '#a5b4fc' : 'rgba(255, 255, 255, 0.85)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.74rem',
                fontWeight: 600,
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{tr("⚡ Авто (распознать)")}</span>
              {!manualLevel && <Check size={12} color="#a5b4fc" />}
            </button>

            <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '2px 0' }} />

            {[
              { lvl: 'A1', label: tr("🟢 A1 (Начальный)") },
              { lvl: 'A2', label: tr("🔵 A2 (Базовый)") },
              { lvl: 'B1', label: tr("🔹 B1 (Средний)") },
              { lvl: 'B2', label: tr("🟣 B2 (Выше среднего)") },
              { lvl: 'C1', label: tr("🔮 C1 (Продвинутый)") },
              { lvl: 'C2', label: tr("🟠 C2 (В совершенстве)") }
            ].map(({ lvl, label }) => {
              const isSelected = manualLevel && content.level === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => handleSelectManualLevel(lvl)}
                  style={{
                    background: isSelected ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                    border: isSelected ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid transparent',
                    color: isSelected ? '#fff' : 'rgba(255, 255, 255, 0.8)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    fontWeight: isSelected ? 700 : 500,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                >
                  <span>{label}</span>
                  {isSelected && <Check size={12} color="#4ade80" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
