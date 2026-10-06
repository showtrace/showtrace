/* Showtrace website: the demonstrations and the sandbox.

   One script, served by the site itself, loaded as an enhancement: the page reads and works without it. It reads the
   feature cards in index.html (data-demo, data-rows, data-status) and mounts one demonstration per card, drawn in the
   browser on a neutral stand-in screen. What the demonstrations show follows the design spec of the build (the spec
   of 2026-09-15 in docs/specs/ of the Showtrace repository) and its README; the numbers below carry the section they
   come from.

   Motion: each demonstration plays once when it comes into view and again on "Play again"; nothing loops; under
   prefers-reduced-motion only the end state shows; when the tab is hidden a play stops at its end state. The signature
   stroke (brand.md, section 6.6) is CSS; the script only starts it on a step being added to the trace.

   Nothing leaves the browser: no request, no storage, no cookie. The sandbox's PNG is the visitor's own download. */

(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CANCEL = Symbol('cancelled');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  /* The build's ink and sizes (spec 5.4, 5.6, 6.4, 6.6, 6.7, 7.1). The brand teal is never ink (brand.md, 6.2). */
  const INK = { pen: '#FF3B30', highlighter: '#FFCC00', laser: '#FF1E1E', halo: '#FFCC00' };
  const PEN_WIDTH = 4;
  const HIGHLIGHTER_FACTOR = 3;
  const HIGHLIGHTER_OPACITY = 0.35;
  const FADE_OUT_MS = 600;
  const LASER = { dot: 10, trail: 6, trailMs: 1500 };
  const HALO = { diameter: 40, opacity: 0.4 };
  /* The lens is 320 px on the real screen (spec 6.7); the stand-in screen is not to scale. */
  const LENS = { size: 200, start: 2 };
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

  function group(label, ...children) {
    return el('div', { class: 'control-group', role: 'group', 'aria-label': label }, el('span', { class: 'control-label', text: label }), ...children);
  }

  const round = v => Math.round(v * 10) / 10;

  /* ---------- Timing ---------- */

  const linear = t => t;
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const P = (x, y) => ({ x, y });

  /* One play of a demonstration. An instant run shows the end state at once (reduced motion, a hidden tab). */
  class Run {
    constructor(instant) {
      this.instant = instant;
      this.cancelled = false;
      this.frame = 0;
      this.timer = 0;
      this.reject = null;
    }

    cancel() {
      this.cancelled = true;
      if (this.frame) cancelAnimationFrame(this.frame);
      if (this.timer) clearTimeout(this.timer);
      const reject = this.reject;
      this.reject = null;
      if (reject) reject(CANCEL);
    }

    /* Calls fn(progress) every frame for ms milliseconds, progress eased from 0 to 1. */
    tween(ms, fn, ease = easeInOut) {
      if (this.cancelled) return Promise.reject(CANCEL);
      if (this.instant || ms <= 0) { fn(1); return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        this.reject = reject;
        const start = performance.now();
        const step = now => {
          const t = Math.min(1, (now - start) / ms);
          fn(ease(t));
          if (t < 1) { this.frame = requestAnimationFrame(step); return; }
          this.frame = 0;
          this.reject = null;
          resolve();
        };
        this.frame = requestAnimationFrame(step);
      });
    }

    /* A pause in the choreography. Skipped in an instant run. */
    pause(ms) {
      if (this.cancelled) return Promise.reject(CANCEL);
      if (this.instant) return Promise.resolve();
      return this.hold(ms);
    }

    /* Time the build itself takes, such as the wait before fading ink goes. Kept in an instant run. */
    hold(ms) {
      if (this.cancelled) return Promise.reject(CANCEL);
      return new Promise((resolve, reject) => {
        this.reject = reject;
        this.timer = setTimeout(() => { this.timer = 0; this.reject = null; resolve(); }, ms);
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

  /* The build's arrow head: at the end point, at least 12 px, 4 times the width, 28 degrees each side (ShapeGeometry). */
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

  /* 640 by 400 units: a neutral window with a menu bar, a side pane, text lines, a panel and a button. Grey shapes
     only, so that it never reads as a screenshot. The places a demonstration points at. */
  const LAYOUT = {
    bar: { x: 0, y: 0, w: 640, h: 36 },
    menus: [{ x: 16, y: 12, w: 36, h: 12 }, { x: 64, y: 12, w: 36, h: 12 }, { x: 112, y: 12, w: 44, h: 12 }],
    side: { x: 0, y: 36, w: 150, h: 364 },
    sideLines: [60, 84, 108, 132, 156].map(y => ({ x: 18, y, w: 100, h: 10 })),
    lines: [[64, 300], [86, 380], [108, 260], [130, 340], [152, 200]].map(([y, w]) => ({ x: 182, y, w, h: 10 })),
    panel: { x: 182, y: 190, w: 290, h: 130 },
    panelLines: [[210, 180], [232, 230], [254, 150]].map(([y, w]) => ({ x: 200, y, w, h: 10 })),
    button: { x: 500, y: 318, w: 112, h: 36 },
    buttonLabel: { x: 526, y: 333, w: 60, h: 6 },
    dropdown: { x: 16, y: 36, w: 150, h: 120 },
    dropdownItems: [48, 72, 96, 120].map(y => ({ x: 30, y, w: 90, h: 10 })),
  };

  /* The stand-in as one list of shapes in painting order, so that the demonstrations (SVG, blocks) and the sandbox
     (a canvas, paintStandIn) paint the same screen. A shape of class sc-NAME is filled with the colour token
     --screen-NAME of styles.css: by the stylesheet in an SVG, and read from it on a canvas. */
  const shape = (cls, b, r = 0, name = '') => ({ cls, b, r, name });
  const SHAPES = [
    shape('sc-bg', { x: 0, y: 0, w: 640, h: 400 }),
    shape('sc-side', LAYOUT.side),
    shape('sc-bar', LAYOUT.bar),
    ...LAYOUT.menus.map(b => shape('sc-block', b, 3)),
    ...LAYOUT.sideLines.map(b => shape('sc-line', b, 5)),
    ...LAYOUT.lines.map(b => shape('sc-line', b, 5)),
    shape('sc-panel', LAYOUT.panel, 8),
    ...LAYOUT.panelLines.map(b => shape('sc-line', b, 5)),
    shape('sc-button', LAYOUT.button, 6, 'button'),
    shape('sc-button-label', LAYOUT.buttonLabel, 3),
  ];
  /* The stand-in application's first menu, open. */
  const DROPDOWN = [shape('sc-dropdown', LAYOUT.dropdown, 6), ...LAYOUT.dropdownItems.map(b => shape('sc-line', b, 5))];

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
    for (const s of SHAPES) {
      c.fillStyle = token(`--screen-${s.cls.slice(3)}`);
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

  function stage(card, mount, opts) {
    const fig = el('figure', { class: 'demo' });
    const stageBox = el('div', { class: 'demo-stage' });
    const root = svg('svg', { viewBox: '0 0 640 400', role: 'img', 'aria-label': opts.alt, focusable: 'false' });
    stageBox.append(root, el('span', { class: 'demo-label', text: opts.label || 'Demonstration' }));
    const state = el('p', { class: 'demo-state', text: 'Plays when it comes into view.' });
    const controls = el('div', { class: 'demo-controls' });
    fig.append(stageBox, state, controls);
    mount.append(fig);
    const h = { card, fig, box: stageBox, svg: root, state, controls, extras: [], at: P(320, 200) };
    h.say = (...parts) => { state.replaceChildren(...parts.map(part => (typeof part === 'string' ? part : el('kbd', { text: part.key })))); };
    h.end = text => { h.say(text); root.setAttribute('aria-label', text); };
    return h;
  }

  /* Things a play adds outside the document: the laser, the halo, the lens, popups, the dim. Reset removes them. */
  function extra(h, node) { h.extras.push(node); return node; }
  function clearExtras(h) { for (const node of h.extras) node.remove(); h.extras = []; }

  /* ---------- The pointer ---------- */

  const POINTER = 'M0 0 L0 17 L4.6 13.2 L7.6 19.6 L10.3 18.4 L7.4 12 L12.6 12 Z';

  function addPointer(h, at) {
    h.pointer = svg('g', { class: 'pointer' }, svg('path', { d: POINTER }));
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

  /* A line, arrow, rectangle or ellipse dragged from one point to another, with a live preview (spec 6.4). */
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

  /* Text typed at a point, in the pen colour (spec 6.4). */
  async function drawText(run, h, at, str, o = {}) {
    const doc = o.doc || h.doc;
    const node = svg('text', { x: at.x, y: at.y, class: 'sc-text', fill: o.colour || INK.pen, 'font-size': o.size || 22 });
    await glide(run, h, at, 300);
    doc.add(node);
    await run.tween(o.ms || 700, t => { node.textContent = str.slice(0, Math.round(t * str.length)); }, linear);
    return node;
  }

  /* The laser (spec 6.6): a red dot at the pointer, a trail whose segments narrow and fade over 1.5 s, no ink. */
  async function laser(run, h, points, ms) {
    const g = extra(h, underPointer(h, svg('g', { class: 'laser' })));
    const trail = svg('g');
    const dot = svg('circle', { r: LASER.dot / 2, fill: INK.laser });
    g.append(trail, dot);
    h.pointer.setAttribute('visibility', 'hidden');
    const samples = [];
    const redraw = now => {
      trail.replaceChildren();
      for (let i = 1; i < samples.length; i++) {
        const strength = Math.max(0, 1 - (now - samples[i - 1].t) / LASER.trailMs);
        if (strength <= 0) continue;
        trail.append(svg('line', {
          x1: round(samples[i - 1].x), y1: round(samples[i - 1].y), x2: round(samples[i].x), y2: round(samples[i].y),
          stroke: INK.laser, 'stroke-width': round(LASER.trail * (0.3 + 0.7 * strength)), 'stroke-linecap': 'round', opacity: round(strength),
        }));
      }
      while (samples.length && now - samples[0].t >= LASER.trailMs) samples.shift();
    };
    const n = points.length;
    await run.tween(ms, t => {
      const p = points[Math.round(t * (n - 1))];
      const now = performance.now();
      samples.push({ x: p.x, y: p.y, t: now });
      attr(dot, { cx: round(p.x), cy: round(p.y) });
      h.at = p;
      redraw(now);
    });
    await run.tween(LASER.trailMs + 50, () => redraw(performance.now()), linear);
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
    const clipRect = svg('rect', { width: LENS.size, height: LENS.size, rx: 16 });
    const clip = svg('clipPath', { id }, clipRect);
    h.sc.defs.append(clip);
    const use = svg('use', { href: `#sc-${h.sc.id}` });
    const frame = svg('rect', { width: LENS.size, height: LENS.size, rx: 16, class: 'lens-frame' });
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

  function addGlow(h) {
    h.glowId = `glow-${h.sc.id}`;
    h.sc.defs.append(svg('filter', { id: h.glowId, x: '-20%', y: '-60%', width: '140%', height: '220%' },
      svg('feDropShadow', { dx: 0, dy: 0, stdDeviation: 5, 'flood-color': '#00E5FF', 'flood-opacity': 0.95 })));
  }

  /* ---------- The stand-in toolbar (spec 6.9) ---------- */

  const TOOLBAR_ITEMS = ['main', '|', 'mode', '|', 'pen', 'highlighter', 'eraser', '|', 'line', 'arrow', 'rectangle', 'ellipse', 'text', '|',
    'laser', 'magnifier', 'halo', '|', 'colour', 'width', '|', 'fade', 'undo', 'redo', 'clear', 'clearmenu', '|', 'board', 'capture', 'menu'];
  const TB = { size: 20, gap: 2, pad: 4, sep: 6, narrow: 10 };

  /* Glyphs on a 20 by 20 grid, 2 px strokes, round caps (brand.md, 6.5). Stand-ins for the icons of the build. */
  const GLYPHS = {
    pen: 'M4 16 L5 12.5 L13 4.5 L15.5 7 L7.5 15 Z M11.5 6 L14 8.5',
    highlighter: 'M6 13 L12.5 6.5 L15.5 9.5 L9 16 L6 16 Z M3 18.5 L17 18.5',
    eraser: 'M3.5 12.5 L10.5 5.5 L16 11 L10.5 16.5 L7.5 16.5 L3.5 12.5 Z M7.5 16.5 L16.5 16.5',
    line: 'M4 16 L16 4',
    arrow: 'M4 16 L16 4 M9.5 4 L16 4 L16 10.5',
    rectangle: 'M4 5 L16 5 L16 15 L4 15 Z',
    ellipse: 'M16 10 A6 6 0 1 1 4 10 A6 6 0 1 1 16 10',
    text: 'M5 5 L15 5 M10 5 L10 16',
    magnifier: 'M12.3 12.3 L17 17 M13.5 8.5 A5 5 0 1 1 3.5 8.5 A5 5 0 1 1 13.5 8.5',
    fade: 'M15.5 11.5 A5.5 5.5 0 1 1 4.5 11.5 A5.5 5.5 0 1 1 15.5 11.5 M10 8.5 L10 11.5 L12.5 13 M8 3.5 L12 3.5 M10 3.5 L10 6',
    undo: 'M4.5 9 L4.5 4.5 M4.5 9 L9 9 M4.5 9 C6.5 6, 9.5 5, 12 6 C15.5 7.5, 16 12.5, 13 14.8 C11.5 16, 9 16, 7.5 15',
    redo: 'M15.5 9 L15.5 4.5 M15.5 9 L11 9 M15.5 9 C13.5 6, 10.5 5, 8 6 C4.5 7.5, 4 12.5, 7 14.8 C8.5 16, 11 16, 12.5 15',
    clear: 'M4.5 6 L15.5 6 M8 6 L8 4 L12 4 L12 6 M6 6 L7 16.5 L13 16.5 L14 6 M8.5 9 L8.5 13.5 M11.5 9 L11.5 13.5',
    clearmenu: 'M2 7.5 L5 10.5 L8 7.5',
    board: 'M3.5 4.5 L16.5 4.5 L16.5 13.5 L3.5 13.5 Z M10 13.5 L10 17 M7 17 L13 17',
    capture: 'M3.5 7 L7 7 L8.5 4.5 L11.5 4.5 L13 7 L16.5 7 L16.5 15.5 L3.5 15.5 Z M12.6 11 A2.6 2.6 0 1 1 7.4 11 A2.6 2.6 0 1 1 12.6 11',
    menu: 'M4 6 L16 6 M4 10 L16 10 M4 14 L16 14',
  };

  function glyph(id, state) {
    const g = svg('g', { class: 'tb-glyph' });
    switch (id) {
      case 'main':
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

  function toolbar(h, opts) {
    const g = svg('g', { class: 'tb tb-auto' });
    h.sc.overlay.append(g);
    const state = Object.assign({ x: 320, y: 6, scale: 0.6, vertical: false, collapsed: false, hidden: false, theme: 'auto', active: null, draw: false, colour: INK.pen, width: PEN_WIDTH, on: {} }, opts);
    const centres = new Map();
    let size = { w: 0, h: 0 };

    function render() {
      g.replaceChildren();
      centres.clear();
      g.setAttribute('class', `tb tb-${state.theme}`);
      if (state.hidden) { g.setAttribute('display', 'none'); return; }
      g.removeAttribute('display');
      const items = state.collapsed ? ['main'] : TOOLBAR_ITEMS;
      const slots = [];
      let along = TB.pad;
      for (const id of items) {
        const w = id === '|' ? TB.sep : id === 'clearmenu' ? TB.narrow : TB.size;
        slots.push({ id, at: along, w });
        along += w + (id === '|' ? 0 : TB.gap);
      }
      along += TB.pad - TB.gap;
      const thickness = TB.pad * 2 + TB.size;
      size = state.vertical ? { w: thickness, h: along } : { w: along, h: thickness };
      g.append(svg('rect', { class: 'tb-shell', width: size.w, height: size.h, rx: 8, filter: state.draw ? `url(#${h.glowId})` : null }));
      for (const slot of slots) {
        const x = state.vertical ? TB.pad : slot.at, y = state.vertical ? slot.at : TB.pad;
        if (slot.id === '|') {
          g.append(state.vertical
            ? svg('line', { class: 'tb-sep', x1: TB.pad + 3, y1: y + 3, x2: TB.pad + TB.size - 3, y2: y + 3 })
            : svg('line', { class: 'tb-sep', x1: x + 3, y1: TB.pad + 3, x2: x + 3, y2: TB.pad + TB.size - 3 }));
          continue;
        }
        const bw = state.vertical ? TB.size : slot.w, bh = state.vertical ? slot.w : TB.size;
        const tone = state.active === slot.id || state.on[slot.id] === 'tint' ? 'tb-active' : 'tb-plain';
        g.append(svg('rect', { x, y, width: bw, height: bh, rx: 5, class: tone }));
        const node = glyph(slot.id, state);
        const gw = slot.id === 'clearmenu' ? TB.narrow : TB.size;
        node.setAttribute('transform', `translate(${x + (bw - gw) / 2} ${y + (bh - TB.size) / 2})`);
        if (state.on[slot.id] === true || (slot.id === 'mode' && state.draw)) node.classList.add('tb-accent');
        g.append(node);
        centres.set(slot.id, P(x + bw / 2, y + bh / 2));
      }
      g.setAttribute('transform', `translate(${round(state.x - (size.w * state.scale) / 2)} ${round(state.y)}) scale(${state.scale})`);
    }

    render();
    return {
      g, state,
      set(changes) { Object.assign(state, changes); render(); },
      /* Screen coordinates of a button's centre, for a pointer to go to. */
      centre(id) {
        const c = centres.get(id);
        if (!c) return P(state.x, state.y);
        return P(state.x - (size.w * state.scale) / 2 + c.x * state.scale, state.y + c.y * state.scale);
      },
      bottom() { return state.y + size.h * state.scale; },
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

  /* 1. Draw on the live screen. */
  const drawDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration draws seven kinds of marks on it.' });
      h.sc = screen(h.svg, 'draw');
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(400, 240));
      const note = () => h.say(`${h.doc.count} ${h.doc.count === 1 ? 'mark' : 'marks'} on the screen.`);
      h.controls.append(
        button('Undo', () => { if (h.doc.undo()) note(); }),
        button('Redo', () => { if (h.doc.redo()) note(); }),
        button('Clear', () => { if (h.doc.clear()) h.say('Cleared. Undo brings the marks back in one step.'); }));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ active: null }); movePointer(h, P(400, 240)); },
    async play(run, h) {
      h.tb.set({ active: 'pen' });
      h.say('Pen: a smooth stroke, 4 px, in the pen colour.');
      await drawStroke(run, h, curve(P(190, 172), P(250, 160), P(330, 184), P(400, 170), 36, 1.2), { ms: 900 });
      await run.pause(300);
      h.tb.set({ active: 'highlighter' });
      h.say('Highlighter: three times wider, translucent, flat ends.');
      await drawStroke(run, h, curve(P(186, 91), P(280, 90), P(380, 92), P(470, 91), 24, 0.5), { highlighter: true, ms: 700 });
      await run.pause(300);
      h.tb.set({ active: 'line' });
      h.say('Line. Hold Shift for 45 degree steps.');
      await drawShape(run, h, 'line', P(560, 120), P(480, 190), { ms: 500 });
      await run.pause(300);
      h.tb.set({ active: 'arrow' });
      h.say('Arrow: the head sits at the end and grows with the width.');
      await drawShape(run, h, 'arrow', P(430, 384), P(496, 340), { ms: 600 });
      await run.pause(300);
      h.tb.set({ active: 'rectangle' });
      h.say('Rectangle. Hold Shift for a square.');
      await drawShape(run, h, 'rectangle', P(172, 180), P(482, 330), { ms: 600 });
      await run.pause(300);
      h.tb.set({ active: 'ellipse' });
      h.say('Ellipse. Hold Shift for a circle.');
      await drawShape(run, h, 'ellipse', P(8, 100), P(130, 126), { ms: 600 });
      await run.pause(300);
      h.tb.set({ active: 'text' });
      h.say('Text: click to type. Click the text later to edit, move or resize it.');
      await drawText(run, h, P(500, 272), 'Click here', { ms: 700 });
      await glide(run, h, P(590, 250), 300);
      await run.pause(400);
      h.tb.set({ active: null });
      h.say('Undo takes the text back.');
      await run.pause(300);
      h.doc.undo();
      await run.pause(700);
      h.say('Redo brings it back.');
      h.doc.redo();
      await run.pause(600);
      h.end('Seven kinds of marks on the live screen, on top of any application. Undo, redo and clear below work on them.');
    },
  };

  /* 2. Point: laser, halo, magnifier. */
  const pointDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration shows the laser pointer, the cursor halo and the magnifier lens.' });
      h.sc = screen(h.svg, 'point');
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(200, 120));
      return h;
    },
    reset(h) {
      h.doc.reset(); clearExtras(h);
      h.halo = null; h.lens = null; h.lensLocked = false;
      h.pointer.removeAttribute('visibility');
      h.tb.set({ active: null, on: {} });
      movePointer(h, P(200, 120));
    },
    async play(run, h) {
      h.tb.set({ active: 'laser' });
      h.say('Laser: a red dot that hides the pointer, with a trail that fades in 1.5 s. It leaves no ink.');
      await laser(run, h, curve(P(200, 120), P(430, 40), P(230, 330), P(470, 220), 60), 2200);
      await run.pause(200);
      h.tb.set({ active: null, on: { halo: 'tint' } });
      h.extras.find(n => n.classList && n.classList.contains('laser'))?.remove();
      h.pointer.removeAttribute('visibility');
      addHalo(h);
      h.say('Halo: a 40 px circle around the pointer, in every mode, visible in a recording.');
      await glide(run, h, P(540, 336), 900);
      await run.pause(400);
      h.tb.set({ active: 'magnifier', on: { halo: 'tint' } });
      addLens(h);
      h.say('Magnifier: a lens over the pointer at 2x. The wheel zooms from 1.5x to 8x in steps of 0.5x.');
      await glide(run, h, P(330, 236), 900);
      await run.pause(300);
      h.say('Wheel: 4x.');
      await run.tween(500, t => { h.zoom = 2 + Math.round(t * 4) * 0.5; h.lens.set(h.at.x, h.at.y, h.zoom); }, linear);
      await run.pause(500);
      h.say('Click: the lens stays where it is, showing that spot live, while the pointer moves on.');
      h.lensLocked = true;
      await glide(run, h, P(250, 120), 900);
      await run.pause(300);
      h.end('Laser, halo and magnifier. The lens is locked at 4x; a click lets it go. The stand-in is not to scale: the real lens is 320 px.');
    },
  };

  /* 3. Fading ink. */
  const fadeDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration draws a circle that fades after 3, 8 or 20 seconds.' });
      h.sc = screen(h.svg, 'fade');
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(420, 250));
      const name = 'fade-choice';
      h.choice = () => Number(h.card.querySelector(`input[name="${name}"]:checked`).value);
      const radios = [3, 8, 20].map((s, i) => el('label', { class: 'radio' },
        el('input', Object.assign({ type: 'radio', name, value: s }, i === 0 ? { checked: '' } : {})), ` ${s} s`));
      const set = el('fieldset', { class: 'control-group' }, el('legend', { class: 'control-label', text: 'Fades after' }), ...radios);
      set.addEventListener('change', () => start(h));
      h.controls.append(set);
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ active: null, on: {} }); movePointer(h, P(420, 250)); },
    async play(run, h) {
      const seconds = h.choice();
      h.tb.set({ active: 'ellipse', on: { fade: true } });
      h.say(`Fading ink is on, ${seconds} s. The circle goes round the button.`);
      const node = await drawShape(run, h, 'ellipse', P(488, 306), P(624, 366), { ms: 800 });
      for (let left = seconds; left > 0; left--) {
        h.say(`Drawn with fading ink. It fades after ${seconds} s: gone in ${left} s.`);
        await run.hold(1000);
      }
      h.say('Fading out, 600 ms.');
      await run.tween(FADE_OUT_MS, t => node.setAttribute('opacity', round(1 - t)), linear);
      h.doc.purge(node);
      h.end(`Gone after ${seconds} s. The spot is clean again, and undo does not bring the circle back.`);
    },
  };

  /* 4. Boards (spec 6.5). */
  const BOARDS = {
    white: { fill: '#FFFFFF', grid: null, label: 'Whiteboard' },
    black: { fill: '#000000', grid: null, label: 'Blackboard' },
    lightgrid: { fill: '#FFFFFF', grid: '#D9D9D9', label: 'Light grid' },
    darkgrid: { fill: '#000000', grid: '#404040', label: 'Dark grid' },
  };

  const boardsDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen with marks. The demonstration opens a whiteboard, a blackboard and two grids over it.' });
      h.sc = screen(h.svg, 'boards');
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      for (const [kind, b] of Object.entries(BOARDS)) {
        if (!b.grid) continue;
        h.sc.defs.append(svg('pattern', { id: `grid-${kind}`, width: 40, height: 40, patternUnits: 'userSpaceOnUse' },
          svg('path', { d: 'M40 0 H0 V40', fill: 'none', stroke: b.grid, 'stroke-width': 1 })));
      }
      h.boardFill = svg('rect', { width: 640, height: 400 });
      h.boardGrid = svg('rect', { width: 640, height: 400, fill: 'none' });
      h.boardMarks = svg('g', { class: 'marks' });
      h.board = svg('g', { class: 'board', transform: 'translate(0 -400)' }, h.boardFill, h.boardGrid, h.boardMarks);
      h.sc.content.append(h.board);
      h.boardDoc = new Doc(h.boardMarks);
      h.open = null;
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(400, 240));
      h.buttons = {};
      const choose = kind => { h.run?.cancel(); h.run = null; setBoard(new Run(true), h, kind); h.say(kind ? `${BOARDS[kind].label}. Draw mode is on; the screen marks wait underneath.` : 'Board closed: the screen marks are back.'); };
      h.controls.append(group('Board',
        ...[['', 'None'], ...Object.entries(BOARDS).map(([k, b]) => [k, b.label])].map(([kind, label]) => {
          const b = button(label, () => choose(kind || null), { 'aria-pressed': 'false' });
          h.buttons[kind || 'none'] = b;
          return b;
        })));
      return h;
    },
    reset(h) {
      h.doc.reset(); h.boardDoc.reset(); clearExtras(h);
      h.open = null;
      h.board.setAttribute('transform', 'translate(0 -400)');
      h.tb.set({ active: null, on: {} });
      movePointer(h, P(400, 240));
      pressed(h);
    },
    async play(run, h) {
      h.tb.set({ active: 'pen' });
      h.say('Marks on the live screen.');
      await drawStroke(run, h, curve(P(190, 172), P(250, 160), P(330, 184), P(400, 170), 30, 1.2), { ms: 600 });
      await drawShape(run, h, 'arrow', P(430, 384), P(496, 340), { ms: 400 });
      await run.pause(400);
      h.say('Whiteboard, over the live screen on this monitor. Draw mode is on; the screen marks wait underneath.');
      await setBoard(run, h, 'white');
      await run.pause(300);
      await drawShape(run, h, 'rectangle', P(180, 110), P(290, 170), { doc: h.boardDoc, ms: 500 });
      await drawShape(run, h, 'rectangle', P(380, 230), P(490, 290), { doc: h.boardDoc, ms: 500 });
      await drawShape(run, h, 'arrow', P(292, 142), P(378, 228), { doc: h.boardDoc, ms: 500 });
      await run.pause(700);
      h.say('Blackboard: the same board ink.');
      await setBoard(run, h, 'black');
      await run.pause(1100);
      h.say('Light grid: 40 px squares.');
      await setBoard(run, h, 'lightgrid');
      await run.pause(1100);
      h.say('Dark grid.');
      await setBoard(run, h, 'darkgrid');
      await run.pause(1100);
      h.say('Board closed: the screen marks are back. The board ink waits for the next board.');
      await setBoard(run, h, null);
      await run.pause(300);
      h.end('A whiteboard, a blackboard, a light grid and a dark grid, each over the live screen of one monitor. The screen marks come back when the board closes; the buttons below open the boards.');
    },
  };

  function pressed(h) {
    for (const [kind, b] of Object.entries(h.buttons)) b.setAttribute('aria-pressed', String((h.open || 'none') === kind));
  }

  async function setBoard(run, h, kind) {
    const wasOpen = h.open !== null;
    h.open = kind;
    pressed(h);
    h.tb.set({ draw: true, on: { board: kind ? true : false } });
    if (kind) {
      const b = BOARDS[kind];
      h.boardFill.setAttribute('fill', b.fill);
      h.boardGrid.setAttribute('fill', b.grid ? `url(#grid-${kind})` : 'none');
      if (!wasOpen) await run.tween(320, t => h.board.setAttribute('transform', `translate(0 ${round(-400 * (1 - t))})`), t => 1 - Math.pow(1 - t, 3));
      return;
    }
    if (wasOpen) await run.tween(320, t => h.board.setAttribute('transform', `translate(0 ${round(-400 * t)})`), t => t * t * t);
  }

  /* 5. Screenshots with the marks (spec 6.8). */
  const captureDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen with marks. The demonstration drags a region and shows the screenshot as a thumbnail.' });
      h.sc = screen(h.svg, 'capture');
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(160, 60));
      h.thumb = el('div', { class: 'demo-thumb', hidden: '' });
      h.state.after(h.thumb);
      h.controls.append(button('Full screen', () => {
        h.run?.cancel(); h.run = null;
        showShot(h, { x: 0, y: 0, w: 640, h: 400 });
        h.say('Full screen: the monitor under the pointer, with the marks, without the toolbar and the pointer.');
      }));
      return h;
    },
    reset(h) {
      h.doc.reset(); clearExtras(h);
      h.thumb.hidden = true;
      h.thumb.replaceChildren();
      h.tb.set({ hidden: false, active: null });
      movePointer(h, P(160, 60));
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
      h.say('Screenshot, region. The toolbar hides, the screen dims, and you drag the region.');
      await run.pause(400);
      h.tb.set({ hidden: true });
      const mask = svg('path', { class: 'dim-mask' });
      const frame = svg('rect', { class: 'dim-frame' });
      const dim = extra(h, underPointer(h, svg('g', null, mask, frame)));
      const from = P(160, 60), to = P(600, 380);
      const hole = p => {
        const b = box(from, p);
        mask.setAttribute('d', `M0 0 H640 V400 H0 Z M${round(b.x)} ${round(b.y)} H${round(b.x + b.w)} V${round(b.y + b.h)} H${round(b.x)} Z`);
        attr(frame, { x: round(b.x), y: round(b.y), width: round(b.w), height: round(b.h) });
        return b;
      };
      hole(from);
      let region = null;
      await run.tween(1100, t => { const p = P(lerp(from.x, to.x, t), lerp(from.y, to.y, t)); movePointer(h, p); region = hole(p); });
      dim.remove();
      showShot(h, region);
      h.tb.set({ hidden: false });
      await run.pause(200);
      h.end('Saved. The marks and the board are in the picture; the toolbar and the pointer are not. To the clipboard, to a PNG in Pictures\\Showtrace, or both.');
    },
  };

  /* The screenshot as a thumbnail: the content of the stand-in screen, cropped to the region, named as the build names it. */
  function showShot(h, region) {
    const shot = svg('svg', { viewBox: `${round(region.x)} ${round(region.y)} ${round(region.w)} ${round(region.h)}`, class: 'thumb', 'aria-hidden': 'true', focusable: 'false' },
      svg('use', { href: `#sc-${h.sc.id}` }));
    h.thumb.replaceChildren(shot, el('span', { text: `Showtrace ${stamp(new Date())}.png` }));
    h.thumb.hidden = false;
  }

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
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true });
      addPointer(h, P(400, 250));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ draw: true, active: null }); h.sc.button.classList.remove('sc-pressed'); movePointer(h, P(400, 250)); },
    async play(run, h) {
      h.tb.set({ draw: true, active: 'arrow' });
      h.say('Draw mode: the toolbar glows, and the pointer draws on the screen.');
      await drawShape(run, h, 'arrow', P(400, 250), P(498, 330), { ms: 600 });
      await run.pause(500);
      h.say('Press ', { key: 'Escape' }, ', from inside any application: cursor mode. The marks stay; clicks go to the application.');
      h.tb.set({ draw: false, active: null });
      await run.pause(400);
      await glide(run, h, P(556, 336), 700);
      await press(run, h);
      h.say('The click reaches the button under the marks.');
      await run.pause(700);
      h.say('One click on a tool, and you draw again.');
      h.tb.set({ draw: true, active: 'ellipse' });
      await drawShape(run, h, 'ellipse', P(488, 306), P(624, 366), { ms: 600 });
      await run.pause(400);
      h.say('Hold ', { key: 'Ctrl' }, ' + ', { key: 'Alt' }, ' while drawing: for a moment, clicks pass through the marks.');
      await glide(run, h, P(556, 336), 600);
      await press(run, h);
      await run.pause(500);
      h.end('Explain and operate, in turns: draw mode, Escape for the pointer, Ctrl+Alt to click through the marks for a moment.');
    },
  };

  async function press(run, h) {
    h.sc.button.classList.add('sc-pressed');
    await run.pause(350);
    h.sc.button.classList.remove('sc-pressed');
  }

  /* 7. Across monitors (spec 6.12, ScreenMap). */
  const monitorsDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'Two stand-in monitors with different scaling. The demonstration draws a stroke from one onto the other.' });
      h.sc = monitors(h.svg, 'monitors');
      h.doc = new Doc(h.sc.marks);
      addPointer(h, P(60, 160));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); movePointer(h, P(60, 160)); },
    async play(run, h) {
      h.say('Two monitors with the same number of pixels: 100 percent scaling on the left, 150 percent on the right.');
      await run.pause(600);
      h.say('A stroke from one monitor onto the other.');
      await drawStroke(run, h, curve(P(60, 160), P(200, 110), P(400, 210), P(580, 150), 50, 1.2), { ms: 1400 });
      await run.pause(400);
      h.say('A rectangle across both. The copy on each monitor keeps the same physical width and place.');
      await drawShape(run, h, 'rectangle', P(170, 100), P(470, 215), { ms: 700 });
      await run.pause(300);
      h.end('Strokes and shapes continue across monitors, including mixed scaling. Text stays on one monitor.');
    },
  };

  /* 8. Colour and width (spec 6.9, items 6 and 7). */
  const colourDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen. The demonstration picks a colour from the palette, a width from the slider and a custom colour.' });
      h.sc = screen(h.svg, 'colour');
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true, scale: 0.75, active: 'pen' });
      addPointer(h, P(400, 240));
      h.sample = null;
      const apply = () => {
        if (!h.sample) return;
        h.sample.setAttribute('stroke', h.colour);
        h.sample.setAttribute('stroke-width', h.width);
        h.tb.set({ colour: h.colour, width: h.width });
        h.say(`The last stroke: ${h.colour}, ${h.width} px.`);
      };
      const swatches = PALETTE.map(hex => {
        const b = button('', () => { h.colour = hex; apply(); }, { class: 'swatch', 'aria-label': `Colour ${hex}` });
        b.style.setProperty('--swatch', hex);
        return b;
      });
      const range = el('input', { type: 'range', min: 1, max: 40, value: PEN_WIDTH, 'aria-label': 'Width, 1 to 40' });
      const out = el('output', { text: String(PEN_WIDTH) });
      range.addEventListener('input', () => { h.width = Number(range.value); out.textContent = range.value; apply(); });
      h.range = range; h.out = out;
      h.controls.append(group('Palette', ...swatches), group('Width', range, out));
      return h;
    },
    reset(h) {
      h.doc.reset(); clearExtras(h); h.sample = null;
      h.colour = INK.pen; h.width = PEN_WIDTH;
      h.range.value = String(PEN_WIDTH); h.out.textContent = String(PEN_WIDTH);
      h.tb.set({ colour: INK.pen, width: PEN_WIDTH, active: 'pen' });
      movePointer(h, P(400, 240));
    },
    async play(run, h) {
      h.say('The colour button opens the palette: 32 colours in four rows, recent custom colours, and Custom.');
      const cell = 14, gap = 3, pad = 6;
      const pal = popup(h, h.tb.centre('colour').x, pad * 2 + 8 * cell + 7 * gap, pad * 2 + 4 * cell + 3 * gap + 24);
      const swatches = PALETTE.map((hex, i) => svg('rect', { x: pal.x + pad + (i % 8) * (cell + gap), y: pal.y + pad + Math.floor(i / 8) * (cell + gap), width: cell, height: cell, rx: 3, fill: hex, class: 'tb-swatch' }));
      pal.g.append(...swatches,
        svg('rect', { class: 'tb-textbutton', x: pal.x + pad, y: pal.y + pal.h - pad - 16, width: 46, height: 16, rx: 4 }),
        svg('rect', { class: 'tb-textbutton', x: pal.x + pad + 52, y: pal.y + pal.h - pad - 16, width: 78, height: 16, rx: 4 }));
      const blue = 10;
      await glide(run, h, P(+swatches[blue].getAttribute('x') + cell / 2, +swatches[blue].getAttribute('y') + cell / 2), 700);
      swatches[blue].setAttribute('class', 'tb-swatch tb-swatch-on');
      await run.pause(400);
      pal.g.remove();
      h.colour = PALETTE[blue];
      h.tb.set({ colour: h.colour });
      h.say(`Picked ${h.colour}. Shapes and text take the pen colour too.`);
      await drawStroke(run, h, curve(P(200, 200), P(260, 170), P(340, 230), P(420, 200), 30, 1), { colour: h.colour, ms: 700 });
      await run.pause(400);
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
      await drawStroke(run, h, curve(P(200, 262), P(260, 232), P(340, 292), P(420, 262), 30, 1), { colour: h.colour, width: h.width, ms: 700 });
      await run.pause(400);
      h.say('Custom: any colour from a picker, or a hex value typed in.');
      const custom = '#5A2D82';
      const cp = popup(h, h.tb.centre('colour').x, 150, 60);
      const field = svg('rect', { class: 'tb-field', x: cp.x + 10, y: cp.y + 10, width: 130, height: 20, rx: 4 });
      const hex = svg('text', { class: 'tb-text', x: cp.x + 18, y: cp.y + 24 });
      cp.g.append(field, hex, svg('rect', { class: 'tb-textbutton', x: cp.x + 10, y: cp.y + 36, width: 60, height: 16, rx: 4 }));
      await run.tween(700, t => { hex.textContent = custom.slice(0, Math.round(t * custom.length)); }, linear);
      await run.pause(400);
      cp.g.remove();
      h.colour = custom;
      h.tb.set({ colour: custom });
      h.sample = await drawStroke(run, h, curve(P(200, 324), P(260, 294), P(340, 354), P(420, 324), 30, 1), { colour: custom, width: h.width, ms: 700 });
      h.range.value = String(h.width); h.out.textContent = String(h.width);
      await run.pause(200);
      h.end(`Three strokes: the palette blue, the same at width ${h.width}, and a custom colour. The palette and the slider below recolour and resize the last one.`);
    },
  };

  /* 9. The toolbar (spec 6.9). */
  const toolbarDemo = {
    build(card, mount) {
      const h = stage(card, mount, { alt: 'A stand-in screen with the toolbar. The demonstration shows it horizontal, vertical, collapsed and hidden, in the light, dark and auto themes.' });
      h.sc = screen(h.svg, 'toolbar');
      addGlow(h);
      h.doc = new Doc(h.sc.marks);
      h.tb = toolbar(h, { draw: true, scale: 0.85, y: 8 });
      addPointer(h, P(400, 260));
      h.buttons = {};
      const place = (name, changes, text) => { h.run?.cancel(); h.run = null; h.tb.set(changes); h.say(text); shown(h); };
      const shapes = [
        ['horizontal', 'Horizontal', { vertical: false, collapsed: false, hidden: false, x: 320, y: 8 }, 'Horizontal, at the top centre of the monitor.'],
        ['vertical', 'Vertical', { vertical: true, collapsed: false, hidden: false, x: 40, y: 50 }, 'Vertical.'],
        ['collapsed', 'Collapsed', { collapsed: true, hidden: false }, 'Collapsed to its main icon. A click expands it; a drag moves it.'],
        ['hidden', 'Hidden', { hidden: true }, 'Hidden, in ghost mode. A click on the tray icon brings it back.'],
      ];
      h.controls.append(group('Toolbar', ...shapes.map(([key, label, changes, text]) => {
        const b = button(label, () => place(key, changes, text), { 'aria-pressed': 'false' });
        h.buttons[key] = b;
        return b;
      })));
      h.controls.append(group('Theme', ...[['light', 'Light', 'Light theme.'], ['dark', 'Dark', 'Dark theme.'], ['auto', 'Auto', 'Auto follows the Windows app theme. Here it follows your browser.']].map(([key, label, text]) => {
        const b = button(label, () => place(key, { theme: key }, text), { 'aria-pressed': 'false' });
        h.buttons[key] = b;
        return b;
      })));
      return h;
    },
    reset(h) { h.doc.reset(); clearExtras(h); h.tb.set({ vertical: false, collapsed: false, hidden: false, theme: 'auto', draw: true, x: 320, y: 8 }); movePointer(h, P(400, 260)); shown(h); },
    async play(run, h) {
      const step = async (changes, text, ms) => { h.tb.set(changes); shown(h); h.say(text); await run.pause(ms); };
      await step({}, 'Horizontal, at the top centre of the primary monitor. In draw mode its border glows.', 1400);
      await step({ vertical: true, x: 40, y: 50 }, 'Vertical.', 1200);
      await step({ collapsed: true }, 'Collapsed to its main icon. A click expands it; a drag moves it.', 1200);
      await step({ hidden: true }, 'Hidden, in ghost mode. A click on the tray icon brings it back.', 1200);
      await step({ hidden: false, collapsed: false, vertical: false, x: 320, y: 8 }, 'Back, where you left it.', 1000);
      await step({ theme: 'light' }, 'Light theme.', 1000);
      await step({ theme: 'dark' }, 'Dark theme.', 1000);
      await step({ theme: 'auto' }, 'Auto follows the Windows app theme. Here it follows your browser.', 600);
      h.end('The toolbar: horizontal, vertical, collapsed or hidden; light, dark or auto. It remembers where you leave it. The buttons below change it.');
    },
  };

  function shown(h) {
    const s = h.tb.state;
    const shape = s.hidden ? 'hidden' : s.collapsed ? 'collapsed' : s.vertical ? 'vertical' : 'horizontal';
    for (const [key, b] of Object.entries(h.buttons)) b.setAttribute('aria-pressed', String(key === shape || key === s.theme));
  }

  /* 10 and 11. The trace (planned) and two authors (phase 2): steps added with the signature stroke (brand.md, 6.6 and 7). */
  const STEP_STROKE = 'M3 19 C5 11, 9 5, 13 6 C17 7, 15 13, 12 12 C9 11, 11 7, 15 8 C18 9, 20 14, 20.5 18';

  function traceDemo(kind) {
    const phase2 = kind === 'authors';
    return {
      build(card, mount) {
        const h = stage(card, mount, {
          alt: phase2 ? 'A stand-in screen next to a trace with two authors. Phase 2: a demonstration, no agent is connected.' : 'A stand-in screen next to a trace of three steps. Planned: a demonstration of the shape of the trace.',
          label: phase2 ? 'Demonstration. Phase 2' : 'Demonstration. Planned',
        });
        h.sc = screen(h.svg, kind);
        h.doc = new Doc(h.sc.marks);
        addPointer(h, P(360, 260));
        h.steps = [...card.querySelectorAll('.steps .step')];
        for (const li of h.steps) {
          const author = li.querySelector('.step-author');
          const old = author && author.querySelector('.dot, .ring');
          const ai = !!(old && old.classList.contains('ring'));
          li.dataset.ai = ai ? 'yes' : 'no';
          const mark = svg('svg', { class: `step-mark ${ai ? 'ai' : 'person'}`, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
            svg('path', { class: 'step-stroke', pathLength: 100, d: STEP_STROKE }),
            svg('circle', { class: ai ? 'step-ring' : 'step-dot', cx: 20.5, cy: 18, r: 3 }));
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
        const reveal = li => { li.classList.remove('step-hidden'); if (run.instant) li.classList.add('is-instant'); li.classList.add('is-drawn'); };
        h.say('Step 1. The teacher circles the File menu. The mark becomes a numbered step with its author and reason.');
        reveal(h.steps[0]);
        await drawShape(run, h, 'ellipse', P(6, 2), P(62, 34), { ms: 700, approach: 500 });
        h.sc.openMenu();
        await run.pause(900);
        const second = h.steps[1];
        const ai = second && second.dataset.ai === 'yes';
        h.say(ai ? 'Step 2. AI (Copilot) selects Export: a dashed mark, an open ring at the click, and the label AI.' : 'Step 2. The teacher points at Export. The reason is in the teacher\'s own words.');
        if (second) reveal(second);
        await drawShape(run, h, 'arrow', P(160, 160), P(122, 104), ai ? { cls: 'ai-ink', dashed: true, ring: true, ms: 600 } : { ms: 600 });
        await run.pause(900);
        h.say('Step 3. The teacher saves the file as PDF.');
        if (h.steps[2]) reveal(h.steps[2]);
        await drawShape(run, h, 'rectangle', P(492, 310), P(620, 362), { ms: 600 });
        await run.pause(600);
        h.end(phase2
          ? 'Two authors in one trace: a filled dot and solid marks for the teacher, an open ring and dashed marks for the AI. Phase 2: no agent is connected.'
          : 'Three steps in order, each with what was done, who did it and why. Planned: the build does not keep steps yet.');
      },
    };
  }

  const DEMOS = {
    draw: drawDemo, point: pointDemo, fade: fadeDemo, boards: boardsDemo, capture: captureDemo, modes: modesDemo,
    monitors: monitorsDemo, colour: colourDemo, toolbar: toolbarDemo, trace: traceDemo('trace'), authors: traceDemo('authors'),
  };

  /* ---------- Mounting, playing once in view, stopping when hidden ---------- */

  const mounted = [];

  function start(h, instant = false) {
    if (h.run) h.run.cancel();
    h.demo.reset(h);
    const run = new Run(instant || reducedMotion.matches || document.hidden);
    h.run = run;
    h.demo.play(run, h)
      .catch(error => { if (error !== CANCEL) console.error(error); })
      .finally(() => { if (h.run === run) h.run = null; });
  }

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const h = mounted.find(m => m.box === entry.target);
      if (!h || h.played) continue;
      h.played = true;
      observer.unobserve(entry.target);
      start(h);
    }
  }, { threshold: 0.35 }) : null;

  function mountAll() {
    for (const card of document.querySelectorAll('[data-demo]')) {
      const demo = DEMOS[card.dataset.demo];
      const mount = card.querySelector('.feature-demo');
      if (!demo || !mount) continue;
      const h = demo.build(card, mount);
      h.demo = demo;
      h.run = null;
      h.played = false;
      h.controls.prepend(button('Play again', () => start(h)));
      demo.reset(h);
      mounted.push(h);
      if (observer) observer.observe(h.box); else start(h, true);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const h of mounted) if (h.run) { h.run.cancel(); start(h, true); }
  });

  /* ---------- The sandbox: draw on the stand-in screen, save a PNG ---------- */

  const SCREEN_COLOURS = {
    light: { 'sc-bg': '#ECECEC', 'sc-bar': '#E0E0E0', 'sc-side': '#E4E4E4', 'sc-block': '#CDCDCD', 'sc-line': '#D4D4D4', 'sc-panel': '#F4F4F4', 'sc-button': '#BDBDBD', 'sc-button-label': '#8E8E8E', label: '#1A1F24', labelText: '#FFFFFF' },
    dark: { 'sc-bg': '#2E2E2E', 'sc-bar': '#383838', 'sc-side': '#333333', 'sc-block': '#4A4A4A', 'sc-line': '#444444', 'sc-panel': '#363636', 'sc-button': '#5A5A5A', 'sc-button-label': '#8A8A8A', label: '#EEEEEE', labelText: '#1A1F24' },
  };
  const SANDBOX_COLOURS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#AF52DE', '#000000', '#FFFFFF'];

  function sandbox(root) {
    const W = 640, H = 400;
    const canvas = el('canvas', { class: 'sandbox-canvas', role: 'img', 'aria-label': 'A stand-in screen to draw on. No marks yet.' });
    const stageBox = el('div', { class: 'demo-stage sandbox-stage' }, canvas, el('span', { class: 'demo-label', text: 'Demonstration' }));
    const state = el('p', { class: 'demo-state', text: 'Draw with a mouse, a pen or a finger. The marks stay in this page only.' });
    const ctx = canvas.getContext('2d');
    let scale = 1, dpr = 1;
    const items = [];
    let done = [], undone = [], current = null, frame = 0;
    let tool = 'pen', fade = 0;
    const colours = { pen: INK.pen, highlighter: INK.highlighter };

    function palette() { return SCREEN_COLOURS[darkScheme.matches ? 'dark' : 'light']; }

    function paintScreen(c, k) {
      paintStandIn(c, k);
    }

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
      c.fill();
    }

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
        const pts = item.committed ? smooth(item.points) : item.points;
        pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        if (pts.length === 1) c.lineTo(pts[0].x + 0.1, pts[0].y);
      }
      c.stroke();
      c.globalAlpha = 1;
    }

    function render() {
      const now = performance.now();
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      paintScreen(ctx, false);
      let fading = false;
      for (const item of [...items]) {
        const alpha = alphaOf(item, now);
        if (alpha === null) { expire(item); continue; }
        if (item.fadeAfter) fading = true;
        paintItem(ctx, item, alpha);
      }
      if (current) paintItem(ctx, current, 1);
      if (fading && !frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
    }

    function expire(item) {
      items.splice(items.indexOf(item), 1);
      done = done.filter(c => !c.items.includes(item));
      undone = undone.filter(c => !c.items.includes(item));
      describe();
    }

    function describe() {
      const strokes = items.filter(i => i.kind === 'stroke' && !i.highlighter).length;
      const marks = items.filter(i => i.highlighter).length;
      const arrows = items.filter(i => i.kind === 'arrow').length;
      const parts = [];
      if (strokes) parts.push(`${strokes} pen ${strokes === 1 ? 'stroke' : 'strokes'}`);
      if (marks) parts.push(`${marks} highlighter ${marks === 1 ? 'stroke' : 'strokes'}`);
      if (arrows) parts.push(`${arrows} ${arrows === 1 ? 'arrow' : 'arrows'}`);
      canvas.setAttribute('aria-label', parts.length ? `A stand-in screen with ${parts.join(', ')}.` : 'A stand-in screen to draw on. No marks yet.');
    }

    function exec(command) { command.redo(); done.push(command); undone = []; render(); describe(); }

    function commit(item) {
      item.committed = true;
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

    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic event has no pointer to capture */ }
      const p = pos(e);
      current = tool === 'arrow' ? Object.assign({ kind: 'arrow', from: p, to: p }, style()) : Object.assign({ kind: 'stroke', points: [p] }, style());
      render();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!current) return;
      const p = pos(e);
      if (current.kind === 'arrow') current.to = p;
      else { const last = current.points[current.points.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) current.points.push(p); }
      render();
    });
    const finish = () => {
      if (!current) return;
      const item = current;
      current = null;
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

    /* Controls. */
    const pressedIn = (buttons, chosen) => buttons.forEach(([key, b]) => b.setAttribute('aria-pressed', String(key === chosen)));
    const toolButtons = [['pen', 'Pen'], ['highlighter', 'Highlighter'], ['arrow', 'Arrow']].map(([key, label]) => {
      const b = button(label, () => { tool = key; pressedIn(toolButtons, tool); swatchState(); }, { 'aria-pressed': String(key === tool) });
      return [key, b];
    });
    const swatches = SANDBOX_COLOURS.map(hex => {
      const b = button('', () => { if (tool === 'highlighter') colours.highlighter = hex; else colours.pen = hex; swatchState(); }, { class: 'swatch', 'aria-label': `Colour ${hex}`, 'aria-pressed': 'false' });
      b.style.setProperty('--swatch', hex);
      return [hex, b];
    });
    const swatchState = () => pressedIn(swatches, tool === 'highlighter' ? colours.highlighter : colours.pen);
    swatchState();
    const fadeName = 'sandbox-fade';
    const fades = [[0, 'Off'], [3, '3 s'], [8, '8 s'], [20, '20 s']].map(([s, label], i) => el('label', { class: 'radio' },
      el('input', Object.assign({ type: 'radio', name: fadeName, value: s }, i === 0 ? { checked: '' } : {})), ` ${label}`));
    const fadeSet = el('fieldset', { class: 'control-group' }, el('legend', { class: 'control-label', text: 'Fading ink' }), ...fades);
    fadeSet.addEventListener('change', () => { fade = Number(root.querySelector(`input[name="${fadeName}"]:checked`).value); });

    const undoBtn = button('Undo', () => { const c = done.pop(); if (!c) return; c.undo(); undone.push(c); render(); describe(); });
    const redoBtn = button('Redo', () => { const c = undone.pop(); if (!c) return; c.redo(); done.push(c); render(); describe(); });
    const clearBtn = button('Clear', () => { if (!items.length) return; const gone = [...items]; exec({ items: gone, redo: () => { items.length = 0; }, undo: () => { items.push(...gone); } }); });
    const saveBtn = button('Save as PNG', () => {
      const out = document.createElement('canvas');
      out.width = W * 2; out.height = H * 2;
      const c = out.getContext('2d');
      c.setTransform(2, 0, 0, 2, 0, 0);
      paintScreen(c, true);
      const now = performance.now();
      for (const item of items) { const alpha = alphaOf(item, now); if (alpha !== null) paintItem(c, item, alpha); }
      out.toBlob(blob => {
        if (!blob) { state.textContent = 'The browser could not make the PNG.'; return; }
        const name = `Showtrace demonstration ${stamp(new Date())}.png`;
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        state.textContent = `Saved as ${name}, as a download from your browser. Nothing was sent or stored.`;
      }, 'image/png');
    });

    const tools = el('div', { class: 'sandbox-tools' },
      group('Tool', ...toolButtons.map(([, b]) => b)),
      group('Colour', ...swatches.map(([, b]) => b)),
      fadeSet,
      group('Marks', undoBtn, redoBtn, clearBtn),
      group('Keep', saveBtn));
    root.append(tools, stageBox, state);

    new ResizeObserver(resize).observe(stageBox);
    darkScheme.addEventListener('change', render);
    resize();
  }

  /* ---------- Start ---------- */

  function init() {
    mountAll();
    const box = document.querySelector('[data-sandbox]');
    if (box) sandbox(box);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
