// FILE: src/components/mountain/SyllabusViewToggle.jsx
import React from 'react';
import { Mountain, Layers } from 'lucide-react';

export default function SyllabusViewToggle({ isMountainMode, onToggle }) {
  return (
    <button
      type="button"
      className={`uni-btn subtle syllabus-mountain-toggle ${isMountainMode ? 'active' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={isMountainMode ? 'Switch to Stack View' : 'Switch to Shan-Shui Mountain View'}
    >
      {isMountainMode ? (
        <>
          <Layers size={13} />
          <span>Stack</span>
        </>
      ) : (
        <>
          <Mountain size={13} />
          <span>Mountains</span>
        </>
      )}
    </button>
  );
}
