/* Showtrace website: the demonstrations and the sandbox.

   One script, served by the site itself, loaded as an enhancement: the page reads and works without it. It reads the
   feature cards in index.html (data-demo, data-rows, data-status) and mounts one demonstration per card, drawn in the
   browser on a neutral stand-in screen. What the demonstrations show follows the design spec of the build (the spec
   of 2026-09-15 in docs/specs/ of the Showtrace repository) and its README; the numbers below carry the section they
   come from.

   Motion: each demonstration plays once when it comes into view and again on its play control; Stop ends a play at
   its end state; nothing loops. Under prefers-reduced-motion only end states show, also when the setting changes while
   the page is open; a play stops at its end state when the tab is hidden or its stage leaves the view. The signature
   stroke (brand.md, section 6.6) is CSS; the script only starts it on a step being added to the trace.

   Nothing leaves the browser: no request, no storage, no cookie. The sandbox's PNG is the visitor's own download. */

(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CANCEL = Symbol('cancelled');
  /* A media query a browser cannot answer never matches and never changes. */
  const media = query => (window.matchMedia ? window.matchMedia(query) : { matches: false, addEventListener() {} });
  const reducedMotion = media('(prefers-reduced-motion: reduce)');
  const darkScheme = media('(prefers-color-scheme: dark)');

  /* The build's ink and sizes, in stand-in units that stand for the build's pixels. The brand teal is never ink
     (brand.md, 6.2). The pen #FF3B30, the highlighter and the halo #FFCC00 are the defaults of spec 5.6; the laser red
     #FF1E1E is the build's (LaserTool; spec 6.6 says red). */
  const INK = { pen: '#FF3B30', highlighter: '#FFCC00', laser: '#FF1E1E', halo: '#FFCC00' };
  /* Pen 4 px, a width from 1 to 40 (spec 5.6, 7.1). The highlighter draws 3 times the width at 35 percent opacity, with
     flat caps (spec 6.2, 7.1). Text is Segoe UI, 24 px (spec 6.4, 7.1). Fading ink goes in 600 ms (spec 5.4, 7.1). */
  const PEN_WIDTH = 4;
  const HIGHLIGHTER_FACTOR = 3;
  const HIGHLIGHTER_OPACITY = 0.35;
  const TEXT_SIZE = 24;
  const FADE_OUT_MS = 600;
  /* The laser: a 10 px dot and a trail of 1.5 s (spec 6.6, 7.1), whose segments are 6 px wide when new and narrow to
     30 percent as they fade (the build's LaserTool). The halo: 40 px, yellow, 40 percent (spec 5.6, 7.1). */
  const LASER = { dot: 10, trail: 6, trailMs: 1500 };
  const HALO = { diameter: 40, opacity: 0.4 };
  /* The lens: a rounded square of 320 px (here 200: the stand-in is not to scale) with the corners of the build's lens
     window, 2x at first, 1.5x to 8x in steps of 0.5x (spec 6.7, 7.1). */
  const LENS = { size: 200, radius: 12, start: 2 };
  /* The 32 colours of the palette, in display order (spec 5.8). */
  const PALETTE = [
    '#000000', '#FFFFFF', '#808080', '#C0C0C0', '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
    '#00C7BE', '#30B0C7', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93',
    '#8B0000', '#B45309', '#B8860B', '#166534', '#0F766E', '#0E7490', '#1E40AF', '#4C1D95',
    '#FCA5A5', '#FDBA74', '#FDE68A', '#86EFAC', '#99F6E4', '#A5F3FC', '#93C5FD', '#D8B4FE',
  ];

  /* ---------- DOM ---------- */

  const el = (tag, attrs, ...children) => fill(document.createElement(tag), attrs, children);
  const svg = (tag, attrs, ...children) => fill(document.createElementNS(SVG_NS, tag), attrs, children);

  function fill(node, attrs, children) {
    attr(node, attrs);
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  function attr(node, attrs) {
    if (!attrs) return node;
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    return node;
  }

  function button(label, onClick, attrs) {
    const b = el('button', Object.assign({ type: 'button', class: 'btn', text: label }, attrs));
    b.addEventListener('click', onClick);
    return b;
  }

  /* A labelled group of controls. The group carries the name; the visible label is hidden from a screen reader, so
     that the name is read once. */
  function group(label, ...children) {
    return el('div', { class: 'control-group', role: 'group', 'aria-label': label }, el('span', { class: 'control-label', text: label, 'aria-hidden': 'true' }), ...children);
  }

  const round = v => Math.round(v * 10) / 10;

  /* ---------- Timing ---------- */

  const linear = t => t;
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const P = (x, y) => ({ x, y });

  /* One play of a demonstration. With motion, every wait is a frame loop or a timer. An instant run shows the end
     state at once (reduced motion, a hidden tab, Stop): it asks for no frame and sets no timer, so the whole play
     ends before the browser paints. cancel() stops every pending wait and rejects it with CANCEL. */
  class Run {
    constructor(instant) {
      this.instant = instant;
      this.cancelled = false;
      this.waits = new Set();
    }

    cancel() {
      this.cancelled = true;
      for (const wait of [...this.waits]) { wait.stop(); wait.settle(CANCEL); }
    }

    /* Calls fn(progress) every frame for ms milliseconds, progress eased from 0 to 1. If fn throws, the play ends
       with that error instead of waiting for ever. */
    tween(ms, fn, ease = easeInOut) {
      if (this.cancelled) return Promise.reject(CANCEL);
      if (this.instant || ms <= 0) { fn(1); return Promise.resolve(); }
      return this.wait((done, fail) => {
        const begin = performance.now();
        let frame = requestAnimationFrame(function step(now) {
          const t = Math.max(0, Math.min(1, (now - begin) / ms));
          try { fn(ease(t)); } catch (error) { fail(error); return; }
          if (t < 1) frame = requestAnimationFrame(step); else done();
        });
        return () => cancelAnimationFrame(frame);
      });
    }

    /* A pause in the choreography: rhythm between steps. */
    pause(ms) {
      if (this.cancelled) return Promise.reject(CANCEL);
      if (this.instant || ms <= 0) return Promise.resolve();
      return this.wait(done => { const timer = setTimeout(done, ms); return () => clearTimeout(timer); });
    }

    /* Time the build itself takes, such as the wait before fading ink goes (spec 5.4). It waits like a pause, and an
       instant run skips it too: under reduced motion only the end state shows. */
    hold(ms) {
      return this.pause(ms);
    }

    /* One pending wait. begin(done, fail) starts it and returns how to stop it; a run may have several at once. */
    wait(begin) {
      return new Promise((resolve, reject) => {
        const wait = {
          stop: () => {},
          settle: error => {
            if (!this.waits.delete(wait)) return;
            if (error === undefined) resolve(); else reject(error);
          },
        };
        this.waits.add(wait);
        wait.stop = begin(() => wait.settle(), error => wait.settle(error));
      });
    }
  }

  /* ---------- Geometry ---------- */

  /* A cubic curve sampled into points, with a small fixed wobble so that it reads as a hand's line. */
  function curve(p0, c1, c2, p3, n, wobble = 0) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x;
      const y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y;
      out.push(P(x + Math.sin(i * 1.7) * wobble, y + Math.cos(i * 2.3) * wobble));
    }
    return out;
  }

  /* Catmull-Rom interpolation, 4 subdivisions per segment: how the build smooths a stroke on release (spec 5.3). */
  function smooth(points, subdivisions = 4) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)];
      for (let k = 1; k <= subdivisions; k++) {
        const t = k / subdivisions, t2 = t * t, t3 = t2 * t;
        out.push(P(
          0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)));
      }
    }
    return out;
  }

  const pathOf = points => points.map((p, i) => `${i ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`).join(' ');

  function box(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  /* The build's arrow head (spec 6.4: at the end point, growing with the width; ShapeGeometry.ArrowHead): two wings of
     4 times the width and at least 12 px, 28 degrees each side. */
  function arrowHead(start, end, width) {
    const length = Math.max(12, width * 4);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const spread = 28 * Math.PI / 180;
    return [
      P(end.x - length * Math.cos(angle - spread), end.y - length * Math.sin(angle - spread)),
      P(end.x - length * Math.cos(angle + spread), end.y - length * Math.sin(angle + spread)),
    ];
  }

  /* ---------- The stand-in screen ---------- */

  /* 640 by 400 units: a neutral window with a menu bar, a side pane, a heading and lines of text, a panel and a button.
     Grey shapes only, so that it never reads as a screenshot. The places a demonstration points at. */
  const LAYOUT = {
    bar: { x: 0, y: 0, w: 640, h: 36 },
    menus: [{ x: 16, y: 12, w: 36, h: 12 }, { x: 64, y: 12, w: 36, h: 12 }, { x: 112, y: 12, w: 44, h: 12 }],
    side: { x: 0, y: 36, w: 150, h: 364 },
    sideLines: [60, 84, 108, 132, 156].map(y => ({ x: 18, y, w: 100, h: 10 })),
    heading: { x: 182, y: 61, w: 236, h: 14 },
    lines: [[86, 380], [108, 260], [130, 340], [152, 200]].map(([y, w]) => ({ x: 182, y, w, h: 10 })),
    panel: { x: 182, y: 190, w: 290, h: 130 },
    button: { x: 500, y: 318, w: 112, h: 36 },
    dropdown: { x: 16, y: 36, w: 150, h: 120 },
    dropdownItems: [48, 72, 96, 120].map(y => ({ x: 30, y, w: 90, h: 10 })),
  };

  /* The stand-in as one list of shapes in painting order, so that the demonstrations (SVG, blocks) and the sandbox
     (a canvas, paintStandIn) paint the same screen. A shape of class sc-NAME is filled with the colour token
     --screen-NAME of styles.css: by the stylesheet in an SVG, and read from it on a canvas. Lines of text are words,
     and the panel carries small print, so that the lens has something to enlarge. */
  const shape = (cls, b, r = 0, name = '') => ({ cls, b, r, name });
  const grow = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
  const WORD_WIDTHS = [46, 30, 64, 38, 26, 54, 34, 70, 42, 28];

  function words(b, cls, size = 1) {
    const out = [];
    const end = b.x + b.w, gap = 6 * size;
    for (let x = b.x, i = b.y % WORD_WIDTHS.length; x < end; i++) {
      let w = WORD_WIDTHS[i % WORD_WIDTHS.length] * size;
      if (end - (x + w + gap) < 18 * size) w = end - x;
      out.push(shape(cls, { x, y: b.y, w, h: b.h }, b.h / 2));
      x += w + gap;
    }
    return out;
  }

  const SHAPES = standInShapes();

  function standInShapes() {
    const { panel: p, button: b } = LAYOUT;
    const inPanel = (dx, dy, w, h) => ({ x: p.x + dx, y: p.y + dy, w, h });
    return [
      shape('sc-bg', { x: 0, y: 0, w: 640, h: 400 }),
      shape('sc-side', LAYOUT.side),
      shape('sc-bar', LAYOUT.bar),
      shape('sc-edge', { x: 0, y: 36, w: 640, h: 1 }),
      shape('sc-edge', { x: 150, y: 37, w: 1, h: 363 }),
      ...LAYOUT.menus.map(m => shape('sc-block', m, 3)),
      ...LAYOUT.sideLines.flatMap((s, i) => [
        shape('sc-block', { x: s.x, y: s.y, w: 10, h: s.h }, 3),
        shape('sc-line', { x: s.x + 16, y: s.y, w: [70, 52, 80, 60, 44][i], h: s.h }, s.h / 2)]),
      shape('sc-block', LAYOUT.heading, 7),
      ...LAYOUT.lines.flatMap(l => words(l, 'sc-line')),
      shape('sc-edge', grow(p, 1), 9),
      shape('sc-panel', p, 8),
      shape('sc-block', inPanel(18, 16, 120, 10), 5),
      ...[[36, 250], [50, 218]].flatMap(([dy, w]) => words(inPanel(18, dy, w, 8), 'sc-line')),
      ...[[68, 236], [74, 252], [80, 180]].flatMap(([dy, w]) => words(inPanel(18, dy, w, 3), 'sc-line', 0.5)),
      shape('sc-line', inPanel(18, 100, 58, 16), 8),
      shape('sc-line', inPanel(82, 100, 46, 16), 8),
      shape('sc-shade', { x: b.x, y: b.y + 1.5, w: b.w, h: b.h }, 6),
      shape('sc-button', b, 6, 'button'),
      shape('sc-button-label', { x: b.x + 26, y: b.y + 15, w: 60, h: 6 }, 3),
    ];
  }

  /* The stand-in application's first menu, open. */
  const DROPDOWN = [
    shape('sc-edge', grow(LAYOUT.dropdown, 1), 7),
    shape('sc-dropdown', LAYOUT.dropdown, 6),
    ...LAYOUT.dropdownItems.map((b, i) => shape('sc-line', { x: b.x, y: b.y, w: [64, 82, 90, 56][i], h: b.h }, b.h / 2)),
  ];

  const rect = (b, cls, extra) => svg('rect', Object.assign({ x: b.x, y: b.y, width: b.w, height: b.h, class: cls }, extra));
  const shapeNode = s => rect(s.b, s.cls, s.r ? { rx: s.r } : null);

  /* The stand-in as SVG nodes, and the button a demonstration presses. */
  function blocks() {
    const nodes = SHAPES.map(shapeNode);
    return { nodes, button: nodes[SHAPES.findIndex(s => s.name === 'button')] };
  }

  /* The stand-in on a canvas of 640 by 400 units, in the colours of the current scheme. With label, the picture says
     what it is, as the label on the stage does. */
  function paintStandIn(c, label) {
    const style = getComputedStyle(document.documentElement);
    const token = name => style.getPropertyValue(name).trim();
    const fillBox = (b, r) => {
      c.beginPath();
      if (r && c.roundRect) c.roundRect(b.x, b.y, b.w, b.h, r); else c.rect(b.x, b.y, b.w, b.h);
      c.fill();
    };
    const fills = new Map();
    for (const s of SHAPES) {
      if (!fills.has(s.cls)) fills.set(s.cls, token(`--screen-${s.cls.slice(3)}`));
      c.fillStyle = fills.get(s.cls);
      fillBox(s.b, s.r);
    }
    if (!label) return;
    const text = 'Demonstration';
    c.font = '600 13px system-ui, "Segoe UI", sans-serif';
    c.fillStyle = token('--demo-label-bg');
    fillBox({ x: 10, y: 10, w: c.measureText(text).width + 16, h: 22 }, 4);
    c.fillStyle = token('--demo-label-text');
    c.textBaseline = 'middle';
    c.fillText(text, 18, 21);
  }

  function screen(root, id) {
    const defs = svg('defs');
    const content = svg('g', { id: `sc-${id}` });
    const parts = blocks();
    const blockLayer = svg('g', { class: 'sc' }, ...parts.nodes);
    const marks = svg('g', { class: 'marks' });
    const overlay = svg('g', { class: 'overlay' });
    content.append(blockLayer, marks);
    root.append(defs, content, overlay);
    let menu = null;
    return {
      svg: root, defs, content, blockLayer, marks, overlay, id,
      button: parts.button,
      /* The stand-in application opens its first menu: a dropdown under it. */
      openMenu() {
        if (menu) return;
        menu = svg('g', null, ...DROPDOWN.map(shapeNode));
        blockLayer.append(menu);
      },
      closeMenu() { if (menu) menu.remove(); menu = null; },
    };
  }

  /* Two stand-in monitors of the same pixel size, the right one at 150 percent scaling, so its window is larger. */
  function monitors(root, id) {
    const defs = svg('defs');
    const A = { x: 0, y: 70, w: 300, h: 188 }, B = { x: 340, y: 70, w: 300, h: 188 };
    defs.append(svg('clipPath', { id: `mon-${id}` }, rect(A, ''), rect(B, '')));
    const content = svg('g', { id: `sc-${id}` });
    const frame = m => rect({ x: m.x - 6, y: m.y - 6, w: m.w + 12, h: m.h + 12 }, 'mon-frame', { rx: 10 });
    const monitor = (m, scale) => {
      const clipId = `mon-${id}-${m.x}`;
      defs.append(svg('clipPath', { id: clipId }, rect(m, '')));
      const inner = svg('g', { transform: `translate(${m.x} ${m.y}) scale(${(m.w / 640) * scale})` }, ...blocks().nodes);
      return svg('g', { 'clip-path': `url(#${clipId})` }, inner);
    };
    const marks = svg('g', { class: 'marks', 'clip-path': `url(#mon-${id})` });
    content.append(frame(A), frame(B), monitor(A, 1), monitor(B, 1.5), marks);
    const overlay = svg('g', { class: 'overlay' });
    root.append(defs, content, overlay);
    return { svg: root, defs, content, marks, overlay, id, A, B };
  }

  /* ---------- The stage of a demonstration ---------- */

  const START_LINE = 'Plays when it comes into view.';

  /* The frame of one demonstration: a figure with the stage (the SVG of the stand-in screen and the "Demonstration"
     label), the state line, the controls and a live region. The contract above the demonstrations says what h
     carries; h.frame is the frame's own and no demonstration reads it. */
  function stage(card, mount, opts) {
    const root = svg('svg', { viewBox: '0 0 640 400', role: 'img', 'aria-label': opts.alt, focusable: 'false' });
    const stageBox = el('div', { class: 'demo-stage' }, root, el('span', { class: 'demo-label', text: opts.label || 'Demonstration' }));
    const line = el('span', { class: 'demo-state-line', text: START_LINE });
    const fits = el('span', { class: 'demo-state-fits', 'aria-hidden': 'true' });
    const state = el('p', { class: 'demo-state' }, line, fits);
    const controls = el('div', { class: 'demo-controls' });
    const live = el('div', { class: 'demo-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    mount.append(el('figure', { class: 'demo' }, stageBox, state, controls, live));
    const h = { card, box: stageBox, svg: root, state, controls, extras: [], at: P(320, 200), run: null };
    h.frame = { line, fits, live, lines: null, ended: '', played: false };
    h.say = (...parts) => say(h, parts);
    h.end = (text, alt = text) => end(h, text, alt);
    return h;
  }

  /* The parts of a line: strings, and { key: 'Escape' } for a key. */
  const nodesOf = parts => parts.map(part => (typeof part === 'string' ? part : el('kbd', { text: part.key })));
  const textOf = parts => parts.map(part => (typeof part === 'string' ? part : part.key)).join('');

  /* A line in the state line. During a play it is shown and not announced: the live region says only that a play
     starts and how it ends. Outside a play only a control says something, so then the line is announced too. In the
     rehearsal of a play the line is only kept. */
  function say(h, parts) {
    if (h.frame.lines) { h.frame.lines.push(parts); return; }
    h.frame.line.replaceChildren(...nodesOf(parts));
    if (!h.run) speak(h, textOf(parts));
  }

  /* The end line. It is shown, and alt becomes the text alternative of the stand-in screen. */
  function end(h, text, alt) {
    if (h.frame.lines) { h.frame.lines.push([text]); return; }
    h.frame.line.replaceChildren(text);
    h.svg.setAttribute('aria-label', alt);
    h.frame.ended = text;
    if (!h.run) speak(h, text);
  }

  /* The live region is polite: a screen reader says it when the visitor pauses, without moving focus (WCAG 4.1.3).
     It keeps a message long enough to be spoken, then empties, so that browse mode does not read the end line a
     second time after the state line. */
  const LIVE_CLEAR_MS = 10000;

  function speak(h, text) {
    clearTimeout(h.frame.hush);
    h.frame.live.textContent = text;
    if (text) h.frame.hush = setTimeout(() => { h.frame.live.textContent = ''; }, LIVE_CLEAR_MS);
  }

  /* Things a play adds outside the document: the laser, the halo, the lens, popups, the dim. Reset removes them. */
  function extra(h, node) { h.extras.push(node); return node; }
  function clearExtras(h) { for (const node of h.extras) node.remove(); h.extras = []; }

  /* ---------- The pointer ---------- */

  const POINTER = 'M0 0 L0 17 L4.6 13.2 L7.6 19.6 L10.3 18.4 L7.4 12 L12.6 12 Z';

  /* The pointer is drawn a quarter larger than the arrow at 100 percent scaling, so that it reads at card size: the
     stand-in is not to scale. Its tip is the point it stands at. */
  const POINTER_SCALE = 1.25;

  function addPointer(h, at) {
    h.pointer = svg('g', { class: 'pointer' }, svg('path', { d: POINTER, transform: `scale(${POINTER_SCALE})` }));
    h.sc.overlay.append(h.pointer);
    movePointer(h, at);
  }

  function movePointer(h, p) {
    h.at = p;
    h.pointer.setAttribute('transform', `translate(${round(p.x)} ${round(p.y)})`);
    if (h.halo) attr(h.halo, { cx: p.x, cy: p.y });
    if (h.lens && !h.lensLocked) h.lens.set(p.x, p.y, h.zoom);
  }

  function glide(run, h, to, ms = 500) {
    const from = h.at;
    return run.tween(ms, t => movePointer(h, P(lerp(from.x, to.x, t), lerp(from.y, to.y, t))));
  }

  /* Puts a node under the pointer, so the pointer stays on top. */
  function underPointer(h, node) {
    h.sc.overlay.insertBefore(node, h.pointer);
    return node;
  }

  /* ---------- The document of a demonstration: items, undo, redo, clear (spec 5.2) ---------- */

  class Doc {
    constructor(layer) { this.layer = layer; this.done = []; this.undone = []; }

    exec(command) { command.redo(); this.done.push(command); this.undone = []; }

    /* Each command names the items it touches, as the build's commands do, so that expiry can find it. */
    add(node) {
      this.exec({ nodes: [node], redo: () => this.layer.append(node), undo: () => node.remove() });
      return node;
    }

    clear() {
      const nodes = [...this.layer.children];
      if (nodes.length === 0) return false;
      this.exec({ nodes, redo: () => nodes.forEach(n => n.remove()), undo: () => nodes.forEach(n => this.layer.append(n)) });
      return true;
    }

    undo() { const c = this.done.pop(); if (!c) return false; c.undo(); this.undone.push(c); return true; }

    redo() { const c = this.undone.pop(); if (!c) return false; c.redo(); this.done.push(c); return true; }

    /* Fade expiry: the item leaves the page, and every command that references it leaves both stacks, a clear that
       took it included, so that undo and redo never bring expired ink back (spec 5.2). */
    purge(node) {
      node.remove();
      const keep = c => !c.nodes.includes(node);
      this.done = this.done.filter(keep);
      this.undone = this.undone.filter(keep);
    }

    reset() { this.layer.replaceChildren(); this.done = []; this.undone = []; }

    get count() { return this.layer.children.length; }
  }

  /* ---------- Marks ---------- */

  /* The stroke of a mark. o: width (the pen's 4 by default), colour, highlighter (3 times the width, 35 percent, flat
     caps: spec 6.2), cls (a class that colours it instead, such as ai-ink), dashed (an AI's marks: brand.md, section 7). */
  function inkAttrs(o) {
    const width = o.width || PEN_WIDTH;
    const a = { fill: 'none', 'stroke-width': o.highlighter ? width * HIGHLIGHTER_FACTOR : width, 'stroke-linecap': o.highlighter ? 'butt' : 'round', 'stroke-linejoin': 'round' };
    if (o.cls) a.class = o.cls; else a.stroke = o.colour || (o.highlighter ? INK.highlighter : INK.pen);
    if (o.highlighter) a.opacity = HIGHLIGHTER_OPACITY;
    if (o.dashed) a['stroke-dasharray'] = `${width * 2.5} ${width * 2}`;
    return a;
  }

  /* A freehand stroke: raw points while the pointer moves, smoothed on release (spec 5.3). */
  async function drawStroke(run, h, points, o = {}) {
    const doc = o.doc || h.doc;
    const path = svg('path', inkAttrs(o));
    const n = points.length;
    await glide(run, h, points[0], o.approach || 300);
    doc.add(path);
    await run.tween(o.ms || 800, t => {
      const k = Math.max(1, Math.round(t * (n - 1)));
      const seen = points.slice(0, k + 1);
      path.setAttribute('d', pathOf(t < 1 ? seen : smooth(points)));
      movePointer(h, seen[seen.length - 1]);
    });
    return path;
  }

  /* A line, arrow, rectangle or ellipse dragged from one point to another, with a live preview; the arrow's head at the
     end point, as the build computes it (spec 6.4, arrowHead). */
  async function drawShape(run, h, kind, from, to, o = {}) {
    const doc = o.doc || h.doc;
    const width = o.width || PEN_WIDTH;
    const a = inkAttrs(o);
    let node, update;
    if (kind === 'line') {
      node = svg('line', a);
      update = p => attr(node, { x1: from.x, y1: from.y, x2: p.x, y2: p.y });
    } else if (kind === 'arrow') {
      const shaft = svg('line', a), left = svg('line', a), right = svg('line', a);
      node = svg('g', null, shaft, left, right);
      update = p => {
        attr(shaft, { x1: from.x, y1: from.y, x2: p.x, y2: p.y });
        const [l, r] = arrowHead(from, p, width);
        attr(left, { x1: p.x, y1: p.y, x2: l.x, y2: l.y });
        attr(right, { x1: p.x, y1: p.y, x2: r.x, y2: r.y });
      };
    } else if (kind === 'rectangle') {
      node = svg('rect', a);
      update = p => { const b = box(from, p); attr(node, { x: b.x, y: b.y, width: b.w, height: b.h }); };
    } else {
      node = svg('ellipse', a);
      update = p => { const b = box(from, p); attr(node, { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 }); };
    }
    await glide(run, h, from, o.approach || 300);
    update(from);
    doc.add(node);
    await run.tween(o.ms || 600, t => { const p = P(lerp(from.x, to.x, t), lerp(from.y, to.y, t)); update(p); movePointer(h, p); });
    /* An AI's click: a small open ring at the click point (brand.md, section 7). */
    if (o.ring) doc.add(svg('circle', { cx: to.x, cy: to.y, r: 7, class: 'ai-ring' }));
    return node;
  }

  /* Text typed at a point, its top-left at the click, in the pen colour, Segoe UI 24 px (spec 6.4, 7.1). */
  async function drawText(run, h, at, str, o = {}) {
    const doc = o.doc || h.doc;
    const node = svg('text', { x: at.x, y: at.y, class: 'sc-text', fill: o.colour || INK.pen, 'font-size': o.size || TEXT_SIZE });
    await glide(run, h, at, 300);
    doc.add(node);
    await run.tween(o.ms || 700, t => { node.textContent = str.slice(0, Math.round(t * str.length)); }, linear);
    return node;
  }

  /* The laser (spec 6.6): a red dot at the pointer, a trail whose segments narrow and fade over 1.5 s, no ink. As in the
     build, a segment ages from the moment the pointer was at its start, and a point is added only when the pointer
     moves. Each segment is drawn once; a frame only changes the width and opacity of the ones still fading. */
  async function laser(run, h, points, ms) {
    const g = extra(h, underPointer(h, svg('g', { class: 'laser' })));
    const trail = svg('g', { stroke: INK.laser, 'stroke-linecap': 'round' });
    const dot = svg('circle', { r: LASER.dot / 2, fill: INK.laser });
    g.append(trail, dot);
    h.pointer.setAttribute('visibility', 'hidden');
    const segments = [];
    let last = null;
    const age = now => {
      while (segments.length && now - segments[0].t >= LASER.trailMs) segments.shift().line.remove();
      for (const s of segments) {
        const strength = 1 - (now - s.t) / LASER.trailMs;
        attr(s.line, { 'stroke-width': round(LASER.trail * (0.3 + 0.7 * strength)), opacity: round(strength) });
      }
    };
    const n = points.length;
    await run.tween(ms, t => {
      const p = points[Math.round(t * (n - 1))];
      const now = performance.now();
      if (!last || p.x !== last.x || p.y !== last.y) {
        if (last) {
          const line = svg('line', { x1: round(last.x), y1: round(last.y), x2: round(p.x), y2: round(p.y) });
          trail.append(line);
          segments.push({ line, t: last.t });
        }
        last = { x: p.x, y: p.y, t: now };
      }
      attr(dot, { cx: round(p.x), cy: round(p.y) });
      h.at = p;
      age(now);
    });
    await run.tween(LASER.trailMs + 50, () => age(performance.now()), linear);
    return g;
  }

  /* The halo (spec 6.6): a filled circle around the pointer, 40 px, yellow, 40 percent, in every mode. */
  function addHalo(h) {
    h.halo = extra(h, underPointer(h, svg('circle', { r: HALO.diameter / 2, fill: INK.halo, opacity: HALO.opacity, class: 'halo' })));
    attr(h.halo, { cx: h.at.x, cy: h.at.y });
  }

  /* The magnifier lens (spec 6.7): a rounded square that shows the screen under the pointer enlarged. */
  function addLens(h) {
    const id = `lens-${h.sc.id}`;
    const clipRect = svg('rect', { width: LENS.size, height: LENS.size, rx: LENS.radius });
    const clip = svg('clipPath', { id }, clipRect);
    h.sc.defs.append(clip);
    const use = svg('use', { href: `#sc-${h.sc.id}` });
    const frame = svg('rect', { width: LENS.size, height: LENS.size, rx: LENS.radius, class: 'lens-frame' });
    const g = svg('g', { class: 'lens' }, svg('g', { 'clip-path': `url(#${id})` }, use), frame);
    extra(h, g);
    extra(h, clip);
    underPointer(h, g);
    h.zoom = LENS.start;
    h.lensLocked = false;
    h.lens = {
      set(cx, cy, zoom) {
        const x = round(cx - LENS.size / 2), y = round(cy - LENS.size / 2);
        attr(clipRect, { x, y });
        attr(frame, { x, y });
        use.setAttribute('transform', `translate(${round(cx - zoom * cx)} ${round(cy - zoom * cy)}) scale(${zoom})`);
        h.lensAt = P(cx, cy);
      },
    };
    h.lens.set(h.at.x, h.at.y, h.zoom);
  }

  /* The draw-mode glow of the toolbar: #00E5FF in both themes (spec 6.3 and 6.9), at the full strength the build gives
     it; the build's blur radius of 22 px at 36 px buttons is about 4 units at the stand-in's 20. The region fits a
     toolbar of any shape. */
  function addGlow(h) {
    if (h.glowId) return;
    h.glowId = `glow-${h.sc.id}`;
    h.sc.defs.append(svg('filter', { id: h.glowId, x: '-50%', y: '-50%', width: '200%', height: '200%' },
      svg('feDropShadow', { dx: 0, dy: 0, stdDeviation: 4, 'flood-color': '#00E5FF', 'flood-opacity': 1 })));
  }

  /* ---------- The stand-in toolbar (spec 6.9) ---------- */

  /* The build's items in its order, '|' for a separator; a separator belongs to the group after it. */
  const TOOLBAR_ITEMS = ['main', '|', 'mode', '|', 'pen', 'highlighter', 'eraser', '|', 'line', 'arrow', 'rectangle', 'ellipse', 'text', '|',
    'laser', 'magnifier', 'halo', '|', 'colour', 'width', '|', 'fade', 'undo', 'redo', 'clear', 'clearmenu', '|', 'board', 'capture', '|', 'menu'];
  /* One size in every demonstration, in stand-in units. A button is the 20-unit grid of its glyph (brand.md, 6.5) with
     a gap of 2, as the build's 36 px buttons have; a separator's cell is 7, the clear menu's arrow half a button. The
     toolbar spans most of the stand-in's width, more than the build's does on a real screen, so that its glyphs read at
     card size: the stand-in is not to scale. Like the build's, its tools wrap into a second row or column when they do
     not fit the screen, the main icon kept apart, and it is clamped onto the screen (spec 6.9). */
  const TB = { button: 20, gap: 2, sep: 7, narrow: 10, pad: 2, margin: 4, reserve: 44 };
  const CELL = TB.button + TB.gap;

  /* Glyphs on a 20-unit grid with a 16-unit live area, 2-unit strokes, round caps and joins, monochrome (brand.md,
     6.5). Drawn for the site: the build's icons are a Windows font. */
  const GLYPHS = {
    pen: 'M3.5 16.5 L4.5 12.5 L13 4 L16 7 L7.5 15.5 Z M11 6 L14 9',
    highlighter: 'M7 10.5 L13 4.5 L16 7.5 L10 13.5 Z M7 10.5 L5.5 14.5 L6 15 L10 13.5 M3.5 17 L16.5 17',
    eraser: 'M3.5 12.5 L10.5 5.5 L16.5 11.5 L11.5 16.5 L7.5 16.5 Z M7 9 L13 15 M7.5 16.5 L16.5 16.5',
    line: 'M3.5 16.5 L16.5 3.5',
    arrow: 'M3.5 16.5 L16.5 3.5 M9 3.5 L16.5 3.5 L16.5 11',
    rectangle: 'M3.5 4.5 L16.5 4.5 L16.5 15.5 L3.5 15.5 Z',
    ellipse: 'M17 10 A7 5.5 0 1 1 3 10 A7 5.5 0 1 1 17 10',
    text: 'M4.5 4 L15.5 4 M10 4 L10 16 M7.5 16 L12.5 16',
    magnifier: 'M12.5 12.5 L16.5 16.5 M14 8.5 A5.5 5.5 0 1 1 3 8.5 A5.5 5.5 0 1 1 14 8.5',
    fade: 'M16 11 A6 6 0 1 1 4 11 A6 6 0 1 1 16 11 M10 8 L10 11 L12.5 12.5 M8 3 L12 3 M10 3 L10 5',
    undo: 'M3.5 9.5 L3.5 4.5 M3.5 9.5 L8.5 9.5 M3.5 9.5 C5.5 6, 9 4.5, 12 5.5 C16 7, 17 12.5, 13.5 15.2 C11.5 16.8, 8.5 16.8, 6.5 15.5',
    redo: 'M16.5 9.5 L16.5 4.5 M16.5 9.5 L11.5 9.5 M16.5 9.5 C14.5 6, 11 4.5, 8 5.5 C4 7, 3 12.5, 6.5 15.2 C8.5 16.8, 11.5 16.8, 13.5 15.5',
    clear: 'M3.5 5.5 L16.5 5.5 M7.5 5.5 L7.5 3.5 L12.5 3.5 L12.5 5.5 M5.5 5.5 L6.5 16.5 L13.5 16.5 L14.5 5.5 M8.5 8.5 L8.5 13.5 M11.5 8.5 L11.5 13.5',
    clearmenu: 'M2.5 8.5 L5 11 L7.5 8.5',
    board: 'M3.5 4 L16.5 4 L16.5 13 L3.5 13 Z M10 13 L10 16.5 M6.5 16.5 L13.5 16.5',
    capture: 'M3.5 7 L7 7 L8.5 4.5 L11.5 4.5 L13 7 L16.5 7 L16.5 15.5 L3.5 15.5 Z M12.75 11 A2.75 2.75 0 1 1 7.25 11 A2.75 2.75 0 1 1 12.75 11',
    menu: 'M3.5 5.5 L16.5 5.5 M3.5 10 L16.5 10 M3.5 14.5 L16.5 14.5',
  };

  function glyph(id, state) {
    const g = svg('g', { class: 'tb-glyph' });
    switch (id) {
      case 'main':
        /* The brand's 16 px mark (brand.md, 6.4) in one colour: a disc with a short arc that ends in a dot. */
        g.append(svg('circle', { cx: 10, cy: 10, r: 8, class: 'tb-main-disc' }),
          svg('path', { d: 'M6.5 12.5 C6.5 8.5, 10.5 6, 12.5 8 C13.8 9.4, 13.8 11, 13.5 12.2', class: 'tb-main-arc' }),
          svg('circle', { cx: 13.5, cy: 12.5, r: 1.8, class: 'tb-main-dot' }));
        break;
      case 'mode':
        g.append(svg('path', { d: POINTER, class: 'tb-fill', transform: 'translate(5 1.5) scale(0.85)' }));
        break;
      case 'laser':
        g.append(svg('circle', { cx: 10, cy: 10, r: 5, fill: INK.laser }));
        break;
      case 'halo':
        g.append(svg('circle', { cx: 10, cy: 10, r: 6.5, fill: 'none', stroke: INK.halo, 'stroke-width': 3 }));
        break;
      case 'colour':
        g.append(svg('circle', { cx: 10, cy: 10, r: 7, fill: state.colour }), svg('circle', { cx: 10, cy: 10, r: 7, class: 'tb-ring' }));
        break;
      case 'width':
        g.append(svg('circle', { cx: 10, cy: 10, r: Math.min(19, Math.max(3, 3 + state.width * 0.4)) / 2, class: 'tb-fill' }));
        break;
      default:
        g.append(svg('path', { d: GLYPHS[id], class: 'tb-stroke' }));
    }
    return g;
  }

  /* The length of an item along the toolbar, its gap included. */
  const cellLength = id => (id === '|' ? TB.sep : id === 'clearmenu' ? TB.narrow + TB.gap : CELL);

  /* Lines of tools: a new line starts when the next item would pass the screen's edge, as in the build's tools panel,
     which may be as long as the monitor less room for the main icon, the padding and a margin. */
  function toolLines(state) {
    if (state.collapsed) return [];
    const limit = (state.vertical ? 400 : 640) - TB.reserve;
    const lines = [[]];
    let used = 0;
    for (const id of TOOLBAR_ITEMS.slice(1)) {
      const line = lines[lines.length - 1];
      if (line.length && used + cellLength(id) > limit) { lines.push([id]); used = cellLength(id); continue; }
      line.push(id);
      used += cellLength(id);
    }
    return lines;
  }

  /* state: x and y (the top centre the toolbar asks for), vertical, collapsed, hidden, theme ('light', 'dark', 'auto'),
     draw (draw mode: the glow, and the mode button on), active (the active tool's id), on ({ id: true } for an accent
     glyph, { id: 'tint' } for a tinted button, as the halo has when it is on), colour and width (shown on their buttons). */
  function toolbar(h, opts) {
    addGlow(h);
    const g = svg('g', { class: 'tb tb-auto' });
    h.sc.overlay.append(g);
    const state = Object.assign({ x: 320, y: 6, vertical: false, collapsed: false, hidden: false, theme: 'auto', active: null, draw: false, colour: INK.pen, width: PEN_WIDTH, on: {} }, opts);
    const centres = new Map();
    let box = { x: 0, y: 0, w: 0, h: 0 };

    /* A button: the build's tint when it is on, an outline in the accent with it, and the glyph. */
    function addButton(id, x, y, w, hgt) {
      const tint = state.active === id || state.on[id] === 'tint' ? 'tb-active' : id === 'mode' && state.draw ? 'tb-mode-on' : '';
      if (tint) g.append(svg('rect', { x, y, width: w, height: hgt, rx: 5, class: tint }), svg('rect', { x: x + 0.75, y: y + 0.75, width: w - 1.5, height: hgt - 1.5, rx: 4.25, class: 'tb-edge' }));
      const node = glyph(id, state);
      node.setAttribute('transform', `translate(${x + (w - (id === 'clearmenu' ? TB.narrow : TB.button)) / 2} ${y + (hgt - TB.button) / 2})`);
      if (state.on[id] === true || (id === 'mode' && state.draw)) node.classList.add('tb-accent');
      g.append(node);
      centres.set(id, P(x + w / 2, y + hgt / 2));
    }

    function render() {
      g.replaceChildren();
      centres.clear();
      g.setAttribute('class', `tb tb-${state.theme}`);
      if (state.hidden) { g.setAttribute('display', 'none'); return; }
      g.removeAttribute('display');
      const lines = toolLines(state);
      const v = state.vertical;
      /* Along the toolbar, then across: the main icon, then each line of tools; positions inside the shell. */
      const longest = Math.max(0, ...lines.map(line => line.reduce((sum, id) => sum + cellLength(id), 0)));
      const across = TB.pad * 2 + CELL * Math.max(1, lines.length);
      const along = TB.pad * 2 + CELL + longest;
      const w = v ? across : along, hgt = v ? along : across;
      g.append(svg('rect', { class: 'tb-shell', width: w, height: hgt, rx: 7, filter: state.draw ? `url(#${h.glowId})` : null }));
      const at = (a, c) => (v ? [c, a] : [a, c]);
      const [mx, my] = at(TB.pad + TB.gap / 2, (across - TB.button) / 2);
      addButton('main', mx, my, TB.button, TB.button);
      lines.forEach((line, n) => {
        let a = TB.pad + CELL;
        const c = TB.pad + n * CELL;
        for (const id of line) {
          const length = cellLength(id);
          if (id === '|') {
            const mid = a + TB.sep / 2, inset = 4.5;
            const [x1, y1] = at(mid, c + inset), [x2, y2] = at(mid, c + CELL - inset);
            g.append(svg('line', { class: 'tb-sep', x1, y1, x2, y2 }));
          } else {
            const [x, y] = at(a + TB.gap / 2, c + TB.gap / 2);
            const [bw, bh] = at(length - TB.gap, TB.button);
            addButton(id, x, y, bw, bh);
          }
          a += length;
        }
      });
      /* Clamped onto the screen, as the build clamps its toolbar onto the monitor (spec 6.9). */
      box = {
        x: Math.max(TB.margin, Math.min(640 - TB.margin - w, state.x - w / 2)),
        y: Math.max(TB.margin, Math.min(400 - TB.margin - hgt, state.y)),
        w, h: hgt,
      };
      g.setAttribute('transform', `translate(${round(box.x)} ${round(box.y)})`);
    }

    render();
    return {
      g, state,
      set(changes) { Object.assign(state, changes); render(); },
      /* Screen coordinates of a button's centre, for a pointer to go to. */
      centre(id) {
        const c = centres.get(id);
        return c ? P(box.x + c.x, box.y + c.y) : P(box.x + box.w / 2, box.y + box.h / 2);
      },
      bottom() { return box.y + box.h; },
    };
  }

  /* A popup of the toolbar, placed under it and kept inside the screen. */
  function popup(h, anchorX, w, hgt) {
    const x = Math.max(8, Math.min(640 - w - 8, anchorX - w / 2));
    const y = h.tb.bottom() + 6;
    const g = svg('g', { class: `tb tb-${h.tb.state.theme}` }, svg('rect', { class: 'tb-shell tb-popup', x, y, width: w, height: hgt, rx: 8 }));
    extra(h, underPointer(h, g));
    return { g, x, y, w, h: hgt };
  }

  /* ---------- The demonstrations ---------- */

  /* The contract between the frame and a demonstration.

     A demonstration is an object { build, reset, play } in DEMOS, under the name in its card's data-demo.

     build(card, mount) runs once, at load. It calls stage(card, mount, { alt, label }) and returns the h that stage
     gives, with what the demonstration adds: the stand-in screen, the document, the toolbar, the pointer, and its own
     controls appended to h.controls. It plays nothing. From stage, h carries:
       h.card       the feature card the demonstration belongs to.
       h.svg        the stand-in screen, viewBox 0 0 640 400, role img. Its text alternative is opts.alt until a play
                    ends, then the alt of h.end.
       h.state      the state line, a p. Nothing goes in it; the capture demonstration puts its thumbnail after the controls.
       h.controls   the controls. The frame puts the play control first.
       h.say(...parts)          shows a line in the state line. Parts are strings, and { key: 'Escape' } for a key.
       h.end(text, alt = text)  shows the end line; alt becomes the text alternative of the stand-in screen.
       h.run        the run in progress, or null. Read it; never set or cancel it.
       h.box and h.frame belong to the frame, and no demonstration touches them.

     reset(h) brings the picture back to its start state, whatever a play or a control left. The frame calls it before
     every play and around every rehearsal, so it is complete, quick and safe to repeat.

     play(run, h) is async. It takes the picture from the start state to the end state, says what happens with h.say
     and ends with h.end. Every wait goes through the run: run.tween(ms, fn, ease) calls fn with the eased progress
     every frame, run.pause(ms) is rhythm between steps, and run.hold(ms) is time the build itself takes (spec 5.4).
     No setTimeout, requestAnimationFrame or listener of its own. The frame cancels a play by rejecting its pending
     waits with CANCEL, so a play lets every rejection pass: no try/catch around an await.

     An instant run (run.instant) shows the end state at once: tween calls fn(1), pause and hold resolve at once, and
     the play ends before the browser paints. The frame uses one under reduced motion, on a hidden tab, for Stop and
     stop(h), when the stage leaves the view, and for the rehearsal. A play reaches the same end state and says the
     same lines in an instant run as with motion.

     The rehearsal. At load and before each play the frame plays the demonstration as an instant run, from reset to
     its end, and resets it again; meanwhile h.say and h.end only collect the lines. The state line then keeps the
     height of the longest, so that the card does not grow while the play runs. A play thus runs at least twice for
     every time it is seen, and everything it changes, reset changes back.

     Starting and stopping. The frame starts a play once when 35 percent of its stage is in view, and on the play
     control: Play, Stop while a play moves, Play again after. It stops a play at its end state on Stop, when the
     stage leaves the view, when the tab is hidden and when reduced motion is turned on. A control of a demonstration
     that changes the picture first awaits stop(h): a play in progress jumps to its end state, so the control changes a
     known picture. It then changes the picture at once and says what it did with h.say. A control that plays the
     demonstration again calls start(h).

     The live region announces that a play with motion starts ("<card title>: the demonstration is playing.") and how
     it ends ("... has ended." or, after Stop, "... has stopped.", then the end line), then empties after 10 s. The
     lines in between are shown and not announced. What h.say or h.end says outside a play, after a control, is
     announced as it is. A stop the visitor did not ask for is silent.

     Space. Before the script runs, styles.css reserves the stage, the state line (3 lines for a stage of 30 rem and
     wider, 4 below that, 6 below 20.5 rem) and one row of controls; a demonstration with more controls, and the
     thumbnail, have their own heights there. A longer line or more controls make the card grow when it mounts, so
     measure again after changing them.

     Errors. A build, reset or play that throws takes its demonstration out: its card keeps its text, the other
     demonstrations go on, and the error is logged once. A control's handler is wrapped in guard(h, fn), so that an
     error there does the same. */

  /* A click on a button of the stand-in toolbar: the pointer goes to it, and the toolbar changes as the click changes
     it, as a tool, a popup or a setting is chosen in the build. The same approach in every demonstration. While the
     button is clicked it shows the build's hover, as press shows the stand-in application's button pressed; the hover
     sits in a group of the toolbar's theme, which gives it its colour. */
  async function click(run, h, id, changes, ms = 450) {
    const at = h.tb.centre(id);
    await glide(run, h, at, ms);
    const hover = extra(h, svg('g', { class: `tb tb-${h.tb.state.theme}` },
      svg('rect', { class: 'tb-field', x: at.x - 11, y: at.y - 11, width: 22, height: 22, rx: 5, opacity: 0.5 })));
    h.tb.g.after(hover);
    await run.pause(150);
    hover.remove();
    if (changes) h.tb.set(changes);
  }

  /* 1. Draw on the live screen (spec 6.4). Each tool is picked on the stand-in toolbar first, as in the build, where
     picking a drawing tool also turns draw mode on. */
  const drawDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration draws seven kinds of marks on it.' });
      h.sc = screen(h.svg, 'draw');
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(400, 240));
      /* A control acts on the end state: a play in progress jumps there first. */
      const act = (fn, nothing) => guard(h, async () => {
        await stop(h);
        const text = fn();
        if (!text) { h.say(nothing); return; }
        h.end(text, marksAlt(h));
      });
      const count = () => `${h.doc.count} ${h.doc.count === 1 ? 'mark' : 'marks'} on the screen.`;
      h.controls.append(
        button('Undo', act(() => h.doc.undo() && `Undo. ${count()}`, 'Nothing to undo.')),
        button('Redo', act(() => h.doc.redo() && `Redo. ${count()}`, 'Nothing to redo.')),
        button('Clear', act(() => h.doc.clear() && 'Cleared. Undo brings every mark back in one step.', 'Nothing to clear.')));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ active: null }); movePointer(h, P(400, 240)); },
    async play(run, h) {
      const tool = async (id, text) => { await click(run, h, id, { active: id }); h.say(text); };
      await tool('pen', 'Pen: a smooth stroke, 4 px, in the pen colour.');
      tagMark(await drawStroke(run, h, curve(P(190, 172), P(250, 160), P(330, 184), P(400, 170), 36, 1.2), { ms: 900 }), 'a pen stroke');
      await run.pause(300);
      await tool('highlighter', 'Highlighter: three times wider, translucent, flat ends.');
      tagMark(await drawStroke(run, h, curve(P(186, 91), P(280, 90), P(380, 92), P(470, 91), 24, 0.5), { highlighter: true, ms: 700 }), 'a highlighter stroke');
      await run.pause(300);
      /* Upright, one of the 45 degree steps that Shift gives (spec 6.4). */
      await tool('line', 'Line. Hold Shift for 45 degree steps.');
      tagMark(await drawShape(run, h, 'line', P(170, 82), P(170, 160), { ms: 500 }), 'a line');
      await run.pause(300);
      await tool('arrow', 'Arrow: the head sits at the end and grows with the width.');
      tagMark(await drawShape(run, h, 'arrow', P(430, 384), P(496, 340), { ms: 600 }), 'an arrow');
      await run.pause(300);
      await tool('rectangle', 'Rectangle. Hold Shift for a square.');
      tagMark(await drawShape(run, h, 'rectangle', P(176, 182), P(480, 328), { ms: 600 }), 'a rectangle');
      await run.pause(300);
      await tool('ellipse', 'Ellipse. Hold Shift for a circle.');
      tagMark(await drawShape(run, h, 'ellipse', P(8, 100), P(130, 126), { ms: 600 }), 'an ellipse');
      await run.pause(300);
      await tool('text', 'Text: click to type. Click the text later to edit, move or resize it.');
      tagMark(await drawText(run, h, P(500, 272), 'Click here', { ms: 700 }), 'the text Click here');
      await run.pause(400);
      await click(run, h, 'undo');
      h.say('Undo, on the toolbar, takes the text back.');
      h.doc.undo();
      await run.pause(900);
      await click(run, h, 'redo');
      h.say('Redo brings it back.');
      h.doc.redo();
      await run.pause(600);
      h.end('Seven kinds of marks on the live screen, on top of any application.', marksAlt(h));
    },
  };

  /* What a mark is, for the text alternative of the stand-in screen. */
  function tagMark(node, words) { node.setAttribute('data-kind', words); return node; }

  function marksAlt(h) {
    const kinds = [...h.sc.marks.children].map(n => n.getAttribute('data-kind')).filter(Boolean);
    if (!kinds.length) return 'A stand-in screen with no marks.';
    const list = kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
    return `A stand-in screen with ${kinds.length === 1 ? 'one mark' : `${kinds.length} marks`}: ${list}.`;
  }

  /* A click on the stand-in application's button: it shows pressed for a moment. */
  async function press(run, h) {
    h.sc.button.classList.add('sc-pressed');
    await run.pause(350);
    h.sc.button.classList.remove('sc-pressed');
  }

  /* 2. Point: laser, halo, magnifier (spec 6.6, 6.7). */
  const pointDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration shows the laser pointer, the cursor halo and the magnifier lens.' });
      h.sc = screen(h.svg, 'point');
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: false });
      addPointer(h, P(330, 200));
      return h;
    },
    reset(h) {
      h.doc.reset(); clearExtras(h);
      h.halo = null; h.lens = null; h.lensLocked = false;
      h.pointer.removeAttribute('visibility');
      h.tb.set({ draw: false, active: null, on: {} });
      movePointer(h, P(330, 200));
    },
    async play(run, h) {
      /* The laser button switches to draw mode; over the screen the laser hides the pointer (spec 6.4, 6.6). */
      h.say('The laser button: draw mode, and the laser.');
      await click(run, h, 'laser', { draw: true, active: 'laser' });
      h.say('Laser: a red dot that hides the pointer, with a trail that fades in 1.5 s. It leaves no ink.');
      /* The laser draws over the screen, not over the toolbar: it starts just below it. */
      await glide(run, h, P(h.at.x, h.tb.bottom() + 10), 200);
      const from = h.at;
      const beam = await laser(run, h, curve(from, P(from.x - 40, 200), P(200, 330), P(470, 220), 60), 2200);
      await run.pause(300);
      /* Leaving draw mode drops the laser and brings the pointer back (spec 6.3, 6.6). */
      h.say('Press ', { key: 'Escape' }, ': cursor mode. The dot is gone, the pointer is back, and nothing is left on the screen.');
      beam.remove();
      h.pointer.removeAttribute('visibility');
      h.tb.set({ draw: false, active: null });
      await run.pause(700);
      /* The halo is a toggle and shows in every mode (spec 6.6). */
      h.say('The halo button: a yellow circle of 40 px around the pointer, in cursor mode as in draw mode. A recording shows it.');
      await click(run, h, 'halo', { on: { halo: 'tint' } });
      addHalo(h);
      await glide(run, h, P(540, 300), 1000);
      await run.pause(400);
      /* The lens opens at 2x on the next pointer movement in draw mode and leaves the halo out (spec 6.7). */
      h.say('The magnifier button: a lens over the pointer at 2x. It shows the screen without the halo.');
      await click(run, h, 'magnifier', { draw: true, active: 'magnifier', on: { halo: 'tint' } }, 700);
      await glide(run, h, P(h.at.x, 130), 250);
      addLens(h);
      await glide(run, h, P(330, 236), 900);
      await run.pause(300);
      /* 1.5x to 8x in steps of 0.5x (spec 6.7, 7.1). */
      h.say('The wheel zooms from 1.5x to 8x in steps of 0.5x. Here: 4x.');
      await run.tween(500, t => { h.zoom = LENS.start + Math.round(t * 4) * 0.5; h.lens.set(h.at.x, h.at.y, h.zoom); }, linear);
      await run.pause(600);
      h.say('Click: the lens stays where it is and shows that spot live, while the pointer moves on.');
      h.lensLocked = true;
      await glide(run, h, P(560, 120), 900);
      await run.pause(300);
      h.end('The laser left no ink. The halo is on, and the lens is locked at 4x until a click lets it go.',
        'A stand-in screen. The halo is on around the pointer, and a magnifier lens is locked at 4x over the lines of text. The laser left no ink.');
    },
  };

  /* The fade popup's choices and their durations (spec 5.4, 6.9 item 8). */
  const FADE_CHOICES = [['Off', 0], ['Short', 3], ['Medium', 8], ['Long', 20]];

  /* 3. Fading ink (spec 5.4). */
  const fadeDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration draws an arrow, then a circle with fading ink that goes after 3, 8 or 20 seconds.' });
      h.sc = screen(h.svg, 'fade');
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(420, 250));
      const name = 'fade-choice';
      h.choice = () => Number(h.card.querySelector(`input[name="${name}"]:checked`).value);
      const radios = [3, 8, 20].map((s, i) => el('label', { class: 'radio' },
        el('input', Object.assign({ type: 'radio', name, value: s }, i === 0 ? { checked: '' } : {})), ` ${s} s`));
      const set = el('fieldset', { class: 'control-group' }, el('legend', { class: 'control-label', text: 'Fades after' }), ...radios);
      set.addEventListener('change', guard(h, () => start(h)));
      h.controls.append(set);
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ active: null, on: {} }); movePointer(h, P(372, 250)); },
    async play(run, h) {
      const seconds = h.choice();
      const [name] = FADE_CHOICES.find(([, s]) => s === seconds);
      h.say('Fading ink is off. An arrow points at the button, and it stays.');
      await click(run, h, 'arrow', { active: 'arrow' });
      await drawShape(run, h, 'arrow', P(372, 250), P(474, 314), { ms: 600 });
      await run.pause(500);
      h.say('The fade button: Off, Short 3 s, Medium 8 s, Long 20 s.');
      await click(run, h, 'fade');
      const pop = fadePopup(h, name);
      await glide(run, h, pop.at, 500);
      await run.pause(250);
      pop.choose();
      await run.pause(350);
      pop.g.remove();
      h.tb.set({ on: { fade: true } });
      /* A new mark takes the fade that is on when it is drawn; marks drawn before keep theirs (spec 5.4). */
      h.say(`${name}: marks drawn from now on fade after ${seconds} s. The arrow keeps its own setting.`);
      await click(run, h, 'ellipse', { active: 'ellipse' });
      const node = await drawShape(run, h, 'ellipse', P(488, 306), P(624, 366), { ms: 800 });
      await glide(run, h, P(430, 230), 400);
      for (let left = seconds; left > 0; left--) {
        h.say(`The circle round the button fades after ${seconds} s: gone in ${left} s.`);
        await run.hold(1000);
      }
      h.say('Fading out, 600 ms.');
      await run.tween(FADE_OUT_MS, t => node.setAttribute('opacity', round(1 - t)), linear);
      h.doc.purge(node);
      h.end(`The circle round the button went after ${seconds} s, and undo does not bring it back. The arrow, drawn before fading ink was on, stays.`,
        `A stand-in screen. An arrow points at a button. The circle that went round the button has faded after ${seconds} s.`);
    },
  };

  /* The fade popup under the toolbar, with the build's four choices; choose() shows the pick as the build shows an
     active item. at: the centre of the choice to pick. */
  function fadePopup(h, name) {
    const w = 52, gap = 4, pad = 6, hgt = 20;
    const pop = popup(h, h.tb.centre('fade').x, pad * 2 + FADE_CHOICES.length * w + (FADE_CHOICES.length - 1) * gap, pad * 2 + hgt);
    let at = null, chosen = null;
    FADE_CHOICES.forEach(([label], i) => {
      const x = pop.x + pad + i * (w + gap), y = pop.y + pad;
      const item = svg('rect', { class: 'tb-textbutton', x, y, width: w, height: hgt, rx: 4 });
      pop.g.append(item, svg('text', { class: 'tb-text', x: x + w / 2, y: y + 14, 'text-anchor': 'middle', text: label }));
      if (label === name) { at = P(x + w / 2, y + hgt / 2); chosen = [x, y]; }
    });
    return {
      g: pop.g, at,
      choose() {
        const [x, y] = chosen;
        pop.g.append(svg('rect', { x, y, width: w, height: hgt, rx: 4, class: 'tb-active' }),
          svg('rect', { x: x + 0.75, y: y + 0.75, width: w - 1.5, height: hgt - 1.5, rx: 3.25, class: 'tb-edge' }));
      },
    };
  }

  /* A popup of the toolbar that lists choices, as the board and screenshot buttons open (spec 6.9, items 11 and 12):
     one row per choice, '|' for a separator. A row is a bar, as in the other popups, and the state line names the
     choices. checked: the row that carries the build's check mark. */
  const LIST = { width: 150, row: 18, sep: 9, pad: 6, inset: 12 };

  function listPopup(h, id, rows, checked = -1) {
    const height = LIST.pad * 2 + rows.reduce((sum, r) => sum + (r === '|' ? LIST.sep : LIST.row), 0);
    const pop = popup(h, h.tb.centre(id).x, LIST.width, height);
    const places = [];
    let y = pop.y + LIST.pad;
    rows.forEach((r, i) => {
      if (r === '|') {
        const mid = y + LIST.sep / 2;
        pop.g.append(svg('line', { class: 'tb-sep', x1: pop.x + 8, y1: mid, x2: pop.x + pop.w - 8, y2: mid }));
        places.push(null);
        y += LIST.sep;
        return;
      }
      pop.g.append(svg('rect', { class: 'tb-fill', x: pop.x + LIST.inset, y: y + 6, width: r, height: 6, rx: 3, opacity: 0.45 }));
      if (i === checked) {
        const cx = pop.x + pop.w - 18;
        pop.g.append(svg('g', { class: 'tb-accent' }, svg('path', { class: 'tb-stroke', d: `M${cx - 5} ${y + 9} L${cx - 1.5} ${y + 12.5} L${cx + 5} ${y + 5.5}` })));
      }
      places.push({ x: pop.x + 4, y, w: pop.w - 8, at: P(pop.x + LIST.inset + Math.min(r, 60) / 2, y + LIST.row / 2) });
      y += LIST.row;
    });
    return { g: pop.g, places };
  }

  /* The pointer goes to a toolbar button, its list opens, and the pointer picks a row: the build's hover shows on it,
     and the list closes. */
  async function pickFrom(run, h, id, rows, index, checked) {
    await click(run, h, id);
    const list = listPopup(h, id, rows, checked);
    await run.pause(150);
    const row = list.places[index];
    await glide(run, h, row.at, 350);
    list.g.insertBefore(svg('rect', { class: 'tb-field', x: row.x, y: row.y, width: row.w, height: LIST.row, rx: 4 }), list.g.children[1]);
    await run.pause(300);
    list.g.remove();
  }

  /* 4. Boards (spec 6.5). The colours, and the grids of 1 px lines every 40 px, are the build's (BoardStyle). A board
     shows at once, as the build sets the background of the monitor's overlay: it does not slide in. */
  const BOARDS = {
    white: { fill: '#FFFFFF', grid: null, label: 'Whiteboard' },
    black: { fill: '#000000', grid: null, label: 'Blackboard' },
    lightgrid: { fill: '#FFFFFF', grid: '#D9D9D9', label: 'Light grid' },
    darkgrid: { fill: '#000000', grid: '#404040', label: 'Dark grid' },
  };
  /* The board popup: None and the four boards, then the monitor picker: the monitor under the toolbar and each
     monitor by number and size (spec 6.5). */
  const BOARD_KINDS = [null, 'white', 'black', 'lightgrid', 'darkgrid'];
  const BOARD_LIST = [30, 70, 70, 60, 58, '|', 116, 96];

  const boardsDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen with marks. The demonstration opens a whiteboard, a blackboard, a light grid and a dark grid over it.' });
      h.sc = screen(h.svg, 'boards');
      h.doc = new Doc(h.sc.marks);
      for (const [kind, b] of Object.entries(BOARDS)) {
        if (!b.grid) continue;
        h.sc.defs.append(svg('pattern', { id: `grid-${kind}`, width: 40, height: 40, patternUnits: 'userSpaceOnUse' },
          svg('path', { d: 'M40 0 H0 V40', fill: 'none', stroke: b.grid, 'stroke-width': 1 })));
      }
      h.boardFill = svg('rect', { width: 640, height: 400 });
      h.boardGrid = svg('rect', { width: 640, height: 400, fill: 'none' });
      h.boardMarks = svg('g', { class: 'marks' });
      h.board = svg('g', { class: 'board', display: 'none' }, h.boardFill, h.boardGrid, h.boardMarks);
      h.sc.content.append(h.board);
      h.boardDoc = new Doc(h.boardMarks);
      h.open = null;
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(400, 240));
      h.buttons = {};
      const choose = async kind => {
        await stop(h);
        const was = h.open;
        setBoard(h, kind);
        h.say(kind ? `${BOARDS[kind].label}, over the live screen. Draw mode is on; the screen marks wait underneath.`
          : was ? 'None: the board closes, and the screen marks are back.' : 'No board is open: the live screen with its marks.');
      };
      h.controls.append(group('Board',
        ...[['', 'None'], ...Object.entries(BOARDS).map(([k, b]) => [k, b.label])].map(([kind, label]) => {
          const b = button(label, guard(h, () => choose(kind || null)), { 'aria-pressed': 'false' });
          h.buttons[kind || 'none'] = b;
          return b;
        })));
      return h;
    },
    reset(h) {
      h.doc.reset(); h.boardDoc.reset(); clearExtras(h);
      setBoard(h, null);
      h.tb.set({ active: null });
      movePointer(h, P(400, 240));
    },
    async play(run, h) {
      h.say('Marks on the live screen.');
      await click(run, h, 'pen', { active: 'pen' });
      await drawStroke(run, h, curve(P(190, 172), P(250, 160), P(330, 184), P(400, 170), 30, 1.2), { ms: 600 });
      await click(run, h, 'arrow', { active: 'arrow' });
      await drawShape(run, h, 'arrow', P(430, 384), P(496, 340), { ms: 400 });
      await run.pause(500);
      h.say('The board button opens a list: None, the four boards, and the monitor to show them on.');
      await pickBoard(run, h, 'white');
      h.say('Whiteboard, over the live screen of this monitor. Draw mode is on; the screen marks wait underneath.');
      await run.pause(500);
      await click(run, h, 'rectangle', { active: 'rectangle' });
      await drawShape(run, h, 'rectangle', P(180, 110), P(290, 170), { doc: h.boardDoc, ms: 500 });
      await drawShape(run, h, 'rectangle', P(380, 230), P(490, 290), { doc: h.boardDoc, ms: 500 });
      await click(run, h, 'arrow', { active: 'arrow' });
      await drawShape(run, h, 'arrow', P(292, 142), P(378, 228), { doc: h.boardDoc, ms: 500 });
      await run.pause(700);
      h.say('Blackboard. The marks on the board stay when you switch from one board to another.');
      await pickBoard(run, h, 'black');
      await run.pause(1100);
      h.say('Light grid: white, with a grey line every 40 px.');
      await pickBoard(run, h, 'lightgrid');
      await run.pause(1100);
      h.say('Dark grid: black, with a dark grey line every 40 px.');
      await pickBoard(run, h, 'darkgrid');
      await run.pause(1100);
      h.say('None: the board closes, and the screen marks are back. The board keeps its marks for the next board.');
      await pickBoard(run, h, null);
      await run.pause(400);
      h.end('A whiteboard, a blackboard, a light grid and a dark grid, each over the live screen of one monitor. The screen marks come back when the board closes.',
        'A stand-in screen with a pen stroke and an arrow, back after the boards closed. The demonstration opened a whiteboard, a blackboard, a light grid and a dark grid over it, with marks of their own.');
    },
  };

  /* Which board is open shows on the buttons below the stage. */
  function pressed(h) {
    for (const [kind, b] of Object.entries(h.buttons)) b.setAttribute('aria-pressed', String((h.open || 'none') === kind));
  }

  /* Opens a board, or closes it with null. A board forces draw mode, and the toolbar's board button shows it is on. */
  function setBoard(h, kind) {
    h.open = kind;
    pressed(h);
    h.tb.set({ draw: true, on: kind ? { board: true } : {} });
    if (!kind) { h.board.setAttribute('display', 'none'); return; }
    const b = BOARDS[kind];
    h.boardFill.setAttribute('fill', b.fill);
    h.boardGrid.setAttribute('fill', b.grid ? `url(#grid-${kind})` : 'none');
    h.board.removeAttribute('display');
  }

  async function pickBoard(run, h, kind) {
    await pickFrom(run, h, 'board', BOARD_LIST, BOARD_KINDS.indexOf(kind));
    setBoard(h, kind);
  }

  /* 5. Screenshots with the marks (spec 6.8). */
  /* The screenshot popup: Full screen and Region; Send to, with Clipboard, Folder, and Clipboard and folder, checked
     as the default (CaptureTarget Both, spec 5.6); Open screenshot folder (spec 6.9, item 12). */
  const CAPTURE_LIST = [62, 48, '|', 44, 56, 40, 104, '|', 116];
  const CAPTURE_REGION = 1, CAPTURE_BOTH = 6;
  /* The build waits 150 ms for a frame without the toolbar before it copies the screen (spec 6.8); its notification
     stays 2 s (spec 6.13, 7.1). */
  const CAPTURE_WAIT_MS = 150;
  const TOAST_MS = 2000;
  /* The size tag of the region: white on black at 80 percent, 14 px from the pointer, Segoe UI 12 px in the build
     (RegionSelectWindow); here 16, to read at card size. */
  const SIZE_TAG = { offset: 14, size: 16, padX: 6, padY: 3 };

  const captureDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen with marks. The demonstration drags a region and shows the screenshot below the screen.' });
      h.sc = screen(h.svg, 'capture');
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(400, 240));
      h.thumb = el('div', { class: 'demo-thumb', hidden: '' });
      h.controls.after(h.thumb);
      h.controls.append(button('Full screen', guard(h, async () => {
        await stop(h);
        const name = shotName();
        showShot(h, { x: 0, y: 0, w: 640, h: 400 }, name);
        h.say(`Full screen: the monitor under the pointer, with the marks, without the toolbar and the pointer. Copied and saved as ${name}.`);
      })));
      return h;
    },
    reset(h) {
      h.doc.reset(); clearExtras(h);
      h.thumb.hidden = true;
      h.thumb.replaceChildren();
      h.pointer.removeAttribute('visibility');
      h.tb.set({ hidden: false, active: null });
      movePointer(h, P(400, 240));
      /* Marks already on the screen when the screenshot is taken. */
      h.doc.add(svg('path', Object.assign(inkAttrs({}), { d: pathOf(smooth(curve(P(190, 172), P(250, 160), P(330, 184), P(400, 170), 30, 1.2))) })));
      const [l, r] = arrowHead(P(430, 384), P(496, 340), PEN_WIDTH);
      h.doc.add(svg('g', null,
        svg('line', Object.assign(inkAttrs({}), { x1: 430, y1: 384, x2: 496, y2: 340 })),
        svg('line', Object.assign(inkAttrs({}), { x1: 496, y1: 340, x2: round(l.x), y2: round(l.y) })),
        svg('line', Object.assign(inkAttrs({}), { x1: 496, y1: 340, x2: round(r.x), y2: round(r.y) }))));
      h.doc.add(svg('rect', Object.assign(inkAttrs({}), { x: 172, y: 180, width: 310, height: 150 })));
    },
    async play(run, h) {
      const name = shotName();
      h.say('The screenshot button opens a list: Full screen, Region, where to send the picture, and its folder.');
      await pickFrom(run, h, 'capture', CAPTURE_LIST, CAPTURE_REGION, CAPTURE_BOTH);
      h.say('Region. The toolbar hides, and after 150 ms the screen dims by half. The pointer becomes a cross.');
      h.tb.set({ hidden: true });
      await run.hold(CAPTURE_WAIT_MS);
      const select = regionSelect(h);
      await run.pause(600);
      const from = P(604, 390), to = P(156, 54);
      h.say('Drag the region. It stays clear inside a white frame, with its size in pixels next to the pointer.');
      const start = h.at;
      await run.tween(400, t => select.move(P(lerp(start.x, from.x, t), lerp(start.y, from.y, t))));
      let region = null;
      await run.tween(1300, t => { region = select.drag(from, P(lerp(from.x, to.x, t), lerp(from.y, to.y, t))); });
      await run.pause(300);
      select.end();
      showShot(h, region, name);
      h.tb.set({ hidden: false });
      const toast = popup(h, 320, 300, 30);
      toast.g.append(svg('rect', { class: 'tb-fill', x: toast.x + 14, y: toast.y + 12, width: 236, height: 6, rx: 3, opacity: 0.45 }));
      h.say(`The toolbar is back, with a notification for 2 s: "Screenshot copied and saved as ${name}".`);
      await run.hold(TOAST_MS);
      toast.g.remove();
      await run.pause(300);
      h.end('The marks are in the screenshot, and a board would be too; the toolbar and the pointer are not. It goes to the clipboard, to a PNG in Pictures\\Showtrace, or both.',
        'A stand-in screen with marks. Below it, the screenshot of a region: the marks are in it, the toolbar and the pointer are not.');
    },
  };

  /* Region selection, as the build draws it (spec 6.8, RegionSelectWindow): a 50 percent dim with a clear hole and a
     white frame, the size tag, and a cross for the pointer. The size is in stand-in units, which stand for pixels. */
  function regionSelect(h) {
    const mask = svg('path', { class: 'dim-mask', d: 'M0 0 H640 V400 H0 Z' });
    const frame = svg('rect', { class: 'dim-frame', display: 'none' });
    const tagText = svg('text', { fill: '#FFFFFF', 'font-size': SIZE_TAG.size, 'font-family': '"Segoe UI", system-ui, sans-serif', 'dominant-baseline': 'hanging' });
    const tagBox = svg('rect', { fill: '#000000', 'fill-opacity': 0.8, rx: 3 });
    const tag = svg('g', { display: 'none' }, tagBox, tagText);
    const cross = svg('g', { 'stroke-linecap': 'round' },
      svg('path', { d: 'M-11 0 H11 M0 -11 V11', stroke: '#FFFFFF', 'stroke-width': 4 }),
      svg('path', { d: 'M-11 0 H11 M0 -11 V11', stroke: '#1A1F24', 'stroke-width': 1.5 }));
    const dim = extra(h, underPointer(h, svg('g', null, mask, frame, tag, cross)));
    h.pointer.setAttribute('visibility', 'hidden');
    const move = p => { movePointer(h, p); cross.setAttribute('transform', `translate(${round(p.x)} ${round(p.y)})`); };
    move(h.at);
    return {
      move,
      drag(from, p) {
        move(p);
        const b = box(from, p);
        mask.setAttribute('d', `M0 0 H640 V400 H0 Z M${round(b.x)} ${round(b.y)} H${round(b.x + b.w)} V${round(b.y + b.h)} H${round(b.x)} Z`);
        attr(frame, { x: round(b.x), y: round(b.y), width: round(b.w), height: round(b.h) });
        frame.removeAttribute('display');
        /* The build writes the size with a multiplication sign; this page keeps to keyboard characters. */
        const label = `${Math.round(b.w)} x ${Math.round(b.h)}`;
        tagText.textContent = label;
        const w = label.length * SIZE_TAG.size * 0.56 + SIZE_TAG.padX * 2, hgt = SIZE_TAG.size + SIZE_TAG.padY * 2;
        /* Kept on the monitor, as the build keeps it. */
        const x = Math.min(p.x + SIZE_TAG.offset, 640 - w), y = Math.min(p.y + SIZE_TAG.offset, 400 - hgt);
        attr(tagBox, { x: round(x), y: round(y), width: round(w), height: hgt });
        attr(tagText, { x: round(x + SIZE_TAG.padX), y: round(y + SIZE_TAG.padY + 1) });
        tag.removeAttribute('display');
        return b;
      },
      end() { dim.remove(); h.pointer.removeAttribute('visibility'); },
    };
  }

  /* The screenshot as a thumbnail below the stage: the content of the stand-in screen, without the toolbar, the
     pointer and the dim, cropped to the region, with the name the build gives the file. */
  function showShot(h, region, name) {
    const shot = svg('svg', { viewBox: `${round(region.x)} ${round(region.y)} ${round(region.w)} ${round(region.h)}`, class: 'thumb', 'aria-hidden': 'true', focusable: 'false' },
      svg('use', { href: `#sc-${h.sc.id}` }));
    h.thumb.replaceChildren(shot, el('span', { text: `Saved as ${name}` }));
    h.thumb.hidden = false;
  }

  const shotName = () => `Showtrace ${stamp(new Date())}.png`;

  /* The capture file name of the build: Showtrace yyyy-MM-dd HH-mm-ss (spec 5.7). */
  function stamp(d) {
    const two = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  }

  /* 6. Explain and operate, in turns (spec 6.3). */
  const modesDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen with a button. The demonstration switches between draw mode and cursor mode.' });
      h.sc = screen(h.svg, 'modes');
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: false });
      addPointer(h, P(400, 250));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ draw: false, active: null }); h.sc.button.classList.remove('sc-pressed'); movePointer(h, P(400, 250)); },
    async play(run, h) {
      /* Picking a drawing tool switches to draw mode, so one click starts drawing (spec 6.4); the toolbar glows (6.3). */
      h.say('Cursor mode: clicks go to the application. One click on a tool, and you are in draw mode.');
      await click(run, h, 'arrow', { draw: true, active: 'arrow' }, 700);
      h.say('Draw mode: the toolbar glows, and the pointer draws on the screen.');
      await drawShape(run, h, 'arrow', P(400, 250), P(498, 330), { ms: 600 });
      await run.pause(500);
      /* Escape from inside any application leaves draw mode; the marks stay (spec 6.3). */
      h.say('Press ', { key: 'Escape' }, ', from inside any application: cursor mode. The marks stay; clicks go to the application.');
      h.tb.set({ draw: false, active: null });
      await run.pause(600);
      await glide(run, h, P(556, 336), 700);
      await press(run, h);
      h.say('The click reaches the button under the marks.');
      await run.pause(800);
      h.say('Another click on a tool, and you draw again.');
      await click(run, h, 'ellipse', { draw: true, active: 'ellipse' }, 700);
      await drawShape(run, h, 'ellipse', P(488, 306), P(624, 366), { ms: 600 });
      await run.pause(500);
      /* Hold-to-interact: while Ctrl and Alt are down in draw mode, clicks pass through; draw mode stays (spec 6.3). */
      h.say('Hold ', { key: 'Ctrl' }, '+', { key: 'Alt' }, ' in draw mode: for a moment, clicks pass through the marks. Draw mode stays on.');
      await glide(run, h, P(556, 336), 600);
      await press(run, h);
      await run.pause(500);
      h.end('Explain and operate, in turns: one click on a tool for draw mode, Escape for the pointer, Ctrl+Alt to click through the marks for a moment.',
        'A stand-in screen in draw mode. An arrow points at a button, and a circle goes round it; the pointer is on the button.');
    },
  };

  /* 7. Across monitors (spec 6.12 and 6.4; the build's ScreenMap). */
  const monitorsDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'Two stand-in monitors, at 100 and 150 percent scaling. The demonstration draws a stroke and a rectangle from one onto the other.' });
      h.sc = monitors(h.svg, 'monitors');
      /* What sets the two monitors apart, written under each: words of this page, not of a screen. */
      for (const [m, text] of [[h.sc.A, 'Scaling 100 percent'], [h.sc.B, 'Scaling 150 percent']]) {
        h.sc.content.append(svg('text', { x: m.x + m.w / 2, y: m.y + m.h + 42, 'text-anchor': 'middle', 'font-size': 20, fill: 'currentColor', text }));
      }
      h.doc = new Doc(h.sc.marks);
      addPointer(h, P(60, 160));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); movePointer(h, P(60, 160)); },
    async play(run, h) {
      h.say('Two monitors with the same number of pixels. The right one runs at 150 percent, so the same window shows larger there.');
      await run.pause(1200);
      h.say('A stroke from one monitor onto the other: one line, across the edge.');
      await drawStroke(run, h, curve(P(60, 160), P(200, 110), P(400, 210), P(580, 150), 50, 1.2), { ms: 1400 });
      await run.pause(500);
      h.say('A rectangle across both. Each copy keeps its physical size and place, so the line is as wide on both.');
      await drawShape(run, h, 'rectangle', P(170, 100), P(470, 215), { ms: 700 });
      await run.pause(400);
      h.end('Strokes and shapes continue from one monitor onto the next, also at different scaling; each copy keeps its physical size and place. Text stays on one monitor.',
        'Two stand-in monitors, at 100 and 150 percent scaling, with a stroke and a rectangle that continue from one onto the other.');
    },
  };

  /* 8. Colour and width (spec 6.9, items 6 and 7). A pick sets the pen for what is drawn next; marks already drawn keep
     their colour and width. So the palette and the slider below the stage set the pen and draw a sample stroke with it. */
  const colourDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration picks a colour from the palette, a width from the slider and a custom colour.' });
      h.sc = screen(h.svg, 'colour');
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true, active: 'pen' });
      addPointer(h, P(400, 240));
      /* The picker's square (white to the hue, then to black) and its hue strip. */
      const at = (offset, colour, opacity = 1) => svg('stop', { offset: round(offset), 'stop-color': colour, 'stop-opacity': opacity });
      h.sc.defs.append(
        svg('linearGradient', { id: 'picker-white' }, at(0, '#FFFFFF'), at(1, '#FFFFFF', 0)),
        svg('linearGradient', { id: 'picker-black', x2: 0, y2: 1 }, at(0, '#000000', 0), at(1, '#000000')),
        svg('linearGradient', { id: 'picker-hue', x2: 0, y2: 1 }, ...['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'].map((c, i) => at(i / 6, c))));
      h.swatches = PALETTE.map(hex => {
        const b = button('', guard(h, () => setPen(h, { colour: hex })), { class: 'swatch', 'aria-label': `Colour ${hex}`, 'aria-pressed': 'false' });
        b.style.setProperty('--swatch', hex);
        return b;
      });
      h.range = el('input', { type: 'range', min: 1, max: 40, value: PEN_WIDTH, 'aria-label': 'Width, 1 to 40' });
      h.out = el('output', { text: String(PEN_WIDTH), 'aria-live': 'off' });
      /* The value is read before the play is stopped: the end state of a play sets the slider too. */
      h.range.addEventListener('input', guard(h, () => setPen(h, { width: Number(h.range.value) })));
      h.controls.append(group('Palette', ...h.swatches), group('Width', h.range, h.out));
      return h;
    },
    reset(h) {
      h.doc.reset(); clearExtras(h);
      h.colour = INK.pen; h.width = PEN_WIDTH;
      showPen(h);
      h.tb.set({ active: 'pen' });
      movePointer(h, P(400, 240));
    },
    async play(run, h) {
      const cell = 14, gap = 3, pad = 6;
      const centreOf = r => P(+r.getAttribute('x') + +r.getAttribute('width') / 2, +r.getAttribute('y') + +r.getAttribute('height') / 2);
      /* The palette popup: 32 colours in four rows, then Custom and Use at startup. */
      const openPalette = async () => {
        await click(run, h, 'colour');
        const pal = popup(h, h.tb.centre('colour').x, pad * 2 + 8 * cell + 7 * gap, pad * 2 + 4 * cell + 3 * gap + 24);
        const swatches = PALETTE.map((hex, i) => svg('rect', { x: pal.x + pad + (i % 8) * (cell + gap), y: pal.y + pad + Math.floor(i / 8) * (cell + gap), width: cell, height: cell, rx: 3, fill: hex, class: 'tb-swatch' }));
        const custom = svg('rect', { class: 'tb-textbutton', x: pal.x + pad, y: pal.y + pal.h - pad - 16, width: 46, height: 16, rx: 4 });
        pal.g.append(...swatches, custom, svg('rect', { class: 'tb-textbutton', x: pal.x + pad + 52, y: pal.y + pal.h - pad - 16, width: 78, height: 16, rx: 4 }));
        return { g: pal.g, swatches, custom };
      };

      let pal = await openPalette();
      h.say('The colour button opens the palette: 32 colours in four rows, recent custom colours, and Custom.');
      await run.pause(500);
      const blue = 10;
      await glide(run, h, centreOf(pal.swatches[blue]), 600);
      pal.swatches[blue].setAttribute('class', 'tb-swatch tb-swatch-on');
      await run.pause(300);
      pal.g.remove();
      h.colour = PALETTE[blue];
      h.tb.set({ colour: h.colour });
      h.say(`Picked ${h.colour}. Shapes and text take the pen colour too.`);
      tagMark(await drawStroke(run, h, curve(P(200, 200), P(260, 170), P(340, 230), P(420, 200), 30, 1), { colour: h.colour, ms: 700 }), `a ${h.colour} stroke of ${h.width} px`);
      await run.pause(400);

      await click(run, h, 'width');
      h.say('The width button opens a slider, 1 to 40, with a preview dot in the colour.');
      const wp = popup(h, h.tb.centre('width').x, 200, 36);
      const track = svg('line', { class: 'tb-track', x1: wp.x + 40, y1: wp.y + 18, x2: wp.x + 160, y2: wp.y + 18 });
      const knob = svg('circle', { class: 'tb-knob', cy: wp.y + 18, r: 6 });
      const preview = svg('circle', { cx: wp.x + 20, cy: wp.y + 18, fill: h.colour });
      wp.g.append(track, knob, preview);
      const knobAt = w => { const x = wp.x + 40 + ((w - 1) / 39) * 120; knob.setAttribute('cx', round(x)); preview.setAttribute('r', round(Math.min(14, w) / 2)); return P(x, wp.y + 18); };
      await glide(run, h, knobAt(PEN_WIDTH), 500);
      await run.tween(600, t => { h.width = Math.round(lerp(PEN_WIDTH, 12, t)); movePointer(h, knobAt(h.width)); }, linear);
      await run.pause(300);
      wp.g.remove();
      h.tb.set({ width: h.width });
      h.say(`Width ${h.width}.`);
      tagMark(await drawStroke(run, h, curve(P(200, 262), P(260, 232), P(340, 292), P(420, 262), 30, 1), { colour: h.colour, width: h.width, ms: 700 }), `a ${h.colour} stroke of ${h.width} px`);
      await run.pause(400);

      /* A colour outside the palette, at 3:1 or more against the stand-in's background and panel in both schemes
         (WCAG 1.4.11), as the palette blue is: hue 293 degrees, saturation 62 percent, value 82 percent. */
      const custom = { hex: '#C04FD0', hue: 293, s: 0.62, v: 0.82 };
      pal = await openPalette();
      await glide(run, h, centreOf(pal.custom), 500);
      await run.pause(200);
      pal.g.remove();
      h.say('Custom opens a picker with a hex field: any colour, picked or typed in.');
      const cp = popup(h, h.tb.centre('colour').x, 150, 132);
      const sq = { x: cp.x + 10, y: cp.y + 10, w: 104, h: 64 };
      const field = { x: cp.x + 10, y: cp.y + 82 };
      const hex = svg('text', { class: 'tb-text', x: field.x + 8, y: field.y + 14 });
      const ok = svg('rect', { class: 'tb-textbutton', x: cp.x + 10, y: cp.y + 108, width: 60, height: 16, rx: 4 });
      cp.g.append(
        svg('rect', { x: sq.x, y: sq.y, width: sq.w, height: sq.h, rx: 3, fill: `hsl(${custom.hue}, 100%, 50%)` }),
        svg('rect', { x: sq.x, y: sq.y, width: sq.w, height: sq.h, rx: 3, fill: 'url(#picker-white)' }),
        svg('rect', { x: sq.x, y: sq.y, width: sq.w, height: sq.h, rx: 3, fill: 'url(#picker-black)' }),
        svg('rect', { x: cp.x + 124, y: sq.y, width: 16, height: sq.h, rx: 3, fill: 'url(#picker-hue)' }),
        svg('rect', { x: cp.x + 122, y: round(sq.y + (custom.hue / 360) * sq.h - 1.5), width: 20, height: 3, rx: 1.5, fill: '#FFFFFF', stroke: '#000000', 'stroke-width': 0.75 }),
        svg('rect', { class: 'tb-field', x: field.x, y: field.y, width: 130, height: 20, rx: 4 }), hex, ok);
      const spot = P(round(sq.x + custom.s * sq.w), round(sq.y + (1 - custom.v) * sq.h));
      await glide(run, h, spot, 600);
      cp.g.append(svg('circle', { cx: spot.x, cy: spot.y, r: 4, fill: 'none', stroke: '#FFFFFF', 'stroke-width': 2 }));
      hex.textContent = custom.hex;
      await run.pause(600);
      await glide(run, h, centreOf(ok), 400);
      await run.pause(200);
      cp.g.remove();
      h.colour = custom.hex;
      h.tb.set({ colour: h.colour });
      h.say(`${h.colour}. The palette keeps it with the recent custom colours.`);
      tagMark(await drawStroke(run, h, curve(P(200, 324), P(260, 294), P(340, 354), P(420, 324), 30, 1), { colour: h.colour, width: h.width, ms: 700 }), `a ${h.colour} stroke of ${h.width} px`);
      showPen(h);
      await run.pause(200);
      h.end(`Three strokes: the palette blue at 4 and at ${h.width} px, then a custom colour.`, marksAlt(h));
    },
  };

  /* The pen on the toolbar's colour and width buttons and in the controls below the stage. */
  function showPen(h) {
    h.tb.set({ colour: h.colour, width: h.width });
    h.range.value = String(h.width);
    h.out.textContent = String(h.width);
    h.swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(PALETTE[i] === h.colour)));
  }

  /* A control of the colour demonstration: it sets the pen and draws a sample stroke with it, in the empty space right
     of the panel, in place of the last sample. */
  async function setPen(h, changes) {
    await stop(h);
    Object.assign(h, changes);
    showPen(h);
    if (h.sample) h.sample.remove();
    h.sample = tagMark(svg('path', Object.assign(inkAttrs({ colour: h.colour, width: h.width }), { d: pathOf(smooth(curve(P(494, 262), P(530, 236), P(578, 288), P(614, 258), 20, 1))) })), `a ${h.colour} sample stroke of ${h.width} px`);
    h.sc.marks.append(h.sample);
    h.end(`The pen: ${h.colour}, ${h.width} px. The sample stroke shows it; strokes already drawn keep theirs.`, marksAlt(h));
  }

  /* 9. The toolbar (spec 6.9). The vertical toolbar stands at the right edge, where its two columns leave the
     "Demonstration" label free. */
  const TOOLBAR_RIGHT = { x: 616, y: 8 };
  const VERTICAL_LINE = 'Vertical. On this small screen it wraps into a second column, as the build\'s does on a monitor too short for it.';
  const AUTO_LINE = 'Auto follows the Windows app theme. Here it follows your browser.';

  const toolbarDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen with the toolbar. The demonstration shows it horizontal, vertical, collapsed and hidden, in the light, dark and auto themes.' });
      h.sc = screen(h.svg, 'toolbar');
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true, y: 8 });
      addPointer(h, P(400, 260));
      h.buttons = {};
      const place = async (changes, text) => { await stop(h); h.tb.set(changes); shown(h); h.end(text, toolbarAlt(h)); };
      const toggles = (label, items) => group(label, ...items.map(([key, name, changes, text]) => {
        h.buttons[key] = button(name, guard(h, () => place(changes, text)), { 'aria-pressed': 'false' });
        return h.buttons[key];
      }));
      h.controls.append(
        toggles('Toolbar', [
          ['horizontal', 'Horizontal', { vertical: false, collapsed: false, hidden: false, x: 320, y: 8 }, 'Horizontal, at the top centre of the monitor.'],
          ['vertical', 'Vertical', Object.assign({ vertical: true, collapsed: false, hidden: false }, TOOLBAR_RIGHT), VERTICAL_LINE],
          ['collapsed', 'Collapsed', { collapsed: true, hidden: false }, 'Collapsed to its main icon. A click expands it; a drag moves it.'],
          ['hidden', 'Hidden', { hidden: true }, 'Hidden, in ghost mode. A click on the tray icon brings it back.'],
        ]),
        toggles('Theme', [
          ['light', 'Light', { theme: 'light' }, 'Light theme.'],
          ['dark', 'Dark', { theme: 'dark' }, 'Dark theme.'],
          ['auto', 'Auto', { theme: 'auto' }, AUTO_LINE],
        ]));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ vertical: false, collapsed: false, hidden: false, theme: 'auto', draw: true, x: 320, y: 8 }); movePointer(h, P(400, 260)); shown(h); },
    async play(run, h) {
      const step = async (text, ms) => { shown(h); h.say(text); await run.pause(ms); };
      await step('Horizontal, at the top centre of the primary monitor. In draw mode its border glows.', 1400);
      await click(run, h, 'menu', Object.assign({ vertical: true }, TOOLBAR_RIGHT));
      await step(`${VERTICAL_LINE} Orientation is in its menu.`, 2200);
      await click(run, h, 'main', { collapsed: true });
      await step('A click on its main icon collapses it to the icon.', 1200);
      h.tb.set({ hidden: true });
      await step('Ghost mode, in the tray menu, hides it.', 1200);
      h.tb.set({ hidden: false });
      await step('A click on the tray icon brings it back, where it was.', 1200);
      await click(run, h, 'main', { collapsed: false });
      await step('A click on the main icon expands it again.', 1000);
      await click(run, h, 'menu', { vertical: false, x: 320, y: 8 });
      await step('Horizontal again, from its menu.', 1000);
      /* A drag on the main icon, into the gap between the lines and the panel of the stand-in. */
      await click(run, h, 'main');
      h.say('A drag on the main icon moves it. It remembers where you leave it.');
      await run.tween(800, t => { h.tb.set({ y: round(lerp(8, 164, t)) }); movePointer(h, h.tb.centre('main')); });
      await run.pause(1000);
      await click(run, h, 'menu', { theme: 'light' });
      await step('Light theme, from its menu.', 1000);
      await click(run, h, 'menu', { theme: 'dark' });
      await step('Dark theme, from its menu.', 1000);
      await click(run, h, 'menu', { theme: 'auto' });
      await step('Auto theme, from its menu. It follows the Windows app theme; here it follows your browser.', 600);
      h.end('Horizontal or vertical, collapsed or hidden; light, dark or auto.', toolbarAlt(h));
    },
  };

  /* The toggles below the stage show the toolbar's shape and theme. */
  function shown(h) {
    const s = h.tb.state;
    const shape = s.hidden ? 'hidden' : s.collapsed ? 'collapsed' : s.vertical ? 'vertical' : 'horizontal';
    for (const [key, b] of Object.entries(h.buttons)) b.setAttribute('aria-pressed', String(key === shape || key === s.theme));
  }

  function toolbarAlt(h) {
    const s = h.tb.state;
    if (s.hidden) return 'A stand-in screen. The toolbar is hidden, in ghost mode.';
    const shape = s.collapsed ? 'collapsed to its main icon' : s.vertical ? 'vertical, in two columns at the right edge' : s.y > 40 ? 'horizontal, moved down from the top' : 'horizontal, at the top centre';
    return `A stand-in screen with the toolbar ${shape}, in the ${s.theme} theme, its border glowing for draw mode.`;
  }

  /* 10 and 11. The trace (planned) and two authors (phase 2). Each mark is drawn on the stand-in screen first, and then
     the step it would become is added to the mock trace next to it, with the signature stroke that ends in the author's
     dot or ring (brand.md, 6.6 and 7). The trace mock is HTML in the card, so that it reads without the script; the
     script only hides its steps at the start and shows them one by one. The lines say "will" for the planned trace and
     "would" for phase 2: the build keeps no steps and has no AI author (AGENTS.md, rule 3). */

  /* The signature stroke at step size, on a 24-unit grid drawn at 24 px: a loop that comes down onto the author's
     mark and stops at its edge, so that an open ring stays open. */
  const STEP_STROKE = 'M3 19 C5 11, 9 5, 13 6 C17 7, 15 13, 12 12 C9 11, 11 7, 15 8 C18 9, 19 11, 19 14';
  /* The author's mark, 10 px across: a filled dot, or an open ring with a 2 px stroke (brand.md, section 7). */
  const STEP_DOT = { cx: 19, cy: 19, r: 5 };
  const STEP_RING = { cx: 19, cy: 19, r: 4 };
  /* The signature's length (brand.md, 6.6): the next step waits until the dot is in. */
  const SIGNATURE_MS = 1100;

  /* The marks of the three steps, in the order of the trace mock (brand.md, section 7): the File menu circled, an
     arrow at Export in the open menu, the button framed. */
  const TRACE_MARKS = {
    file: [P(6, 2), P(62, 34)],
    exportFrom: P(196, 128),
    exportAt: P(118, 79),
    save: [P(492, 310), P(620, 362)],
  };

  function traceDemo(kind) {
    const phase2 = kind === 'authors';
    return {
      build(card, mount) {
        const h = stage(card, mount, {
          alt: phase2
            ? 'A stand-in screen. The demonstration draws three marks on it, one of them by an AI, and adds each as a step to the trace next to it. Phase 2: no agent is connected.'
            : 'A stand-in screen. The demonstration draws three marks on it and adds each as a step to the trace next to it. Planned: the build does not keep steps yet.',
          label: phase2 ? 'Demonstration. Phase 2' : 'Demonstration. Planned',
        });
        h.sc = screen(h.svg, kind);
        h.doc = new Doc(h.sc.marks);
        addPointer(h, P(360, 260));
        h.steps = [...card.querySelectorAll('.steps .step')];
        for (const li of h.steps) {
          const author = li.querySelector('.step-author');
          const old = author && author.querySelector('.dot, .ring');
          const ai = Boolean(old && old.classList.contains('ring'));
          li.dataset.ai = ai ? 'yes' : 'no';
          const mark = svg('svg', { class: `step-mark ${ai ? 'ai' : 'person'}`, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
            svg('path', { class: 'step-stroke', pathLength: 100, d: STEP_STROKE }),
            svg('circle', Object.assign({ class: ai ? 'step-ring' : 'step-dot' }, ai ? STEP_RING : STEP_DOT)));
          if (old) old.replaceWith(mark); else if (author) author.prepend(mark);
        }
        return h;
      },
      reset(h) {
        h.doc.reset(); clearExtras(h); h.sc.closeMenu();
        for (const li of h.steps) { li.classList.add('step-hidden'); li.classList.remove('is-drawn', 'is-instant'); }
        movePointer(h, P(360, 260));
      },
      async play(run, h) {
        const [first, second, third] = h.steps;
        const ai = Boolean(second && second.dataset.ai === 'yes');
        /* A step shows, and with motion its stroke draws itself. The reset before a play removed is-drawn in the same
           task, so the browser never saw it go; reading the layout makes it see that, or a second play would not
           draw the stroke again. */
        const add = async (li, line) => {
          h.say(line);
          if (!li) return;
          li.classList.remove('step-hidden');
          if (run.instant) { li.classList.add('is-instant', 'is-drawn'); return; }
          void li.offsetWidth;
          li.classList.add('is-drawn');
          await run.pause(SIGNATURE_MS);
        };

        h.say(phase2 ? 'The teacher circles the File menu: a solid mark, in the pen colour.' : 'The teacher circles the File menu on the live screen.');
        await drawShape(run, h, 'ellipse', TRACE_MARKS.file[0], TRACE_MARKS.file[1], { ms: 700, approach: 500 });
        h.sc.openMenu();
        await run.pause(300);
        await add(first, phase2
          ? 'Step 1: a filled dot and the teacher\'s role. No reason was given, so it would say "not given".'
          : 'The trace will keep the mark as step 1, with what was done, who did it and why.');
        await run.pause(500);

        h.say(ai
          ? 'Then AI (Copilot) would select Export: the same arrow, dashed and grey, with an open ring at the click.'
          : 'The teacher points at Export.');
        await drawShape(run, h, 'arrow', TRACE_MARKS.exportFrom, TRACE_MARKS.exportAt, ai ? { cls: 'ai-ink', dashed: true, ring: true, ms: 600 } : { ms: 600 });
        await run.pause(300);
        await add(second, ai
          ? 'Step 2 would carry an open ring and the label AI, with the agent\'s name and its reason.'
          : 'Step 2 will carry the reason in the teacher\'s own words.');
        await run.pause(500);

        h.say(phase2 ? 'The teacher saves the file as PDF.' : 'The teacher frames the button that saves the file.');
        await drawShape(run, h, 'rectangle', TRACE_MARKS.save[0], TRACE_MARKS.save[1], { ms: 600 });
        await run.pause(300);
        await add(third, phase2
          ? 'Step 3, with the teacher\'s reason.'
          : 'Step 3. No reason was given, so the step will say "not given".');
        await run.pause(400);

        const screenAlt = phase2
          ? 'The stand-in screen with three marks: a red ellipse round the File menu, a dashed grey arrow at Export in the open menu with an open ring at its tip, and a red rectangle round a button.'
          : 'The stand-in screen with three red marks: an ellipse round the File menu, an arrow at Export in the open menu, and a rectangle round a button.';
        h.end(phase2
          ? 'Two authors in one trace: solid marks and a filled dot for the teacher, dashed grey marks and an open ring for the AI.'
          : 'Three marks, three steps in order, each with what was done, who did it and why.',
        `${screenAlt} The trace next to it lists them as three steps.`);
      },
    };
  }

  const DEMOS = {
    draw: drawDemo, point: pointDemo, fade: fadeDemo, boards: boardsDemo, capture: captureDemo, modes: modesDemo,
    monitors: monitorsDemo, colour: colourDemo, toolbar: toolbarDemo, trace: traceDemo('trace'), authors: traceDemo('authors'),
  };

  /* ---------- Mounting, playing once in view, stopping ---------- */

  const mounted = [];
  const failed = new WeakSet();
  const moving = h => Boolean(h.run && !h.run.instant);

  /* The play control: "Play" before any play, "Stop" while one moves, "Play again" after. One button, so that focus
     stays on it after a click; a hidden copy of the longest label keeps its width, so that the controls next to it
     do not move when the label changes. */
  function playControl(h) {
    const label = el('span', { text: 'Play' });
    const b = button('', () => (moving(h) ? stop(h, { stopped: true }) : start(h)), { class: 'btn demo-play' });
    b.append(label, el('span', { class: 'demo-play-fit', 'aria-hidden': 'true', text: 'Play again' }));
    h.frame.control = label;
    return b;
  }

  function showControl(h) {
    h.frame.control.textContent = moving(h) ? 'Stop' : h.frame.played ? 'Play again' : 'Play';
  }

  /* Plays a demonstration from its start state: with motion when the visitor allows motion and the tab is shown,
     otherwise as an instant run that shows the end state at once. how.auto: the frame started it, not the visitor;
     how.instant: show the end state; how.quiet: announce nothing; how.stopped: announce the end as a stop.
     Resolves when the play has ended or was cancelled. */
  function start(h, how = {}) {
    const f = h.frame;
    if (failed.has(h.card)) return Promise.resolve();
    halt(h);
    const run = new Run(Boolean(how.instant) || reducedMotion.matches || document.hidden);
    const speaks = !how.quiet && (!run.instant || !how.auto);
    h.run = run;
    f.played = true;
    f.ended = '';
    showControl(h);
    /* A quiet run empties the live region, so that a screen reader does not find "is playing" in it afterwards. */
    if (!speaks) speak(h, '');
    else if (!run.instant) speak(h, `${f.name}: the demonstration is playing.`);
    return (async () => {
      await rehearse(h);
      await f.demo.play(run, h);
      if (speaks) speak(h, `${f.name}: the demonstration has ${how.stopped ? 'stopped' : 'ended'}. ${f.ended}`);
    })()
      .catch(error => { if (error !== CANCEL) fail(h.card, error, h); })
      .finally(() => { if (h.run === run) { h.run = null; showControl(h); } });
  }

  /* Stops a play in progress at its end state and resolves once the end state shows. A demonstration's own control
     awaits it before it changes the picture, so that it changes a known picture. Quiet, except for Stop. */
  function stop(h, how = {}) {
    if (!h.run) return Promise.resolve();
    return start(h, Object.assign({ instant: true, quiet: !how.stopped }, how));
  }

  /* A control's handler: an error takes the demonstration out, as an error in a play does. The handler runs in the
     microtask after the event, before anything else can change what it reads. */
  const guard = (h, fn) => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => fail(h.card, error, h));

  /* Cancels a play where it is, before a new one starts. */
  function halt(h) {
    const run = h.run;
    h.run = null;
    if (run) run.cancel();
  }

  /* The rehearsal: the play once as an instant run, from the start state back to the start state, keeping the lines
     it says. The state line then holds them all, hidden, in one grid cell, so that it takes the height of the
     longest and the card does not grow or shrink while the play runs. An instant run ends before the browser
     paints, so nobody sees the rehearsal. */
  async function rehearse(h) {
    const f = h.frame;
    const lines = [];
    f.lines = lines;
    try {
      f.demo.reset(h);
      await f.demo.play(new Run(true), h);
    } finally {
      f.lines = null;
    }
    f.demo.reset(h);
    const seen = new Set();
    f.fits.replaceChildren();
    for (const parts of [[START_LINE], ...lines]) {
      const text = textOf(parts);
      if (seen.has(text)) continue;
      seen.add(text);
      f.fits.append(el('span', null, ...nodesOf(parts)));
    }
  }

  /* A play starts once, when this share of its stage is in view, and stops at its end state when the stage has left
     the view, so that nothing moves where nobody looks. */
  const IN_VIEW = 0.35;

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const h = mounted.find(m => m.box === entry.target);
      if (!h) continue;
      if (entry.isIntersecting && entry.intersectionRatio >= IN_VIEW - 0.01) { if (!h.frame.played) start(h, { auto: true }); }
      else if (!entry.isIntersecting && moving(h)) stop(h);
    }
  }, { threshold: [0, IN_VIEW] }) : null;

  /* Mounts the demonstration a card names into the card's .feature-demo. */
  function mount(card) {
    const demo = DEMOS[card.dataset.demo];
    const slot = card.querySelector('.feature-demo');
    if (!slot) return;
    if (!demo) { slot.hidden = true; console.error(`Showtrace: no demonstration is named "${card.dataset.demo}"; its card shows its text only.`); return; }
    let h = null;
    try {
      h = demo.build(card, slot);
      h.frame.demo = demo;
      h.frame.name = card.querySelector('h3')?.textContent.trim() || 'Demonstration';
      /* The figure carries the card's name, so that its controls, named Play or Undo as in every card, are found in
         their card. */
      h.box.parentElement.setAttribute('aria-label', `${h.frame.name}, demonstration`);
      h.controls.prepend(playControl(h));
    } catch (error) {
      fail(card, error, h);
      return;
    }
    rehearse(h).then(() => {
      mounted.push(h);
      if (observer) observer.observe(h.box); else start(h, { auto: true });
    }, error => fail(card, error, h));
  }

  /* A demonstration whose build, reset or play throws is taken out: its card keeps its text, the other
     demonstrations go on, and the error is logged once. */
  function fail(card, error, h) {
    if (failed.has(card)) return;
    failed.add(card);
    if (h) {
      if (mounted.includes(h)) mounted.splice(mounted.indexOf(h), 1);
      if (observer && h.box) observer.unobserve(h.box);
      halt(h);
    }
    const slot = card.querySelector('.feature-demo');
    slot.replaceChildren();
    slot.hidden = true;
    console.error(`Showtrace: the "${card.dataset.demo}" demonstration stopped with an error; its card shows its text only.`, error);
  }

  /* A hidden tab, or reduced motion turned on while the page is open, stops every play at its end state. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const h of mounted) if (moving(h)) stop(h);
  });
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    for (const h of mounted) if (moving(h)) stop(h);
  });

  /* A printed page shows end states: a card that has not come into view, or whose play still moves, is brought to
     its end state before the page prints, quietly. An instant run ends before the browser paints. The card stays
     observed, so that a play started after the print still stops out of view; it counts as played, so the observer
     does not start it by itself. */
  window.addEventListener('beforeprint', () => {
    for (const h of mounted) {
      if (h.frame.played && !moving(h)) continue;
      start(h, { instant: true, quiet: true });
    }
  });

  /* ---------- The sandbox: draw on the stand-in screen, save a PNG ---------- */

  /* Eight of the palette's 32 colours (spec 5.8), with the names a screen reader says. The pen starts in #FF3B30 and
     the highlighter in #FFCC00, as in the build (spec 5.6). */
  const SANDBOX_COLOURS = [
    ['#FF3B30', 'Red'], ['#FF9500', 'Orange'], ['#FFCC00', 'Yellow'], ['#34C759', 'Green'],
    ['#007AFF', 'Blue'], ['#AF52DE', 'Purple'], ['#000000', 'Black'], ['#FFFFFF', 'White'],
  ];

  /* What the state line says. It speaks only after a control, so it is a polite live region of its own. */
  const marksOf = n => (n === 0 ? 'No marks' : n === 1 ? '1 mark' : `${n} marks`);
  const SANDBOX_LINES = {
    start: 'Draw with a mouse, a pen or a finger. The marks stay in this page.',
    pen: 'Pen: smoothed when you let go.',
    highlighter: 'Highlighter: three times the pen\'s width, translucent, with flat ends.',
    arrow: 'Arrow: drag from its tail to its head. Hold Shift for 45 degree steps.',
    fade: s => (s ? `Fading ink, ${s} s: the marks you draw next fade after ${s} s. Marks already drawn keep their own time.` : 'Fading ink off: the marks you draw next stay. Marks already drawn keep their own time.'),
    undo: n => `Undone. ${marksOf(n)} on the screen.`,
    redo: n => `Redone. ${marksOf(n)} on the screen.`,
    clear: 'Cleared. Undo brings the marks back in one step.',
    none: what => `Nothing to ${what}.`,
    saved: name => `Your browser saves the picture as ${name}.`,
    noPng: 'This browser cannot make a PNG of the picture.',
  };

  /* A line or an arrow held to 45 degree steps while Shift is down (spec 6.4). */
  function snap(from, to) {
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return P(from.x + length * Math.cos(angle), from.y + length * Math.sin(angle));
  }

  /* The light tokens of the stylesheet's own :root rule, or null. A printed page is light whatever the screen's scheme
     (styles.css), and a canvas holds pixels, so for paper the sandbox paints its stand-in again with these. */
  function lightTokens() {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (_) { continue; }
      for (const rule of rules) if (rule.selectorText === ':root') return rule.style;
    }
    return null;
  }

  function sandbox(root) {
    const W = 640, H = 400;
    const canvas = el('canvas', { class: 'sandbox-canvas', role: 'img' });
    const stageBox = el('div', { class: 'demo-stage sandbox-stage' }, canvas, el('span', { class: 'demo-label', text: 'Demonstration' }));
    /* The longest lines lie hidden under the one that shows, so the state line keeps its height (as in a card). */
    const line = el('span', { class: 'demo-state-line', role: 'status', 'aria-live': 'polite', text: SANDBOX_LINES.start });
    const fits = el('span', { class: 'demo-state-fits', 'aria-hidden': 'true' },
      ...[SANDBOX_LINES.pen, SANDBOX_LINES.fade(20), SANDBOX_LINES.fade(0), SANDBOX_LINES.undo(88), SANDBOX_LINES.clear,
        SANDBOX_LINES.saved(`Showtrace demonstration ${stamp(new Date())}.png`), SANDBOX_LINES.noPng].map(text => el('span', { text })));
    const state = el('p', { class: 'demo-state' }, line, fits);
    const say = text => { line.textContent = text; };
    const ctx = canvas.getContext('2d');
    let scale = 1, dpr = 1;
    const items = [];
    let done = [], undone = [], current = null, frame = 0, timer = 0;
    let tool = 'pen', fade = 0;
    const colours = { pen: INK.pen, highlighter: INK.highlighter };

    /* 1 until the item's fade time, then down to 0 over 600 ms; null once it has gone (spec 5.4). */
    function alphaOf(item, now) {
      if (!item.fadeAfter) return 1;
      const age = now - item.createdAt;
      if (age < item.fadeAfter) return 1;
      if (age < item.fadeAfter + FADE_OUT_MS) return 1 - (age - item.fadeAfter) / FADE_OUT_MS;
      return null;
    }

    function paintItem(c, item, alpha) {
      c.globalAlpha = alpha * (item.highlighter ? HIGHLIGHTER_OPACITY : 1);
      c.strokeStyle = item.colour;
      c.lineWidth = item.width;
      c.lineCap = item.highlighter ? 'butt' : 'round';
      c.lineJoin = 'round';
      c.beginPath();
      if (item.kind === 'arrow') {
        c.moveTo(item.from.x, item.from.y); c.lineTo(item.to.x, item.to.y);
        const [l, r] = arrowHead(item.from, item.to, item.width);
        c.moveTo(item.to.x, item.to.y); c.lineTo(l.x, l.y);
        c.moveTo(item.to.x, item.to.y); c.lineTo(r.x, r.y);
      } else {
        item.points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        if (item.points.length === 1) c.lineTo(item.points[0].x + 0.1, item.points[0].y);
      }
      c.stroke();
      c.globalAlpha = 1;
    }

    /* Paints the stand-in and the marks. While a mark fades out, the next frame paints again; before that, one timer
       waits until the next mark starts to fade, so that nothing runs while every mark holds still. */
    function render() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = timer = 0;
      const now = performance.now();
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      paintStandIn(ctx, false);
      let fadingOut = false, next = Infinity;
      for (const item of [...items]) {
        const alpha = alphaOf(item, now);
        if (alpha === null) { expire(item); continue; }
        paintItem(ctx, item, alpha);
        if (!item.fadeAfter) continue;
        const begins = item.createdAt + item.fadeAfter;
        if (now >= begins) fadingOut = true; else next = Math.min(next, begins);
      }
      if (current) paintItem(ctx, current, 1);
      if (fadingOut) frame = requestAnimationFrame(render);
      else if (next < Infinity) timer = setTimeout(render, next - now);
    }

    /* Fade expiry, as in the build: the mark leaves the page, and every undo step that references it leaves both
       stacks, so that undo never brings expired ink back (spec 5.2). */
    function expire(item) {
      items.splice(items.indexOf(item), 1);
      done = done.filter(c => !c.items.includes(item));
      undone = undone.filter(c => !c.items.includes(item));
      describe();
    }

    /* The text alternative of the canvas: what is drawn on it now. */
    function describe() {
      const count = (n, one, many) => (n ? [`${n} ${n === 1 ? one : many}`] : []);
      const parts = [
        ...count(items.filter(i => i.kind === 'stroke' && !i.highlighter).length, 'pen stroke', 'pen strokes'),
        ...count(items.filter(i => i.highlighter).length, 'highlighter stroke', 'highlighter strokes'),
        ...count(items.filter(i => i.kind === 'arrow').length, 'arrow', 'arrows'),
      ];
      const fading = items.filter(i => i.fadeAfter).length;
      const text = parts.length ? `A stand-in screen with ${parts.join(', ')}${fading ? `, ${fading} of them in fading ink` : ''}.` : 'A stand-in screen to draw on. No marks yet.';
      canvas.setAttribute('aria-label', text);
    }

    function exec(command) { command.redo(); done.push(command); undone = []; render(); describe(); }

    /* On release a stroke is replaced by its smoothed form (spec 5.3), and the mark takes the fading time set now
       (spec 5.4). */
    function commit(item) {
      if (item.kind === 'stroke') item.points = smooth(item.points);
      item.createdAt = performance.now();
      item.fadeAfter = fade ? fade * 1000 : null;
      exec({ items: [item], redo: () => items.push(item), undo: () => items.splice(items.indexOf(item), 1) });
    }

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return P((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
    }

    function style() {
      if (tool === 'highlighter') return { highlighter: true, colour: colours.highlighter, width: PEN_WIDTH * HIGHLIGHTER_FACTOR };
      return { highlighter: false, colour: colours.pen, width: PEN_WIDTH };
    }

    /* One pointer draws at a time: a second finger on the screen does not start a second mark. */
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || current) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic event has no pointer to capture */ }
      const p = pos(e);
      current = Object.assign(tool === 'arrow' ? { kind: 'arrow', from: p, to: p } : { kind: 'stroke', points: [p] }, style(), { pointer: e.pointerId });
      render();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!current || e.pointerId !== current.pointer) return;
      const p = pos(e);
      if (current.kind === 'arrow') current.to = e.shiftKey ? snap(current.from, p) : p;
      else { const last = current.points[current.points.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) current.points.push(p); }
      render();
    });
    const finish = e => {
      if (!current || e.pointerId !== current.pointer) return;
      const item = current;
      current = null;
      delete item.pointer;
      /* A click without a drag creates no shape; a click with the pen draws a dot (checklist). */
      if (item.kind === 'arrow' && Math.hypot(item.to.x - item.from.x, item.to.y - item.from.y) < 4) { render(); return; }
      commit(item);
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);

    function resize() {
      const w = stageBox.clientWidth;
      if (!w) return;
      dpr = window.devicePixelRatio || 1;
      scale = w / W;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round((w * H / W) * dpr);
      render();
    }

    /* Controls. A tool and a colour are toggles; their pressed state says which is on. */
    const pressedIn = (buttons, chosen) => buttons.forEach(([key, b]) => b.setAttribute('aria-pressed', String(key === chosen)));
    const toolButtons = [['pen', 'Pen'], ['highlighter', 'Highlighter'], ['arrow', 'Arrow']].map(([key, label]) => {
      const b = button(label, () => { tool = key; pressedIn(toolButtons, tool); swatchState(); say(SANDBOX_LINES[key]); }, { 'aria-pressed': String(key === tool) });
      return [key, b];
    });
    const swatches = SANDBOX_COLOURS.map(([hex, name]) => {
      const b = button('', () => { if (tool === 'highlighter') colours.highlighter = hex; else colours.pen = hex; swatchState(); }, { class: 'swatch', 'aria-label': name, title: `${name}, ${hex}`, 'aria-pressed': 'false' });
      b.style.setProperty('--swatch', hex);
      return [hex, b];
    });
    const swatchState = () => pressedIn(swatches, tool === 'highlighter' ? colours.highlighter : colours.pen);
    swatchState();
    const fadeName = 'sandbox-fade';
    const fades = [[0, 'Off'], [3, '3 s'], [8, '8 s'], [20, '20 s']].map(([s, label], i) => el('label', { class: 'radio' },
      el('input', Object.assign({ type: 'radio', name: fadeName, value: s }, i === 0 ? { checked: '' } : {})), ` ${label}`));
    const fadeSet = el('fieldset', { class: 'control-group' }, el('legend', { class: 'control-label', text: 'Fading ink' }), ...fades);
    fadeSet.addEventListener('change', () => { fade = Number(root.querySelector(`input[name="${fadeName}"]:checked`).value); say(SANDBOX_LINES.fade(fade)); });

    /* Each control first paints, which expires a mark whose time has passed, so that it acts on what the screen
       shows even when the browser has skipped frames. */
    const undoBtn = button('Undo', () => {
      render();
      const c = done.pop();
      if (!c) { say(SANDBOX_LINES.none('undo')); return; }
      c.undo(); undone.push(c); render(); describe(); say(SANDBOX_LINES.undo(items.length));
    });
    const redoBtn = button('Redo', () => {
      render();
      const c = undone.pop();
      if (!c) { say(SANDBOX_LINES.none('redo')); return; }
      c.redo(); done.push(c); render(); describe(); say(SANDBOX_LINES.redo(items.length));
    });
    const clearBtn = button('Clear', () => {
      render();
      if (!items.length) { say(SANDBOX_LINES.none('clear')); return; }
      const gone = [...items];
      exec({ items: gone, redo: () => { items.length = 0; }, undo: () => { items.push(...gone); } });
      say(SANDBOX_LINES.clear);
    });
    /* The picture as it stands, at twice the stand-in's size, with the "Demonstration" label painted in, and named so
       that it is not taken for a screenshot of the build. It is the visitor's own download: nothing is sent. */
    const saveBtn = button('Save as PNG', () => {
      const out = document.createElement('canvas');
      if (!out.toBlob) { say(SANDBOX_LINES.noPng); return; }
      out.width = W * 2; out.height = H * 2;
      const c = out.getContext('2d');
      c.setTransform(2, 0, 0, 2, 0, 0);
      paintStandIn(c, true);
      const now = performance.now();
      for (const item of items) { const alpha = alphaOf(item, now); if (alpha !== null) paintItem(c, item, alpha); }
      out.toBlob(blob => {
        if (!blob) { say(SANDBOX_LINES.noPng); return; }
        const name = `Showtrace demonstration ${stamp(new Date())}.png`;
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        say(SANDBOX_LINES.saved(name));
      }, 'image/png');
    });

    const tools = el('div', { class: 'sandbox-tools' },
      group('Tool', ...toolButtons.map(([, b]) => b)),
      group('Colour', ...swatches.map(([, b]) => b)),
      fadeSet,
      group('Marks', undoBtn, redoBtn, clearBtn),
      saveBtn);
    root.append(stageBox, state, tools);
    describe();

    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stageBox);
    else window.addEventListener('resize', resize);
    darkScheme.addEventListener('change', render);
    /* Paper takes the light stand-in; the screen gets its own back after. The tokens are set on the root only while
       the canvas paints, before the browser paints anything else. */
    window.addEventListener('beforeprint', () => {
      const light = darkScheme.matches && lightTokens();
      if (!light) return;
      const names = Array.from(light).filter(n => n.startsWith('--screen-') || n.startsWith('--demo-label-'));
      const rootStyle = document.documentElement.style;
      for (const n of names) rootStyle.setProperty(n, light.getPropertyValue(n));
      render();
      for (const n of names) rootStyle.removeProperty(n);
      /* The root had no style attribute; Chromium writes one back from the emptied inline style when it is next
         read, so it is read once before it goes. */
      if (!rootStyle.length) { document.documentElement.getAttribute('style'); document.documentElement.removeAttribute('style'); }
    });
    window.addEventListener('afterprint', render);
    resize();
  }

  /* ---------- Start ---------- */

  function init() {
    for (const card of document.querySelectorAll('[data-demo]')) mount(card);
    const box = document.querySelector('[data-sandbox]');
    if (!box) return;
    const before = [...box.childNodes];
    try {
      sandbox(box);
    } catch (error) {
      for (const node of [...box.childNodes]) if (!before.includes(node)) node.remove();
      console.error('Showtrace: the sandbox stopped with an error; its section shows its text only.', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
