import React, { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { tr } from '../../i18n/locale';
import './StudyControlsBlock.css';

export const StudyControlsBlock = ({ collapsed, onCollapsedChange, label, children, className = '', style }) => {
  const reduceMotion = useReducedMotion();
  const blockRef = useRef(null);
  const expandRef = useRef(null);
  const collapseRef = useRef(null);
  const toggle = () => {
    onCollapsedChange(!collapsed);
    requestAnimationFrame(() => (collapsed ? collapseRef : expandRef).current?.focus({ preventScroll: true }));
  };

  return (
    <motion.div
      ref={blockRef}
      className={`study-controls-block ${collapsed ? 'is-collapsed' : ''} ${className}`}
      style={style}
      initial={false}
      animate={{ height: collapsed ? 44 : 'auto', width: collapsed ? 44 : '100%' }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeInOut' }}
      onAnimationStart={() => {
        if (blockRef.current) blockRef.current.style.overflow = 'hidden';
      }}
      onAnimationComplete={() => {
        if (blockRef.current) blockRef.current.style.overflow = collapsed ? 'hidden' : 'visible';
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={expandRef}
        type="button"
        className="study-controls-restore"
        onClick={toggle}
        aria-expanded={false}
        aria-label={tr('Развернуть {{p0}}', { p0: label })}
        title={label}
        tabIndex={collapsed ? 0 : -1}
        aria-hidden={!collapsed}
        disabled={!collapsed}
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <motion.div
        className="study-controls-expanded"
        inert={collapsed}
        aria-hidden={collapsed}
        animate={{ opacity: collapsed ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.12 }}
      >
          <div className="study-controls-content">{children}</div>
          <button
            ref={collapseRef}
            type="button"
            className="study-controls-collapse"
            onClick={toggle}
            aria-expanded={true}
            aria-label={tr('Свернуть {{p0}}', { p0: label })}
            title={tr('Свернуть {{p0}}', { p0: label })}
          >
            <ChevronDown size={18} aria-hidden="true" />
          </button>
      </motion.div>
    </motion.div>
  );
};
