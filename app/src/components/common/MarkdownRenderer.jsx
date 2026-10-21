import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tr } from '../../i18n/locale';
import './MarkdownRenderer.css';

function MarkdownTable({ children }) {
  return (
    <div className="markdown-table-scroll" role="region" aria-label={tr('Таблица')}
      tabIndex={0} onClick={event => event.stopPropagation()}>
      <table>{children}</table>
    </div>
  );
}

const components = { table: MarkdownTable };
const remarkPlugins = [remarkGfm];

/** Presentation only: pass the original back/context, never front exercise syntax. */
export function MarkdownRenderer({ children, className = '', style }) {
  return (
    <div className={`card-markdown ${className}`} style={style}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components} skipHtml>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
