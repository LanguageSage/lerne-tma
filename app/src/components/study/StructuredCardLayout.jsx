import React from 'react';
import { studyContent, studyInfoBlocks, studyLayout } from '../../utils/structuredStudyCard';
import { mediaURL } from '../../services/apiConfig';
import { ExerciseInfoBlocks } from './ExerciseInfoBlocks';
import { StudyCardImage } from './StudyCardImage';
import './StructuredCardLayout.css';

/** Compose the existing exercise; this component owns no learning state. */
export function StructuredCardLayout({ card, exercise, afterAnswer = false }) {
  const content = studyContent(card);
  const blocks = studyInfoBlocks(content);
  return <div className="structured-card-layout">
    {studyLayout(content, { afterAnswer }).map(item => <React.Fragment key={item.id}>
      {item.type === 'exercise' ? <div data-layout-id={item.id}>{exercise}</div>
        : item.type === 'info' ? <div data-layout-id={item.id}>
          <ExerciseInfoBlocks blocks={[blocks[item.index]].filter(Boolean)} markdown />
        </div>
          : item.type === 'image' ? <figure data-layout-id={item.id}>
            <StudyCardImage src={card.layout_media_urls?.[item.id] || mediaURL(item.path, 'images')}
              alt={item.alt} height={220} cardId={`${card.id}:${item.id}`} showResizeHandle={false} />
            {item.caption && <figcaption>{item.caption}</figcaption>}
          </figure> : null}
    </React.Fragment>)}
  </div>;
}
