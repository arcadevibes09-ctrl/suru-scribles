// FILE: src/components/mountain/MountainSyllabusView.jsx
import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState
} from 'react';
import NotebookPage from '../../NotebookPage';
import MountainIslandPopup from './MountainIslandPopup';
import GlitchCatMini from './GlitchCatMini';
import {
  prepareNightMountainTheme,
  finalizeNightMountainTheme,
  getMountainChunkCount,
  getMountainZoom,
  getMountainScrollX,
  setMountainScrollX,
  lockMountainScroll,
  scrollMountainRange,
  killShanShuiAutoScroll
} from '../../engine/mountainColorizer';
import '../../styles/MountainSyllabus.css';

/* ------------------------------------------------------------------ *
 *  ROAD TUNING
 *  The mountain is a road. Topics are points on it, ROAD_SPACING world
 *  units apart. Scrolling moves continuously along the road; a topic only
 *  "appears" when you come close to it.
 *
 *  Momentum is TIME-BASED (not frame-based) so slow devices stop the same
 *  way as fast ones: flick intensity decides distance, then friction kills it.
 * ------------------------------------------------------------------ */
const MOUNTAIN_SCALE = 1; // keep in sync with the CSS fallback (--mtn-scale)
const ROAD_SPACING = 460;    // world units between two topics
const REACH = 55;            // world units: a topic counts as "reached" inside this
const SNAP = 40;             // world units: tiny magnetic settle when you stop right next to a topic
const MAX_STEP = 30;         // max world units moved per ~16ms tick (smooth, lets chunks generate)
const FRICTION = 0.88;       // per ~16.67ms at 60fps; applied as Math.pow(FRICTION, dt)
const MAX_FLICK = 11;        // cap on release speed -> hard flick glides ~1/4 of a topic gap
const PAGE_STEP = 90;        // world units the mountain drifts when you flip pages in the notebook
const WINDOW = 2;            // topics mounted on each side of the nearest one
const GUARD_IDLE_MS = 320;   // do not fight the user for this long after last input

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);

const nodePos = (r, i) => (i - r.anchor) * ROAD_SPACING;

const roadBounds = (r, n) => ({
  min: nodePos(r, 0) - ROAD_SPACING * 0.5,
  max: nodePos(r, Math.max(0, n - 1)) + ROAD_SPACING * 0.5
});

// Deterministic "winding road" height for each topic (fraction of stage height)
const nodeYFrac = (i) => {
  const s = Math.sin(i * 78.233) * 43758.5453;
  return 0.42 + (s - Math.floor(s)) * 0.26;
};

export default function MountainSyllabusView({
  stage, // 'dots' | 'pill' | 'page'
  setStage,
  topics = [],
  activeTopic,
  onSelectTopic,
  currentMode,
  onToggleMode,
  allModeData,
  simpleData,
  immersiveNotes,
  setImmersiveNotes,
  readerFontSize,
  setReaderFontSize
}) {
  const stageElRef = useRef(null);
  const iframeRef = useRef(null);
  const nodeEls = useRef({});
  const readyTimer = useRef(null);
  const alive = useRef(true);
  const pinchStartDist = useRef(null);
  const pinchLocked = useRef(false);
  const touchLast = useRef(null);

  // All per-frame road state lives in a ref (no React re-render while scrolling)
  const road = useRef({
    pos: 0,          // where the camera is on the road (world units)
    target: 0,       // where it is heading
    vel: 0,          // momentum (units per ~16.67ms)
    flick: 0,        // smoothed finger speed
    sent: 0,         // how far we have already scrolled the mountain
    base: null,      // mountain's own scroll position when we took control
    k: 1,            // measured "world units moved per unit requested"
    kCal: false,
    trustMem: true,  // false if the mountain does not report its position
    anchor: 0,       // topic index that sits at pos = 0
    zoom: 1.142,
    dragging: false,
    snapPending: false,
    userMoved: false,
    lastInteract: 0,
    lastMoveT: 0,
    lastSelectT: 0,
    lastTickT: 0,    // for time-based friction / ease
    raf: 0,
    ready: false,
    selected: -1,
    reached: -1,
    nearest: -1
  });

  const [ready, setReady] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1); // topic currently reached (-1 = on the open road)
  const [nearIdx, setNearIdx] = useState(0);      // topic closest to the camera

  const safeTopics = topics.length > 0 ? topics : [];
  const currentIndex = activeTopic
    ? Math.max(0, safeTopics.findIndex((t) => t.id === activeTopic.id))
    : 0;
  const resolvedTopic = safeTopics[currentIndex] || activeTopic || safeTopics[0];

  // Latest-value refs so the animation loop never reads stale props
  const topicsRef = useRef(safeTopics);
  topicsRef.current = safeTopics;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const onSelectRef = useRef(onSelectTopic);
  onSelectRef.current = onSelectTopic;
  const setStageRef = useRef(setStage);
  setStageRef.current = setStage;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  /* -------------------- node placement (no React renders) -------------------- */
  const layoutNodes = useCallback(() => {
    const stageEl = stageElRef.current;
    if (!stageEl) return;
    const r = road.current;
    const W = stageEl.clientWidth;
    const H = stageEl.clientHeight;
    const ppu = r.zoom * MOUNTAIN_SCALE;

    Object.keys(nodeEls.current).forEach((key) => {
      const el = nodeEls.current[key];
      if (!el) return;
      const idx = Number(key);
      const dx = (nodePos(r, idx) - r.pos) * ppu;
      // appears while approaching the middle, fully there when you are on it
      const k = clamp01((0.46 * W - Math.abs(dx)) / (0.26 * W));
      const y = H * nodeYFrac(idx);
      el.style.transform = `translate3d(${(W / 2 + dx).toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(0.6 + 0.4 * k).toFixed(3)})`;
      el.style.opacity = k.toFixed(3);
      el.style.pointerEvents = k > 0.55 ? 'auto' : 'none';
    });
  }, []);

  /* -------------------- animation loop (runs only while moving) -------------------- */
  const tick = useCallback(() => {
    const r = road.current;
    r.raf = 0;
    const topicsNow = topicsRef.current;
    const n = topicsNow.length;
    if (!r.ready || n === 0) return;

    const { min, max } = roadBounds(r, n);
    const now = performance.now();
    // dt ≈ 1 at 60fps; capped so a long stall does not teleport
    const dt = r.lastTickT ? Math.min(2.5, Math.max(0.25, (now - r.lastTickT) / 16.67)) : 1;
    r.lastTickT = now;
    let busy = false;

    // momentum after a flick / wheel — TIME-BASED so slow phones stop the same way
    if (!r.dragging) {
      if (Math.abs(r.vel) > 0.12) {
        r.target = clamp(r.target + r.vel * dt, min, max);
        r.vel *= Math.pow(FRICTION, dt);
        if (Math.abs(r.vel) < 0.12) r.vel = 0;
        if (r.target === min || r.target === max) r.vel = 0;
        busy = true;
      } else {
        r.vel = 0;
      }
    }

    // gently settle onto a nearby topic once the user has stopped
    if (!r.dragging && r.vel === 0 && r.snapPending) {
      if (now - r.lastInteract > 110) {
        r.snapPending = false;
        const idx = clamp(Math.round(r.target / ROAD_SPACING + r.anchor), 0, n - 1);
        if (Math.abs(nodePos(r, idx) - r.target) < SNAP) r.target = nodePos(r, idx);
      }
      busy = true;
    }

    // ease the camera toward the target (time-aware, capped so it never teleports)
    const diff = r.target - r.pos;
    if (Math.abs(diff) > 0.02) {
      const ease = 1 - Math.pow(1 - 0.28, dt);
      r.pos += clamp(diff * ease, -MAX_STEP * dt, MAX_STEP * dt);
      busy = true;
    } else {
      r.pos = r.target;
    }

    // move the actual mountain by the same distance
    const win = iframeRef.current && iframeRef.current.contentWindow;
    const want = r.pos - r.sent;
    if (win && Math.abs(want) >= 0.5) {
      const req = want / r.k;
      const moved = scrollMountainRange(win, req); // how far the mountain REALLY moved
      if (!r.kCal && Math.abs(req) >= 2) {
        r.kCal = true;
        if (r.base === null || Math.abs(moved) < 1e-6) {
          r.trustMem = false; // mountain does not report its position: trust our own count
        } else {
          const k = moved / req;
          if (isFinite(k) && k > 0.2 && k < 5) r.k = k;
        }
      }
      r.sent += r.trustMem ? moved : req * r.k;
    }

    layoutNodes();

    // which topic is near / reached?
    const idx = clamp(Math.round(r.pos / ROAD_SPACING + r.anchor), 0, n - 1);
    const reached = Math.abs(nodePos(r, idx) - r.pos) <= REACH ? idx : -1;

    if (idx !== r.nearest) {
      r.nearest = idx;
      setNearIdx(idx);
    }
    if (reached !== r.reached) {
      r.reached = reached;
      setActiveIdx(reached);
    }

    const st = stageRef.current;
    if (st !== 'page' && reached >= 0 && reached !== r.selected) {
      r.selected = reached;
      r.lastSelectT = now;
      if (onSelectRef.current) onSelectRef.current(topicsNow[reached]);
    }
    // leaving a topic while its pill is open folds it back into a dot
    if (st === 'pill' && reached === -1 && r.userMoved) {
      setStageRef.current('dots');
    }

    if (busy) r.raf = requestAnimationFrame(tick);
  }, [layoutNodes]);

  const kick = useCallback(() => {
    const r = road.current;
    if (!r.raf && r.ready) {
      r.lastTickT = performance.now();
      r.raf = requestAnimationFrame(tick);
    }
  }, [tick]);

  /* -------------------- delayed reveal: render -> recolor -> fade in -------------------- */
  const handleIframeLoad = useCallback(() => {
    if (readyTimer.current) clearTimeout(readyTimer.current);
    const r = road.current;
    r.ready = false;
    setReady(false);

    let tries = 0;
    let lastCount = -2;
    let stableTicks = 0;

    const reveal = () => {
      if (!alive.current) return;
      const win = iframeRef.current && iframeRef.current.contentWindow;
      const n = topicsRef.current.length;

      // Kill present()/autoxcroll BEFORE we take control
      killShanShuiAutoScroll(win);
      r.zoom = getMountainZoom(win);
      // from now on ONLY this component can scroll the mountain
      lockMountainScroll(win);
      killShanShuiAutoScroll(win); // second pass after lock

      r.base = getMountainScrollX(win);
      r.k = 1;
      r.kCal = false;
      r.trustMem = r.base !== null;
      r.anchor = clamp(currentIndexRef.current, 0, Math.max(0, n - 1));
      r.pos = 0;
      r.target = 0;
      r.sent = 0;
      r.vel = 0;
      r.flick = 0;
      r.lastTickT = 0;
      r.selected = r.anchor;
      r.reached = r.anchor;
      r.nearest = r.anchor;
      r.ready = true;
      setActiveIdx(r.anchor);
      setNearIdx(r.anchor);
      setReady(true);
    };

    const poll = () => {
      if (!alive.current) return;
      const win = iframeRef.current && iframeRef.current.contentWindow;
      if (!win) return;
      tries += 1;

      try {
        prepareNightMountainTheme(win);
        killShanShuiAutoScroll(win);
      } catch {
        /* frame not ready yet */
      }

      const count = getMountainChunkCount(win);
      if (count > 0 && count === lastCount) stableTicks += 1;
      else stableTicks = 0;
      lastCount = count;

      const hasMem = count !== -1;
      const done =
        (hasMem && stableTicks >= 3) || // chunk count unchanged for ~300ms
        (!hasMem && tries >= 12) ||     // MEM not exposed -> just wait ~1.2s
        tries >= 60;                    // hard cap ~6s

      if (!done) {
        readyTimer.current = setTimeout(poll, 100);
        return;
      }

      // recolor what was drawn, give the browser two frames to paint it, then fade in
      try {
        finalizeNightMountainTheme(win);
        killShanShuiAutoScroll(win);
      } catch {
        /* ignore */
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          readyTimer.current = setTimeout(reveal, 150);
        })
      );
    };

    poll();
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (readyTimer.current) clearTimeout(readyTimer.current);
      const r = road.current;
      if (r.raf) cancelAnimationFrame(r.raf);
      r.raf = 0;
    };
  }, []);

  useEffect(() => {
    const onResize = () => layoutNodes();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [layoutNodes]);

  useEffect(() => {
    road.current.userMoved = false;
  }, [stage]);

  // Safety net: if the mountain moves by itself while we are fully idle, pin it back.
  // Does NOT run while dragging, animating, or within GUARD_IDLE_MS of user input —
  // that was the main source of "keeps scrolling after I swipe".
  useEffect(() => {
    if (!ready) return undefined;
    let id = 0;
    let suspect = null;
    const guard = () => {
      const r = road.current;
      const win = iframeRef.current && iframeRef.current.contentWindow;
      const idle =
        win &&
        r.ready &&
        r.base !== null &&
        r.trustMem &&
        !r.raf &&
        !r.dragging &&
        performance.now() - r.lastInteract > GUARD_IDLE_MS;

      if (idle) {
        // Periodically re-kill present() in case something restarted it
        if (Math.random() < 0.02) killShanShuiAutoScroll(win);

        const cur = getMountainScrollX(win);
        if (cur !== null) {
          const expected = r.base + r.sent;
          if (Math.abs(cur - expected) > 0.75) {
            if (suspect === null) {
              suspect = cur;
            } else if (Math.abs(cur - suspect) < 0.01) {
              // one-off jump that settled: accept it
              r.base += cur - expected;
              suspect = null;
            } else {
              // still creeping: pin back + kill auto-scroll again
              killShanShuiAutoScroll(win);
              setMountainScrollX(win, expected);
              suspect = null;
            }
          } else {
            suspect = null;
          }
        }
      } else {
        suspect = null;
      }
      id = requestAnimationFrame(guard);
    };
    id = requestAnimationFrame(guard);
    return () => cancelAnimationFrame(id);
  }, [ready]);

  // place freshly mounted nodes immediately (before paint)
  useLayoutEffect(() => {
    layoutNodes();
  }, [ready, nearIdx, activeIdx, stage, safeTopics.length, layoutNodes]);

  useEffect(() => {
    if (!activeTopic && safeTopics.length > 0 && onSelectTopic) {
      onSelectTopic(safeTopics[0]);
    }
  }, [activeTopic, safeTopics, onSelectTopic]);

  // topic changed from outside (e.g. opened from a list): glide there along the road
  useEffect(() => {
    const r = road.current;
    if (!ready || safeTopics.length === 0) return;
    if (currentIndex === r.selected) return;
    if (performance.now() - r.lastSelectT < 400) return; // our own selection echoing back
    r.selected = currentIndex;
    r.vel = 0;
    r.snapPending = false;
    r.target = nodePos(r, currentIndex);
    kick();
  }, [currentIndex, ready, safeTopics.length, kick]);

  // Move along the road to a topic (prev/next buttons, tapping a visible dot)
  const goToIndex = useCallback(
    (idx) => {
      const r = road.current;
      const list = topicsRef.current;
      if (!r.ready || idx < 0 || idx >= list.length) return;
      r.vel = 0;
      r.snapPending = false;

      if (stageRef.current === 'page') {
        // Reading view: drift only a little, then re-anchor the road so the new
        // topic sits exactly where the mountain ends up. No long ride to the next point.
        const dir = idx > currentIndexRef.current ? 1 : -1;
        const P = r.target + dir * PAGE_STEP;
        r.anchor = idx - P / ROAD_SPACING;
        r.target = P;
        r.selected = idx;
        r.lastSelectT = performance.now();
        if (onSelectRef.current) onSelectRef.current(list[idx]);
      } else {
        r.target = nodePos(r, idx);
      }
      kick();
    },
    [kick]
  );

  /* -------------------- input -------------------- */
  const handleWheel = (e) => {
    if (stage === 'page' && !e.ctrlKey) {
      return;
    }

    if (e.ctrlKey) {
      e.preventDefault();
      if (stage === 'page') {
        setReaderFontSize((prev) =>
          Number(
            Math.min(Math.max(0.75, prev + (e.deltaY < 0 ? 0.05 : -0.05)), 2.2).toFixed(2)
          )
        );
      } else if (e.deltaY < 0) {
        setStage((prev) => (prev === 'dots' ? 'pill' : 'page'));
      } else {
        setStage('dots');
      }
      return;
    }

    const r = road.current;
    if (!r.ready) return;
    const n = topicsRef.current.length;
    const { min, max } = roadBounds(r, n);
    const ppu = r.zoom * MOUNTAIN_SCALE;
    // Direct target move from wheel — intensity = delta, no residual velocity
    r.vel = 0;
    r.target = clamp(r.target + ((e.deltaY + e.deltaX) / ppu) * 0.9, min, max);
    r.userMoved = true;
    r.snapPending = true;
    r.lastInteract = performance.now();
    kick();
  };

  const handleTouchStart = (e) => {
    const r = road.current;
    if (e.touches.length === 2) {
      pinchLocked.current = false;
      r.dragging = false;
      touchLast.current = null;
      pinchStartDist.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    } else if (e.touches.length === 1 && stage !== 'page' && r.ready) {
      touchLast.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      r.dragging = true;
      r.vel = 0;
      r.flick = 0;
      r.snapPending = false;
      r.lastMoveT = performance.now();
      r.lastInteract = performance.now();
    }
  };

  const handleTouchMove = (e) => {
    const r = road.current;

    if (e.touches.length === 2 && pinchStartDist.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = dist - pinchStartDist.current;

      if (stage === 'page') {
        if (Math.abs(delta) > 10) {
          setReaderFontSize((prev) =>
            Number(
              Math.min(Math.max(0.75, prev + (delta > 0 ? 0.04 : -0.04)), 2.2).toFixed(2)
            )
          );
          pinchStartDist.current = dist;
        }
      } else if (!pinchLocked.current) {
        if (delta > 45) {
          pinchLocked.current = true;
          setStage((prev) => (prev === 'dots' ? 'pill' : 'page'));
        } else if (delta < -45 && stage === 'pill') {
          pinchLocked.current = true;
          setStage('dots');
        }
      }
      return;
    }

    if (e.touches.length === 1 && stage !== 'page' && r.dragging && touchLast.current) {
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      // swiping left OR up walks forward along the road, right OR down walks back
      const d = touchLast.current.x - x + (touchLast.current.y - y);
      touchLast.current = { x, y };

      const du = d / (r.zoom * MOUNTAIN_SCALE);
      const { min, max } = roadBounds(r, topicsRef.current.length);
      r.target = clamp(r.target + du, min, max);
      // blend recent deltas for a stable flick speed (still in "per touch sample" units)
      r.flick = r.flick * 0.55 + du * 0.45;
      r.lastMoveT = performance.now();
      r.lastInteract = performance.now();
      r.userMoved = true;
      kick();
    }
  };

  const handleTouchEnd = () => {
    const r = road.current;
    pinchStartDist.current = null;
    pinchLocked.current = false;
    touchLast.current = null;

    if (r.dragging) {
      r.dragging = false;
      const stillMoving = performance.now() - r.lastMoveT < 90;
      // Cap flick so intensity maps to a finite glide, then friction stops it
      r.vel = stillMoving ? clamp(r.flick * 0.85, -MAX_FLICK, MAX_FLICK) : 0;
      r.flick = 0;
      r.snapPending = true;
      r.lastInteract = performance.now();
      kick();
    }
  };

  /* -------------------- render -------------------- */
  const basePayload =
    (resolvedTopic && simpleData?.[resolvedTopic.id]) || {
      text: `## ${resolvedTopic?.title || 'Note'}\n\nSyllabus unit ready.`,
      glossary: {}
    };

  const activeModePayload =
    resolvedTopic && allModeData?.[currentMode]?.[resolvedTopic.id]
      ? allModeData[currentMode][resolvedTopic.id]
      : basePayload;

  const visibleIdx = [];
  if (ready && safeTopics.length > 0) {
    const from = Math.max(0, nearIdx - WINDOW);
    const to = Math.min(safeTopics.length - 1, nearIdx + WINDOW);
    for (let i = from; i <= to; i++) visibleIdx.push(i);
  }

  return (
    <div
      ref={stageElRef}
      className={`mountain-syllabus-stage stage-${stage} ${
        immersiveNotes ? 'is-immersive-dark' : ''
      }`}
      style={{ '--mtn-scale': MOUNTAIN_SCALE }}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 1. Shan-Shui mountain (hidden until rendered + recolored, then fades in) */}
      <div className="mountain-canvas-layer">
        <iframe
          ref={iframeRef}
          src="/shan-shui.html"
          title="Shan Shui Mountains"
          className={`shan-shui-iframe ${ready ? 'is-ready' : ''}`}
          allowTransparency="true"
          onLoad={handleIframeLoad}
        />
      </div>

      {/* soft fade so the peaks never end in a hard line near the top */}
      <div className="mountain-top-fade" />

      {!ready && (
        <div className="mountain-loading">
          <GlitchCatMini state="processing" size={34} />
        </div>
      )}

      {/* 2. Topic points sit on the road and appear as you reach them */}
      {ready && stage !== 'page' && (
        <div className="mountain-nodes-layer">
          {visibleIdx.map((idx) => {
            const topic = safeTopics[idx];
            const isActive = idx === activeIdx;
            return (
              <div
                key={topic.id}
                className="mountain-road-node"
                style={{ opacity: 0 }}
                ref={(el) => {
                  if (el) nodeEls.current[idx] = el;
                  else delete nodeEls.current[idx];
                }}
              >
                <MountainIslandPopup
                  topic={topic}
                  stage={isActive && stage === 'pill' ? 'pill' : 'dots'}
                  isPrimary={isActive}
                  offsetStyle={{
                    top: 0,
                    left: 0,
                    transform: 'translate3d(-50%, -50%, 0)'
                  }}
                  onTapDot={() => {
                    if (isActive) setStage('pill');
                    else goToIndex(idx);
                  }}
                  onTapPill={() => setStage('page')}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Stage 3 ('page'): Translucent Notebook View with visible background mountains */}
      <div
        className={`mountain-notebook-glass-sheet ${
          stage === 'page' ? 'is-open' : ''
        } ${immersiveNotes ? 'is-immersive-black' : ''}`}
        onDoubleClick={() => {
          if (stage === 'page') {
            setImmersiveNotes((prev) => !prev);
          }
        }}
        style={{ fontSize: `${readerFontSize}rem` }}
      >
        {stage === 'page' && resolvedTopic && (
          <div className="full-page-container mountain-page-inner">
            <div className="full-page-header-row">
              <div>
                <h1 className="full-page-title">{resolvedTopic.title}</h1>
                {!immersiveNotes && (
                  <p className="full-page-sub">{resolvedTopic.subtitle}</p>
                )}
              </div>

              {!immersiveNotes && (
                <div className="subtle-mode-wrap">
                  <button
                    type="button"
                    className="uni-btn subtle"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMode();
                    }}
                  >
                    {currentMode}
                  </button>
                </div>
              )}
            </div>

            <NotebookPage
              topicId={resolvedTopic.id}
              topicData={activeModePayload}
              hasPrevTopic={currentIndex > 0}
              hasNextTopic={currentIndex < safeTopics.length - 1}
              onPrevTopic={() => goToIndex(currentIndex - 1)}
              onNextTopic={() => goToIndex(currentIndex + 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
