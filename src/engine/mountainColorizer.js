// FILE: src/engine/mountainColorizer.js
// Night-theme tinting for the Shan Shui iframe.
//
//  - No black background is forced inside the iframe: the paper is removed
//    (transparent) and the app's own black shows through.
//  - Tinted colors are written as `rgb(r g b / a)` so the matcher never matches
//    them again -> tinting is idempotent (no drift, no compounding alpha).
//  - Theme work is split in two phases so the view can keep the iframe hidden
//    until everything is rendered AND recolored:
//        prepareNightMountainTheme()  -> CSS + generator wrappers (cheap, repeatable)
//        finalizeNightMountainTheme() -> recolor chunks that already exist (one time)
//  - New chunks created while scrolling are tinted by the wrapped generators, and
//    tintPendingChunks() is a safety net that runs right after each scroll call.
//  - killShanShuiAutoScroll() stops present()/autoxcroll/body scroll that lockMountainScroll
//    alone cannot catch (present uses document.body.scrollTo, not xcroll).

const RGBA_REGEX = /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([0-9.]+))?\s*\)/gi;

const out = (r, g, b, a) => `rgb(${r} ${g} ${b} / ${Math.min(1, a).toFixed(3)})`;

export function tintSvgChunk(svgStr, category = 'auto') {
  if (typeof svgStr !== 'string' || !svgStr) return svgStr;

  return svgStr.replace(RGBA_REGEX, (match, rStr, gStr, bStr, aStr) => {
    const r = parseFloat(rStr);
    const g = parseFloat(gStr);
    const b = parseFloat(bStr);
    const a = aStr !== undefined ? parseFloat(aStr) : 1.0;

    // 1. Paper wash / occluding fills -> black (same alpha), so near ranges still
    //    hide far ones and the app background shows through cleanly.
    if (r > 180 && g > 180 && b > 170) {
      return out(0, 0, 0, a);
    }

    const intensity = Math.max(0.25, 1 - r / 210);

    // 2. Trees
    if (category === 'tree') {
      if (Math.round(r * 17) % 6 === 0 && a > 0.3) {
        return out(244, 114, 182, a * 1.4); // sakura pink
      }
      return out(34, Math.round(140 + intensity * 90), Math.round(100 + intensity * 60), a * 1.35);
    }

    // 3. Architecture
    if (category === 'arch') {
      if (a > 0.5) return out(251, 191, 36, a * 1.35); // amber
      return out(248, 113, 113, a * 1.35); // crimson
    }

    // 4. Water
    if (category === 'water') {
      return out(56, 189, 248, Math.min(0.88, a * 1.5));
    }

    // 5. Mountain strokes
    if (a > 0.65) {
      if (Math.round(r) % 5 === 0) return out(251, 191, 36, Math.min(0.95, a * 1.15));
      return out(52, 211, 153, Math.min(0.95, a * 1.2));
    }

    return out(
      Math.round(30 + intensity * 45),
      Math.round(135 + intensity * 85),
      Math.round(195 + intensity * 60),
      Math.min(0.95, a * 1.35)
    );
  });
}

function wrapGeneratorObject(obj, category) {
  if (!obj) return;
  Object.keys(obj).forEach((key) => {
    if (typeof obj[key] === 'function' && !obj[key].__suruWrapped) {
      const orig = obj[key];
      const wrapped = function (...args) {
        return tintSvgChunk(orig.apply(this, args), category);
      };
      wrapped.__suruWrapped = true;
      obj[key] = wrapped;
    }
  });
}

/**
 * Stop every built-in Shan Shui auto-scroll path:
 *  - present()  (body.scrollTo loop, NOT xcroll)
 *  - autoxcroll() (recursive setTimeout when AUTO_SCROLL is checked)
 *  - leftover body / document scrolling
 * Safe to call repeatedly.
 */
export function killShanShuiAutoScroll(iframeWindow) {
  if (!iframeWindow) return;
  try {
    // Break present() recursion: condition becomes false immediately
    iframeWindow.pFrame = 1e9;
    iframeWindow.lastScrollX = 1e9;
  } catch {
    /* ignore */
  }

  try {
    if (typeof iframeWindow.autoxcroll === 'function') {
      iframeWindow.autoxcroll = function () {};
    }
  } catch {
    /* ignore */
  }

  try {
    const doc = iframeWindow.document;
    if (doc) {
      const auto = doc.getElementById('AUTO_SCROLL');
      if (auto) {
        auto.checked = false;
        auto.disabled = true;
      }
      // Hide native scroll UI that can re-trigger motion
      ['L', 'R', 'SET_BTN', 'SETTING', 'SOURCE_BTN'].forEach((id) => {
        const el = doc.getElementById(id);
        if (el) {
          el.style.display = 'none';
          el.style.pointerEvents = 'none';
        }
      });
      if (doc.body) {
        doc.body.style.overflow = 'hidden';
        try {
          doc.body.scrollTo(0, 0);
        } catch {
          /* ignore */
        }
      }
      if (doc.documentElement) {
        doc.documentElement.style.overflow = 'hidden';
      }
    }
  } catch {
    /* ignore */
  }

  try {
    if (typeof iframeWindow.scrollTo === 'function') {
      iframeWindow.scrollTo(0, 0);
    }
  } catch {
    /* ignore */
  }
}

/** Phase 1: transparent background + hide built-in UI + tint future chunks. Safe to repeat. */
export function prepareNightMountainTheme(iframeWindow) {
  if (!iframeWindow || !iframeWindow.document) return;
  const doc = iframeWindow.document;

  if (!doc.getElementById('suru-night-scroll-css') && doc.head) {
    const style = doc.createElement('style');
    style.id = 'suru-night-scroll-css';
    style.textContent = `
      html, body, #BG {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      #BG, #BG svg {
        background: transparent !important;
        filter: none !important;
        mix-blend-mode: normal !important;
      }
      #BG svg { display: block !important; }
      #BG svg > rect:first-of-type {
        fill: transparent !important;
        filter: none !important;
      }
      #SET_BTN, #L, #R, #SETTING, #SOURCE_BTN, a, #AUTO_SCROLL {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    doc.head.appendChild(style);
  }

  // Always try to kill auto-scroll when preparing theme
  killShanShuiAutoScroll(iframeWindow);

  wrapGeneratorObject(iframeWindow.Mount, 'mount');
  wrapGeneratorObject(iframeWindow.Tree, 'tree');
  wrapGeneratorObject(iframeWindow.Arch, 'arch');
  wrapGeneratorObject(iframeWindow.Man, 'arch');

  if (typeof iframeWindow.water === 'function' && !iframeWindow.water.__suruWrapped) {
    const origWater = iframeWindow.water;
    const wrappedWater = function (...args) {
      return tintSvgChunk(origWater.apply(this, args), 'water');
    };
    wrappedWater.__suruWrapped = true;
    iframeWindow.water = wrappedWater;
  }
}

/** Recolor any chunk that has not been tinted yet. Returns true if something changed. */
export function tintPendingChunks(iframeWindow) {
  if (!iframeWindow) return false;
  const mem = iframeWindow.MEM;
  if (!mem || !Array.isArray(mem.chunks) || mem.chunks.length === 0) return false;

  let changed = false;
  for (let i = 0; i < mem.chunks.length; i++) {
    const chunk = mem.chunks[i];
    if (!chunk || chunk.__suruTinted || typeof chunk.canv !== 'string') continue;
    const tinted = tintSvgChunk(chunk.canv, 'auto');
    if (tinted !== chunk.canv) {
      chunk.canv = tinted;
      changed = true;
    }
    chunk.__suruTinted = true;
  }

  if (!changed) return false;

  let canv = '';
  for (let i = 0; i < mem.chunks.length; i++) canv += mem.chunks[i].canv;
  mem.canv = canv;

  try {
    if (typeof iframeWindow.viewupdate === 'function') {
      iframeWindow.viewupdate();
    } else {
      const bg = iframeWindow.document.getElementById('BG');
      const svg = bg && bg.querySelector('svg');
      if (svg) svg.innerHTML = canv;
    }
  } catch {
    // ignore transient frame timing
  }
  return true;
}

/** Phase 2: one-time recolor of what is already on screen. */
export function finalizeNightMountainTheme(iframeWindow) {
  killShanShuiAutoScroll(iframeWindow);
  return tintPendingChunks(iframeWindow);
}

/** Kept for backwards compatibility. */
export function injectNightMountainTheme(iframeWindow) {
  prepareNightMountainTheme(iframeWindow);
  finalizeNightMountainTheme(iframeWindow);
}

/** How many chunks the mountain has generated so far (-1 if MEM is not exposed). */
export function getMountainChunkCount(iframeWindow) {
  const chunks = iframeWindow && iframeWindow.MEM && iframeWindow.MEM.chunks;
  return Array.isArray(chunks) ? chunks.length : -1;
}

/** World-unit -> pixel factor used by the Shan Shui SVG (falls back to its default). */
export function getMountainZoom(iframeWindow) {
  const z = iframeWindow && iframeWindow.zoom;
  return typeof z === 'number' && z > 0.3 && z < 4 ? z : 1.142;
}

/** Current horizontal scroll of the mountain (null if it does not expose it). */
export function getMountainScrollX(iframeWindow) {
  const x = iframeWindow && iframeWindow.MEM && iframeWindow.MEM.cursx;
  return typeof x === 'number' && isFinite(x) ? x : null;
}

/** Force the mountain to an exact scroll position. */
export function setMountainScrollX(iframeWindow, x) {
  try {
    if (iframeWindow && iframeWindow.MEM && typeof iframeWindow.MEM.cursx === 'number') {
      iframeWindow.MEM.cursx = x;
      if (typeof iframeWindow.viewupdate === 'function') iframeWindow.viewupdate();
      tintPendingChunks(iframeWindow);
    }
  } catch {
    // ignore transient frame timing
  }
}

/**
 * After this, only scrollMountainRange() can scroll the mountain. Any other caller of the
 * page's own xcroll (its auto-scroll, key/drag handlers, arrow buttons) is ignored.
 * Also kills present()/autoxcroll which do not go through xcroll.
 */
export function lockMountainScroll(iframeWindow) {
  if (!iframeWindow) return;

  killShanShuiAutoScroll(iframeWindow);

  if (typeof iframeWindow.xcroll !== 'function') return;
  if (iframeWindow.xcroll.__suruLocked) return;

  const orig = iframeWindow.xcroll;
  const locked = function (v) {
    if (!iframeWindow.__suruAllowScroll) return undefined;
    return orig.call(iframeWindow, v);
  };
  locked.__suruLocked = true;
  locked.__suruOrig = orig;
  iframeWindow.xcroll = locked;
}

/** Scroll by deltaX world units. Returns how far the mountain actually moved. */
export function scrollMountainRange(iframeWindow, deltaX) {
  if (!iframeWindow || typeof iframeWindow.xcroll !== 'function') return 0;
  try {
    const before = getMountainScrollX(iframeWindow);
    iframeWindow.__suruAllowScroll = true;
    try {
      iframeWindow.xcroll(deltaX);
    } finally {
      iframeWindow.__suruAllowScroll = false;
    }
    tintPendingChunks(iframeWindow);
    const after = getMountainScrollX(iframeWindow);
    return before !== null && after !== null ? after - before : deltaX;
  } catch {
    return 0;
  }
}
