import React, { useState } from 'react';
import { Play, List } from 'lucide-react';
import { DndContext } from '@dnd-kit/core';
import { tr } from '../../../i18n/locale';
import { DesignPreviewScope } from './DesignPreviewScope';
import { DeckIntro } from '../../deck/DeckIntro';
import { LessonCompletion } from '../../study/LessonCompletion';
import { DeckCardItem } from '../../deckgrid/DeckCardItem';
import { FolderCardItem } from '../../deckgrid/FolderTreeNav';
import '../../DeckGrid.css';

const noop = () => {};
const stopAction = event => { event.preventDefault(); event.stopPropagation(); };
const ordinary = { id: 'design-preview-ordinary', name: 'Alltag: Wörter und Ausdrücke', role: 'viewer', card_count: 24, folder_id: 'design-preview-folder', stats: { total: 24, new: 12, learning: 8, due: 4 }, is_learning: true };
const course = { ...ordinary, id: 'design-preview-course', name: 'B1 · Ein Gespräch am Arbeitsplatz', is_trainer: true, metadata: JSON.stringify({ intro: {
  title: 'Ein Gespräch am Arbeitsplatz', topic: 'Deutsch B1', level: 'B1',
  description: 'Sprechen Sie über Ihre Erfahrungen und bereiten Sie sich auf ein Gespräch vor.',
  goal: 'Über den Arbeitsalltag sprechen und höfliche Fragen formulieren.',
  learning_outcomes: ['Erfahrungen beschreiben', 'Fragen im Gespräch stellen'], estimated_time: '≈ 10 min',
} }) };
const folder = { id: 'design-preview-folder', name: 'Deutsch · Alltag und Beruf', role: 'viewer', parent_id: null };
const SCREENS = { home: 'Главный экран', course: 'Учебная колода', ordinary: 'Обычная колода', completion: 'Завершение занятия' };

/** Read-only real components with fixtures; never switches app view or mutates deck/session stores. */
export const GeneralDesignPreview = () => {
  const [screen, setScreen] = useState('home');
  const [width, setWidth] = useState('430');
  return (
    <section className="design-live-preview" aria-label={tr('Живой предпросмотр')}>
      <div className="design-preview-selectors">
        <label>{tr('Экран предпросмотра')}
          <select aria-label={tr('Экран предпросмотра')} value={screen} onChange={e => setScreen(e.target.value)}>
            {Object.entries(SCREENS).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}
          </select>
        </label>
        <label>{tr('Ширина предпросмотра')}
          <select aria-label={tr('Ширина предпросмотра')} value={width} onChange={e => setWidth(e.target.value)}>
            {['320', '375', '430', '768', '1080'].map(value => <option key={value} value={value}>{value} px</option>)}
          </select>
        </label>
      </div>
      <p className="design-editor-note">{tr('Демонстрационные данные. Изменения видны только здесь до публикации. Ширина ограничена доступным местом.')}</p>
      <DesignPreviewScope className="design-general-preview" style={{ maxWidth: `${width}px` }}>
        <div className="design-preview-content" onClickCapture={stopAction} onPointerDownCapture={stopAction}>
          {screen === 'home' && <DndContext>
            <div className="design-home-preview">
              <h2>{tr('Мои колоды')}</h2>
              <FolderCardItem folder={folder} folders={[folder]} decks={[ordinary, course]} setActiveFolderId={noop} showToast={noop} />
              {[ordinary, course].map(deck => <DeckCardItem key={deck.id} deck={deck} folders={[folder]} setCurrentDeck={noop} fetchDeckCards={noop} showToast={noop} />)}
            </div>
          </DndContext>}
          {(screen === 'ordinary' || screen === 'course') && <DeckIntro previewData={{ deck: screen === 'course' ? course : ordinary, cards: [], folders: [] }} startStudy={noop} />}
          {screen === 'completion' && <LessonCompletion deck={course} stats={{ exercises: 12, correct: 10, mistakes: 2, accuracy: '83%', duration: '08:30' }} onGoToDeck={noop} onClose={noop} />}
        </div>
        <div className="design-button-samples" aria-label={tr('Состояния кнопок')}>
          <button type="button" className="design-ui-button design-ui-button-primary"><Play size={16} />{tr('Основная')}</button>
          <button type="button" className="design-ui-button design-ui-button-secondary"><List size={16} />{tr('Второстепенная')}</button>
          <button type="button" className="design-ui-button design-ui-button-primary" disabled>{tr('Недоступно')}</button>
          <button type="button" className="design-ui-button design-ui-button-secondary" disabled>{tr('Недоступно')}</button>
        </div>
      </DesignPreviewScope>
    </section>
  );
};
