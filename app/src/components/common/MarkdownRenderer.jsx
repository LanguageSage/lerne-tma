import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tr } from '../../i18n/locale';
import { IS_STANDALONE } from '../../utils/standaloneMode.js';
import { resolveOfflineMediaUrlSync } from '../../pilot/offlineMediaResolver.js';
import './MarkdownRenderer.css';

function MarkdownTable({ children }) {
  return (
    <div className="markdown-table-scroll" role="region" aria-label={tr('Таблица')}
      tabIndex={0} onClick={event => event.stopPropagation()}>
      <table>{children}</table>
    </div>
  );
}

function MarkdownImage({ src, alt, ...props }) {
  const [failedSrc, setFailedSrc] = React.useState(null);
  const resolvedSrc = IS_STANDALONE ? resolveOfflineMediaUrlSync(src, 'images') : src;
  const failed = Boolean(resolvedSrc && failedSrc === resolvedSrc);

  if (IS_STANDALONE && (!resolvedSrc || failed)) {
    return (
      <span role="img" aria-label={alt || tr('Изображение недоступно офлайн')} style={{ color: '#94a3b8', fontSize: '0.85em' }}>
        [{alt || tr('Изображение недоступно офлайн')}]
      </span>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      onError={() => setFailedSrc(resolvedSrc)}
      style={{ maxWidth: '100%', borderRadius: '10px', marginTop: '6px' }}
      {...props}
    />
  );
}

const components = { table: MarkdownTable, img: MarkdownImage };
const remarkPlugins = [remarkGfm];
const PLAIN_TEXT_MARKDOWN_RE = /[*_`~#[\]!|>\\+-]|\n|^\s*\d+\./;

/** Present authored Markdown from Theory, answers or context. */
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
