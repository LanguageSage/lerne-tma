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
const PLAIN_TEXT_MARKDOWN_RE = /[*_`~#[\]!|>\\+-]|\n|^\s*\d+\./;

/** Presentation only: pass the original back/context, never front exercise syntax. */
export function MarkdownRenderer({ children, className = '', style }) {
  if (typeof children === 'string' && !PLAIN_TEXT_MARKDOWN_RE.test(children) && !children.includes('http') && !children.includes('&')) {
    return (
      <div className={`card-markdown ${className}`} style={style}>
        {children ? <p>{children}</p> : null}
      </div>
    );
  }
  return (
    <div className={`card-markdown ${className}`} style={style}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components} skipHtml>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
