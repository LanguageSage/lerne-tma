import React from 'react';
import { Target, BookOpen, Lightbulb, HelpCircle } from 'lucide-react';

export const LidCardBreakdown = ({ context, ruContext = null, className = '' }) => {
  if (!context && !ruContext) return null;

  // Helper to render markdown bold **text**
  const renderFormattedText = (text) => {
    if (!text) return null;
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={idx}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  // Parse structured sections: 🎯 **Объяснение**, 📖 **Словарный запас**, 💡 **Грамматика**
  const parseSections = (rawText) => {
    if (!rawText) return [];
    const lines = rawText.split('\n');
    const sections = [];
    let current = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/^(🎯|📖|💡|✨|❓)\s*\*\*([^*]+)\*\*:\s*(.*)$/);
      if (match) {
        if (current) {
          sections.push(current);
        }
        const emoji = match[1];
        const title = match[2].trim();
        const firstLine = match[3].trim();
        current = {
          emoji,
          title,
          content: firstLine ? [firstLine] : []
        };
      } else if (current) {
        if (line) {
          current.content.push(line);
        }
      } else if (line) {
        // Uncategorized initial text
        if (!sections.length && !current) {
          current = {
            emoji: '🎯',
            title: 'Объяснение',
            content: [line]
          };
        }
      }
    }

    if (current) {
      sections.push(current);
    }

    return sections;
  };

  const sections = parseSections(context);

  const getSectionTheme = (emoji, title) => {
    const t = (title || '').toLowerCase();
    if (emoji === '🎯' || t.includes('объяснен')) {
      return {
        cardClass: 'lid-breakdown-card explanation',
        badgeClass: 'lid-breakdown-badge explanation',
        icon: <Target size={15} color="#38bdf8" />,
        color: '#38bdf8'
      };
    }
    if (emoji === '📖' || t.includes('словарь') || t.includes('словарный')) {
      return {
        cardClass: 'lid-breakdown-card vocabulary',
        badgeClass: 'lid-breakdown-badge vocabulary',
        icon: <BookOpen size={15} color="#c084fc" />,
        color: '#c084fc'
      };
    }
    if (emoji === '💡' || t.includes('грамматик') || t.includes('правил')) {
      return {
        cardClass: 'lid-breakdown-card grammar',
        badgeClass: 'lid-breakdown-badge grammar',
        icon: <Lightbulb size={15} color="#fbbf24" />,
        color: '#fbbf24'
      };
    }
    return {
      cardClass: 'lid-breakdown-card general',
      badgeClass: 'lid-breakdown-badge general',
      icon: <HelpCircle size={15} color="#94a3b8" />,
      color: '#94a3b8'
    };
  };

  return (
    <div className={`lid-card-breakdown-container ${className}`}>
      <div className="lid-breakdown-header">
        <span className="lid-breakdown-header-icon">🎓</span>
        <span className="lid-breakdown-header-title">Подробный разбор карточки</span>
      </div>

      {sections.length > 0 ? (
        <div className="lid-breakdown-sections-list">
          {sections.map((sec, idx) => {
            const theme = getSectionTheme(sec.emoji, sec.title);
            const isVocab = sec.title.toLowerCase().includes('словарь') || sec.title.toLowerCase().includes('словарный');

            return (
              <div key={idx} className={theme.cardClass}>
                <div className={theme.badgeClass}>
                  {theme.icon}
                  <span>{sec.title}</span>
                </div>

                <div className="lid-breakdown-body">
                  {isVocab ? (
                    <div className="lid-vocab-list">
                      {sec.content.map((item, itemIdx) => {
                        const cleanItem = item.replace(/^[-*•]\s*/, '').trim();
                        if (!cleanItem) return null;
                        const dashParts = cleanItem.split(/\s+—\s+|\s+-\s+/);
                        if (dashParts.length >= 2) {
                          const german = dashParts[0].trim();
                          const russian = dashParts.slice(1).join(' — ').trim();
                          return (
                            <div key={itemIdx} className="lid-vocab-item">
                              <span className="lid-vocab-de">{renderFormattedText(german)}</span>
                              <span className="lid-vocab-sep">—</span>
                              <span className="lid-vocab-ru">{renderFormattedText(russian)}</span>
                            </div>
                          );
                        }
                        return (
                          <div key={itemIdx} className="lid-vocab-item-plain">
                            {renderFormattedText(cleanItem)}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    sec.content.map((p, pIdx) => (
                      <p key={pIdx} className="lid-breakdown-paragraph">
                        {renderFormattedText(p)}
                      </p>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Fallback if sections were not segmented */
        <div className="lid-breakdown-card general">
          <div className="lid-breakdown-badge general">
            <HelpCircle size={15} color="#38bdf8" />
            <span>Разбор и контекст</span>
          </div>
          <div className="lid-breakdown-body">
            <p className="lid-breakdown-paragraph" style={{ whiteSpace: 'pre-line' }}>
              {renderFormattedText(context || ruContext)}
            </p>
          </div>
        </div>
      )}

      {/* If there was a separate BAMF context that differs from main context */}
      {ruContext && !context?.includes(ruContext) && ruContext !== 'Wichtige Frage für das Leben in Deutschland' && (
        <div className="lid-breakdown-card bamf-note">
          <div className="lid-breakdown-badge general">
            <HelpCircle size={14} color="#94a3b8" />
            <span>Справка BAMF</span>
          </div>
          <p className="lid-breakdown-paragraph" style={{ fontSize: '0.85rem', opacity: 0.9 }}>
            {ruContext}
          </p>
        </div>
      )}
    </div>
  );
};
