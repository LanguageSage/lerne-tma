import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, BookOpen, Layers, Brain, List, Sparkles, Settings } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { HELP_SECTIONS } from '../../constants/helpContent';
import './FullGuideModal.css';

const ICON_MAP = {
  Layers: Layers,
  Brain: Brain,
  List: List,
  Sparkles: Sparkles,
  Settings: Settings
};

export const FullGuideModal = () => {
  const { isFullGuideOpen, fullGuideTopic, closeFullGuide } = useUiStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState(null);

  const effectiveTopic = useMemo(() => {
    if (selectedTopic) return selectedTopic;
    if (fullGuideTopic) {
      return fullGuideTopic === 'editor' ? 'creator' : (fullGuideTopic === 'study_back' ? 'study' : fullGuideTopic);
    }
    return 'decks';
  }, [selectedTopic, fullGuideTopic]);

  const [highlightedId, setHighlightedId] = useState(null);
  const contentAreaRef = useRef(null);

  // Scroll to topic section when opened
  useEffect(() => {
    if (isFullGuideOpen && effectiveTopic) {
      const scrollTimer = setTimeout(() => {
        const targetElement = document.getElementById(`guide-sec-${effectiveTopic}`);
        if (targetElement && contentAreaRef.current) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setHighlightedId(effectiveTopic);
      }, 150);

      const clearHighlightTimer = setTimeout(() => {
        setHighlightedId(null);
      }, 2500);

      return () => {
        clearTimeout(scrollTimer);
        clearTimeout(clearHighlightTimer);
      };
    }
  }, [isFullGuideOpen, effectiveTopic]);

  const scrollToSection = (sectionId) => {
    setSelectedTopic(sectionId);
    setHighlightedId(sectionId);
    const targetElement = document.getElementById(`guide-sec-${sectionId}`);
    if (targetElement && contentAreaRef.current) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setTimeout(() => {
      setHighlightedId(null);
    }, 2000);
  };

  // Filter sections by search query
  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return HELP_SECTIONS;

    return HELP_SECTIONS.filter(section => {
      const inTitle = section.title.toLowerCase().includes(q);
      const inDesc = section.shortDescription.toLowerCase().includes(q);
      const inQuick = section.quickTips.some(tip => 
        tip.title.toLowerCase().includes(q) || tip.text.toLowerCase().includes(q)
      );
      const inFull = section.fullArticle.some(art => 
        art.subheading.toLowerCase().includes(q) || art.text.toLowerCase().includes(q)
      );
      return inTitle || inDesc || inQuick || inFull;
    });
  }, [searchQuery]);

  if (!isFullGuideOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        className="full-guide-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeFullGuide}
      >
        <motion.div 
          className="full-guide-modal"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="full-guide-header">
            <div className="full-guide-header-title">
              <BookOpen size={24} color="#c084fc" />
              <h2>Справочник Lerne</h2>
            </div>
            <button 
              className="full-guide-close-btn" 
              onClick={closeFullGuide}
              aria-label="Закрыть справочник"
            >
              <X size={20} />
            </button>
          </div>

          {/* Search & Navigation Bar */}
          <div className="full-guide-toolbar">
            <div className="full-guide-search-box">
              <Search size={16} className="full-guide-search-icon" />
              <input 
                type="text"
                className="full-guide-search-input"
                placeholder="Поиск по справке и разделам..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button 
                  className="full-guide-search-clear" 
                  onClick={() => setSearchQuery('')}
                  aria-label="Очистить поиск"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="full-guide-nav-chips">
              {HELP_SECTIONS.map((sec) => {
                const ChipIcon = ICON_MAP[sec.icon] || BookOpen;
                return (
                  <button
                    key={sec.id}
                    className={`full-guide-chip ${effectiveTopic === sec.id && !searchQuery ? 'active' : ''}`}
                    onClick={() => scrollToSection(sec.id)}
                  >
                    <ChipIcon size={14} />
                    <span>{sec.title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content Area */}
          <div className="full-guide-content-area" ref={contentAreaRef}>
            {filteredSections.length === 0 ? (
              <div className="full-guide-no-results">
                <Search size={36} color="#6b7280" />
                <p>По запросу «{searchQuery}» ничего не найдено.</p>
              </div>
            ) : (
              filteredSections.map((sec) => {
                const SecIcon = ICON_MAP[sec.icon] || BookOpen;
                const isHighlight = highlightedId === sec.id;

                return (
                  <article 
                    key={sec.id} 
                    id={`guide-sec-${sec.id}`}
                    className={`full-guide-section ${isHighlight ? 'highlighted' : ''}`}
                  >
                    <div className="full-guide-section-header">
                      <div className="full-guide-section-icon">
                        <SecIcon size={20} />
                      </div>
                      <h3 className="full-guide-section-title">{sec.title}</h3>
                    </div>

                    {sec.fullArticle.map((art, idx) => (
                      <div key={idx} className="full-guide-article-block">
                        <h4 className="full-guide-article-subheading">{art.subheading}</h4>
                        <p className="full-guide-article-text">{art.text}</p>
                      </div>
                    ))}
                  </article>
                );
              })
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
