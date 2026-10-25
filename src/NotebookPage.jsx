// FILE: src/NotebookPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import Popup from './Popup';
import { predictTopicData } from './engine/predictFormat';
import {
  triggerPageWhisper,
  getPageWhisper
} from './data/Data_Her';

export default function NotebookPage({
  topicId,
  topicData,
  onNextTopic,
  onPrevTopic,
  hasNextTopic = false,
  hasPrevTopic = false
}) {
  const predictedTopic = predictTopicData(topicData);

  const [popupData, setPopupData] = useState({ isOpen: false, word: '', def: '' });
  const [currentPage, setCurrentPage] = useState(0);
  const [whisper, setWhisper] = useState(null);

  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const lastSwipeTime = useRef(0);
  const lastSwipeDir = useRef(null);
  const singleSwipeTimer = useRef(null);
  const longPressTimer = useRef(null);

  const minSwipeDistance = 50;
  const doubleSwipeWindow = 320;

  useEffect(() => {
    setCurrentPage(0);
    setWhisper(getPageWhisper(topicId, 0));
  }, [topicId, topicData]);

  useEffect(() => {
    setWhisper(getPageWhisper(topicId, currentPage));
  }, [topicId, currentPage]);

  useEffect(() => {
    return () => {
      if (singleSwipeTimer.current) clearTimeout(singleSwipeTimer.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleHardClick = (paragraphCount) => {
    if (navigator.vibrate) navigator.vibrate(20);
    const nextWhisper = triggerPageWhisper(topicId, currentPage, paragraphCount);
    setWhisper({ ...nextWhisper });
  };

  const startLongPress = (paragraphCount) => {
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      handleHardClick(paragraphCount);
    }, 460);
  };

  const ArrowLeftIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
  );

  const ArrowRightIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  );

  const renderInline = (str, glossary) => {
    if (typeof str !== 'string') return str;

    const parts = str.split(/(\[\[\[.*?\]\]\]|\[\[.*?\]\]|\{\{.*?\}\}|\*\*.*?\*\*|\*(?!\s)[^*]+\*(?!\w))/g);

    return parts.map((part, index) => {
      if (!part) return null;

      if (part.startsWith('[[[') && part.endsWith(']]]')) {
        return <div key={index} className="note-box">{renderInline(part.slice(3, -3), glossary)}</div>;
      } else if (part.startsWith('[[') && part.endsWith(']]')) {
        const word = part.slice(2, -2);
        let definition = 'No intel found. Add this to your data glossary.';
        if (glossary) {
          const searchKey = word.trim().toLowerCase();
          for (const [key, val] of Object.entries(glossary)) {
            if (key.trim().toLowerCase() === searchKey || searchKey.includes(key.trim().toLowerCase())) {
              definition = val;
              break;
            }
          }
        }
        return (
          <span
            key={index}
            className="highlighted-word"
            onClick={(e) => {
              e.stopPropagation();
              setPopupData({ isOpen: true, word: word, def: definition });
            }}
          >
            {renderInline(word, glossary)}
          </span>
        );
      } else if (part.startsWith('{{') && part.endsWith('}}')) {
        return <span key={index} className="highlighter">{renderInline(part.slice(2, -2), glossary)}</span>;
      } else if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index} className="bold-text">{renderInline(part.slice(2, -2), glossary)}</strong>;
      } else if (part.startsWith('*') && part.endsWith('*')) {
        return <strong key={index} className="bold-text">{renderInline(part.slice(1, -1), glossary)}</strong>;
      }

      return <React.Fragment key={index}>{part}</React.Fragment>;
    });
  };

  const renderText = (text, glossary) => {
    if (!text) return null;

    let cleanText = text.replace(/(^|\n|\s)\*\s/g, '$1• ');
    const pages = cleanText.split('[PAGE]');
    const currentPageText = pages[currentPage] || '';

    const rawBlocks = currentPageText
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    const blocksWithWhisper = [];

    if (whisper && whisper.slot === 0) {
      blocksWithWhisper.push(
        <p key="her_whisper_top" className="her-whisper-line">
          {whisper.text}
        </p>
      );
    }

    rawBlocks.forEach((block, idx) => {
      if (block.startsWith('## ')) {
        blocksWithWhisper.push(
          <div key={`b_${idx}`} className="banner-heading">
            {renderInline(block.slice(3), glossary)}
          </div>
        );
      } else {
        blocksWithWhisper.push(
          <div key={`b_${idx}`} style={{ marginBottom: '14px' }}>
            {renderInline(block, glossary)}
          </div>
        );
      }

      if (whisper && whisper.slot === idx + 1) {
        blocksWithWhisper.push(
          <p key={`her_whisper_${idx}`} className="her-whisper-line">
            {whisper.text}
          </p>
        );
      }
    });

    if (whisper && whisper.slot > rawBlocks.length) {
      blocksWithWhisper.push(
        <p key="her_whisper_end" className="her-whisper-line">
          {whisper.text}
        </p>
      );
    }

    return {
      totalPages: pages.length,
      blockCount: rawBlocks.length,
      content: blocksWithWhisper
    };
  };

  const renderedData = renderText(predictedTopic?.text, predictedTopic?.glossary);
  const totalPages = renderedData?.totalPages || 1;
  const isFirstPage = currentPage === 0;
  const isLastPage = renderedData && currentPage === totalPages - 1;
  const blockCount = renderedData?.blockCount || 2;

  const onTouchStart = (e) => {
    setTouchEnd(null);
    if (e.targetTouches.length === 1) {
      setTouchStart(e.targetTouches[0].clientX);
      startLongPress(blockCount);
    } else {
      clearLongPress();
    }
  };

  const onTouchMove = (e) => {
    if (e.targetTouches.length === 1) {
      const currentX = e.targetTouches[0].clientX;
      setTouchEnd(currentX);
      if (touchStart && Math.abs(currentX - touchStart) > 12) {
        clearLongPress();
      }
    } else {
      clearLongPress();
    }
  };

  const onTouchEnd = () => {
    clearLongPress();
    if (touchStart === null || touchEnd === null) return;

    const distance = touchStart - touchEnd;
    if (Math.abs(distance) < minSwipeDistance) {
      setTouchStart(null);
      setTouchEnd(null);
      return;
    }

    const direction = distance > 0 ? 'left' : 'right';
    const now = Date.now();

    if (
      now - lastSwipeTime.current <= doubleSwipeWindow &&
      lastSwipeDir.current === direction
    ) {
      if (singleSwipeTimer.current) {
        clearTimeout(singleSwipeTimer.current);
        singleSwipeTimer.current = null;
      }
      lastSwipeTime.current = 0;
      lastSwipeDir.current = null;

      if (direction === 'left' && hasNextTopic && onNextTopic) {
        onNextTopic();
      } else if (direction === 'right' && hasPrevTopic && onPrevTopic) {
        onPrevTopic();
      }
    } else {
      lastSwipeTime.current = now;
      lastSwipeDir.current = direction;

      if (singleSwipeTimer.current) {
        clearTimeout(singleSwipeTimer.current);
      }

      singleSwipeTimer.current = setTimeout(() => {
        if (direction === 'left') {
          setCurrentPage((prev) => (prev < totalPages - 1 ? prev + 1 : prev));
        } else if (direction === 'right') {
          setCurrentPage((prev) => (prev > 0 ? prev - 1 : prev));
        }
        lastSwipeTime.current = 0;
        lastSwipeDir.current = null;
        singleSwipeTimer.current = null;
      }, doubleSwipeWindow);
    }

    setTouchStart(null);
    setTouchEnd(null);
  };

  return (
    <div
      className="page-container"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={() => startLongPress(blockCount)}
      onMouseUp={clearLongPress}
      onMouseLeave={clearLongPress}
    >
      <div className="notebook-page">
        <div className="text-content">
          {renderedData ? renderedData.content : <p style={{ color: '#666' }}>No data found.</p>}
        </div>
      </div>

      {renderedData && renderedData.totalPages > 0 && (
        <div className="floating-nav fixed-page-nav">
          {isFirstPage && hasPrevTopic && onPrevTopic && (
            <button
              className="uni-btn subtle next-topic-btn"
              onClick={(e) => {
                e.stopPropagation();
                onPrevTopic();
              }}
              title="Go to previous topic"
            >
              <ArrowLeftIcon />
            </button>
          )}

          <div className="pagination">
            {Array.from({ length: renderedData.totalPages }).map((_, idx) => (
              <span
                key={idx}
                className={`page-num ${currentPage === idx ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentPage(idx);
                }}
              >
                {idx + 1}
              </span>
            ))}
          </div>

          {isLastPage && hasNextTopic && onNextTopic && (
            <button
              className="uni-btn subtle next-topic-btn"
              onClick={(e) => {
                e.stopPropagation();
                onNextTopic();
              }}
              title="Go to next topic"
            >
              <ArrowRightIcon />
            </button>
          )}
        </div>
      )}

      <Popup
        isOpen={popupData.isOpen}
        word={popupData.word}
        definition={popupData.def}
        onClose={() => setPopupData({ ...popupData, isOpen: false })}
      />
    </div>
  );
}
