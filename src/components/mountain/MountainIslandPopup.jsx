// FILE: src/components/mountain/MountainIslandPopup.jsx
import React from 'react';
import GlitchCatMini from './GlitchCatMini';

export default function MountainIslandPopup({
  topic,
  stage = 'dots',
  isPrimary = true,
  offsetStyle = {},
  onTapDot,
  onTapPill
}) {
  if (!topic) return null;

  const isExpandedPill = stage === 'pill' && isPrimary;

  return (
    <div
      className={`mountain-node-marker ${
        isExpandedPill ? 'mode-pill' : 'mode-dot'
      } ${isPrimary ? 'is-active-node' : 'is-neighbor-node'}`}
      style={offsetStyle}
      onClick={(e) => {
        e.stopPropagation();
        if (isExpandedPill) {
          onTapPill && onTapPill();
        } else {
          onTapDot && onTapDot();
        }
      }}
    >
      <div className="mn-avatar-circle">
        <GlitchCatMini state={isExpandedPill ? 'speaking' : 'idle'} size={32} />
      </div>

      {/* Always mounted so the dot <-> pill morph can animate smoothly */}
      <div className="mn-pill-content" aria-hidden={!isExpandedPill}>
        <div className="mn-pill-title">{topic.title}</div>
        {topic.subtitle && (
          <div className="mn-pill-desc">{topic.subtitle}</div>
        )}
      </div>
    </div>
  );
}
