// FILE: src/components/mountain/GlitchCatMini.jsx
import React, { useState, useEffect, useRef } from 'react';
import atlas from '../../atlas/atlas.json';

const ROW_FOR_STATE = {
  idle: 0,
  speaking: 1,
  action: 2,
  notifying: 3,
  emotional: 5,
  listening: 6,
  processing: 7,
  curiosity: 8,
  timer: 0
};

export default function GlitchCatMini({ state = 'curiosity', size = 28 }) {
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  const rowIndex = ROW_FOR_STATE[state] ?? 0;
  const rowData = atlas.rows[rowIndex] || atlas.rows[0];
  const frameCount = rowData.frames.length;

  useEffect(() => {
    frameRef.current = 0;
    setFrame(0);
    const timer = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % frameCount;
      setFrame(frameRef.current);
    }, 95);
    return () => clearInterval(timer);
  }, [state, frameCount]);

  const currentFrame = rowData.frames[frame] || rowData.frames[0];
  const scale = size / rowData.height;

  return (
    <div
      className="glitchcat-mini-avatar"
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        borderRadius: '50%'
      }}
    >
      <img
        src="/spritesheet.webp"
        alt={`Suru ${state}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: atlas.sheetWidth * scale,
          height: atlas.sheetHeight * scale,
          maxWidth: 'none',
          imageRendering: 'pixelated',
          transform: `translate(${-currentFrame.x * scale}px, ${-rowData.y * scale}px)`,
          transition: 'none'
        }}
      />
    </div>
  );
}
