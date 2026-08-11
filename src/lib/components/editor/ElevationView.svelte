<script lang="ts">
  /**
   * ElevationView — integrated face-on view + editor for a single wall.
   * Fills the canvas area (replaces the plan canvas while active — sidebars stay).
   * Shows the wall as a rectangle (length × height) with its doors and windows,
   * a heavier floor line and a light 0.5 m grid. Openings can be selected and
   * dragged: horizontally to move them along the wall, and windows vertically
   * to change their sill height.
   *
   * Selection is the app's global selection: clicking a door/window sets
   * selectedElementId (so the PropertiesPanel shows its properties); clicking
   * empty wall selects the wall itself. A slim header bar cycles through walls.
   * Escape (or the TopBar Plan/Elevation toggle) returns to the plan view.
   */
  import { activeFloor, elevationWallId, selectedElementId, selectedElementIds, selectedRoomId, updateDoor, updateWindow, beginUndoGroup, endUndoGroup } from '$lib/stores/project';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import type { Door, Window as Win } from '$lib/models/types';

  const DEFAULT_WALL_HEIGHT = 240; // cm — fallback when a wall has no height
  const DEFAULT_DOOR_HEIGHT = 210; // cm
  const DEFAULT_SILL = 90;         // cm
  const GRID_STEP = 50;            // cm (0.5 m)
  const HANDLE_PX = 7;             // half-size of a resize handle square (screen px)
  const HANDLE_HIT = 10;           // hit radius for grabbing a resize handle (screen px)
  const MIN_OPENING = 20;          // cm — smallest width/height a drag-resize allows

  let units = $derived($projectSettings.units);

  let wall = $derived.by(() => {
    const id = $elevationWallId;
    const f = $activeFloor;
    if (!id || !f) return null;
    return f.walls.find((w) => w.id === id) ?? null;
  });

  let wallIndex = $derived.by(() => {
    const f = $activeFloor;
    if (!wall || !f) return -1;
    return f.walls.findIndex((w) => w.id === wall!.id);
  });
  let wallCount = $derived($activeFloor?.walls.length ?? 0);

  let doors = $derived.by(() => {
    const f = $activeFloor;
    if (!wall || !f) return [] as Door[];
    return f.doors.filter((d) => d.wallId === wall!.id);
  });

  let windows = $derived.by(() => {
    const f = $activeFloor;
    if (!wall || !f) return [] as Win[];
    return f.windows.filter((w) => w.wallId === wall!.id);
  });

  /** Wall length in cm (samples curved walls like the properties panel does) */
  let wallLen = $derived.by(() => {
    if (!wall) return 0;
    if (wall.curvePoint) {
      let len = 0;
      let px = wall.start.x, py = wall.start.y;
      for (let i = 1; i <= 32; i++) {
        const t = i / 32, mt = 1 - t;
        const nx = mt * mt * wall.start.x + 2 * mt * t * wall.curvePoint.x + t * t * wall.end.x;
        const ny = mt * mt * wall.start.y + 2 * mt * t * wall.curvePoint.y + t * t * wall.end.y;
        len += Math.hypot(nx - px, ny - py);
        px = nx; py = ny;
      }
      return len;
    }
    return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  });

  let wallH = $derived(wall ? (wall.height || DEFAULT_WALL_HEIGHT) : DEFAULT_WALL_HEIGHT);

  /** Global selection, narrowed to an opening on this wall (drives highlight + dims) */
  let selectedOpeningId = $derived.by(() => {
    const id = $selectedElementId;
    if (!id) return null;
    return doors.some((d) => d.id === id) || windows.some((w) => w.id === id) ? id : null;
  });

  let hoverOpeningId = $state<string | null>(null);
  let dragging = $state(false);
  let handleCursor = $state<string | null>(null);
  let dragCursor = $state<string | null>(null);

  function selectElement(id: string | null) {
    selectedElementId.set(id);
    selectedElementIds.set(new Set());
    selectedRoomId.set(null);
  }

  /** Show a different wall (cycling or fallback) and select it */
  function showWall(id: string) {
    hoverOpeningId = null;
    elevationWallId.set(id);
    selectElement(id);
  }

  function cycleWall(dir: 1 | -1) {
    const f = $activeFloor;
    if (!f || f.walls.length === 0) return;
    const i = f.walls.findIndex((w) => w.id === $elevationWallId);
    const next = f.walls[(((i < 0 ? 0 : i) + dir) % f.walls.length + f.walls.length) % f.walls.length];
    showWall(next.id);
  }

  // Track the shown wall's index so we can advance gracefully if it is deleted
  let lastWallIndex = 0;
  $effect(() => {
    if (wallIndex >= 0) lastWallIndex = wallIndex;
  });

  // If the shown wall disappears (deleted / undone): advance to the nearest
  // remaining wall, or drop back to the plan view when none are left.
  $effect(() => {
    const id = $elevationWallId;
    const f = $activeFloor;
    if (!id || !f) return;
    if (!f.walls.some((w) => w.id === id)) {
      if (f.walls.length > 0) {
        showWall(f.walls[Math.max(0, Math.min(lastWallIndex, f.walls.length - 1))].id);
      } else {
        elevationWallId.set(null);
      }
    }
  });

  function backToPlan() {
    elevationWallId.set(null);
  }

  // Escape returns to the plan view. Registered in the capture phase so the
  // plan canvas's own window-level Escape handling doesn't also fire.
  $effect(() => {
    if (!$elevationWallId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        backToPlan();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ── Canvas + geometry ─────────────────────────────────────────────
  let canvas = $state<HTMLCanvasElement | null>(null);
  let cw = $state(0);
  let ch = $state(0);

  const PAD_L = 72, PAD_R = 64, PAD_T = 36, PAD_B = 64;

  /** Screen-space layout: cm → px mapping for the wall face */
  let geom = $derived.by(() => {
    if (!wall || wallLen <= 0 || cw < PAD_L + PAD_R + 40 || ch < PAD_T + PAD_B + 40) return null;
    const availW = cw - PAD_L - PAD_R;
    const availH = ch - PAD_T - PAD_B;
    const scale = Math.min(availW / wallLen, availH / wallH);
    const ox = PAD_L + (availW - wallLen * scale) / 2;
    const floorY = PAD_T + (availH - wallH * scale) / 2 + wallH * scale;
    return { scale, ox, floorY };
  });

  interface OpeningRect {
    id: string;
    kind: 'door' | 'window';
    /** left edge along wall, cm */ x: number;
    /** bottom above floor, cm */ y: number;
    w: number;
    h: number;
  }

  function openingRects(): OpeningRect[] {
    if (!wall) return [];
    const rects: OpeningRect[] = [];
    for (const d of doors) {
      const h = Math.min(d.height ?? DEFAULT_DOOR_HEIGHT, wallH);
      rects.push({ id: d.id, kind: 'door', x: d.position * wallLen - d.width / 2, y: 0, w: d.width, h });
    }
    for (const w of windows) {
      const sill = w.sillHeight ?? DEFAULT_SILL;
      const h = Math.min(w.height, Math.max(0, wallH - sill));
      rects.push({ id: w.id, kind: 'window', x: w.position * wallLen - w.width / 2, y: sill, w: w.width, h });
    }
    return rects;
  }

  /** Topmost opening under a point given in wall cm coordinates (x along wall, y up from floor) */
  function hitOpening(x: number, y: number): OpeningRect | null {
    const rects = openingRects();
    // Windows are drawn after doors, so test them first (topmost wins)
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  /** Clamp an opening's center position t so its edges stay inside the wall,
   *  keeping a small 5 cm margin from each wall end. */
  function clampPosition(t: number, width: number): number {
    const marginT = 5 / Math.max(1, wallLen);
    const half = width / 2 / Math.max(1, wallLen);
    let lo = marginT + half;
    let hi = 1 - marginT - half;
    if (lo > hi) { lo = 0.5; hi = 0.5; }
    return Math.max(lo, Math.min(hi, t));
  }

  // ── Drag state ────────────────────────────────────────────────────
  type HX = 'l' | 'r' | null;
  type HY = 't' | 'b' | null;
  let drag: {
    id: string;
    kind: 'door' | 'window';
    mode: 'move' | 'resize';
    startPx: number;
    startPy: number;
    startPos: number;   // position t at drag start
    startSill: number;  // window sill at drag start (cm)
    width: number;      // opening width (cm)
    winH: number;       // window height (cm)
    // Resize: which edges follow the pointer, and the fixed edges captured at start (cm)
    hx: HX;
    hy: HY;
    startLeft: number;
    startRight: number;
    startBottom: number;
    startTop: number;
    grouped: boolean;   // beginUndoGroup() called
  } | null = null;

  function toWallCoords(e: PointerEvent): { x: number; y: number } | null {
    if (!geom) return null;
    return { x: (e.offsetX - geom.ox) / geom.scale, y: (geom.floorY - e.offsetY) / geom.scale };
  }

  /** The currently selected opening's rect on this wall, if any. */
  function selectedRect(): OpeningRect | null {
    if (!selectedOpeningId) return null;
    return openingRects().find((r) => r.id === selectedOpeningId) ?? null;
  }

  /** Screen-space center of each resize handle for a rect. */
  function handlePoints(r: OpeningRect): { hx: HX; hy: HY; sx: number; sy: number }[] {
    if (!geom) return [];
    const { scale, ox, floorY } = geom;
    const left = ox + r.x * scale;
    const right = ox + (r.x + r.w) * scale;
    const top = floorY - (r.y + r.h) * scale;
    const bottom = floorY - r.y * scale;
    const midX = (left + right) / 2;
    const midY = (top + bottom) / 2;
    const pts: { hx: HX; hy: HY; sx: number; sy: number }[] = [
      { hx: 'l', hy: 't', sx: left, sy: top },
      { hx: 'r', hy: 't', sx: right, sy: top },
      { hx: 'l', hy: 'b', sx: left, sy: bottom },
      { hx: 'r', hy: 'b', sx: right, sy: bottom },
      { hx: null, hy: 't', sx: midX, sy: top },
      { hx: null, hy: 'b', sx: midX, sy: bottom },
      { hx: 'l', hy: null, sx: left, sy: midY },
      { hx: 'r', hy: null, sx: right, sy: midY },
    ];
    // Doors sit on the floor — no bottom handles (the sill is fixed at 0).
    return r.kind === 'door' ? pts.filter((p) => p.hy !== 'b') : pts;
  }

  /** The resize handle of the selected opening under a screen point, if any. */
  function handleAt(offsetX: number, offsetY: number): { hx: HX; hy: HY } | null {
    const r = selectedRect();
    if (!r) return null;
    for (const p of handlePoints(r)) {
      if (Math.hypot(offsetX - p.sx, offsetY - p.sy) <= HANDLE_HIT) return { hx: p.hx, hy: p.hy };
    }
    return null;
  }

  function cursorForHandle(hx: HX, hy: HY): string {
    if (hx && hy) return (hx === 'l') === (hy === 't') ? 'nwse-resize' : 'nesw-resize';
    if (hx) return 'ew-resize';
    return 'ns-resize';
  }

  function startDrag(id: string, kind: 'door' | 'window', r: OpeningRect, e: PointerEvent, mode: 'move' | 'resize', hx: HX = null, hy: HY = null) {
    const door = kind === 'door' ? doors.find((d) => d.id === id) : undefined;
    const win = kind === 'window' ? windows.find((w) => w.id === id) : undefined;
    drag = {
      id,
      kind,
      mode,
      startPx: e.offsetX,
      startPy: e.offsetY,
      startPos: (door?.position ?? win?.position) ?? 0.5,
      startSill: win?.sillHeight ?? DEFAULT_SILL,
      width: r.w,
      winH: win?.height ?? 0,
      hx,
      hy,
      startLeft: r.x,
      startRight: r.x + r.w,
      startBottom: r.y,
      startTop: r.y + r.h,
      grouped: false,
    };
    dragging = true;
    dragCursor = mode === 'resize' ? cursorForHandle(hx, hy) : 'grabbing';
    canvas?.setPointerCapture(e.pointerId);
  }

  function onPointerDown(e: PointerEvent) {
    if (!wall || !geom) return;
    e.preventDefault();
    // Resize handles of the already-selected opening take priority over move/select
    const h = handleAt(e.offsetX, e.offsetY);
    if (h) {
      const r = selectedRect();
      if (r) { startDrag(r.id, r.kind, r, e, 'resize', h.hx, h.hy); return; }
    }
    const p = toWallCoords(e);
    if (!p) return;
    const hit = hitOpening(p.x, p.y);
    if (hit) {
      // Global selection: the PropertiesPanel now shows this opening
      selectElement(hit.id);
      startDrag(hit.id, hit.kind, hit, e, 'move');
    } else {
      // Empty wall area — selection falls back to the wall itself
      selectElement(wall.id);
    }
  }

  /** Apply a resize drag: move the grabbed edge(s) to the pointer, keep the
   *  opposite edge(s) fixed, clamp to the wall and a minimum size. */
  function applyResize(mx: number, my: number) {
    if (!drag) return;
    let left = drag.startLeft, right = drag.startRight;
    let bottom = drag.startBottom, top = drag.startTop;
    if (drag.hx === 'l') left = mx; else if (drag.hx === 'r') right = mx;
    if (drag.hy === 't') top = my; else if (drag.hy === 'b') bottom = my;
    // Enforce a minimum size against the fixed edge
    if (right - left < MIN_OPENING) {
      if (drag.hx === 'l') left = right - MIN_OPENING; else right = left + MIN_OPENING;
    }
    if (top - bottom < MIN_OPENING) {
      if (drag.hy === 'b') bottom = top - MIN_OPENING; else top = bottom + MIN_OPENING;
    }
    // Clamp inside the wall face
    left = Math.max(0, left); right = Math.min(wallLen, right);
    bottom = Math.max(0, bottom); top = Math.min(wallH, top);
    const width = Math.max(MIN_OPENING, right - left);
    const center = (left + right) / 2;
    const position = clampPosition(center / Math.max(1, wallLen), width);
    if (drag.kind === 'door') {
      updateDoor(drag.id, { position, width: Math.round(width), height: Math.round(top - bottom) });
    } else {
      updateWindow(drag.id, {
        position,
        width: Math.round(width),
        height: Math.round(top - bottom),
        sillHeight: Math.round(bottom),
      });
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!wall || !geom) return;
    if (drag) {
      if (!drag.grouped) {
        // Ignore sub-2px jitter so a plain click never creates an undo entry
        if (Math.hypot(e.offsetX - drag.startPx, e.offsetY - drag.startPy) < 2) return;
        beginUndoGroup();
        drag.grouped = true;
      }
      if (drag.mode === 'resize') {
        const p = toWallCoords(e);
        if (p) applyResize(p.x, p.y);
        return;
      }
      const dxCm = (e.offsetX - drag.startPx) / geom.scale;
      const dyCm = (drag.startPy - e.offsetY) / geom.scale; // up is positive
      const newPos = clampPosition(drag.startPos + dxCm / Math.max(1, wallLen), drag.width);
      if (drag.kind === 'door') {
        updateDoor(drag.id, { position: newPos });
      } else {
        const maxSill = Math.max(0, wallH - drag.winH);
        const newSill = Math.round(Math.max(0, Math.min(maxSill, drag.startSill + dyCm)));
        updateWindow(drag.id, { position: newPos, sillHeight: newSill });
      }
      return;
    }
    // Hover: a resize handle of the selected opening wins over the opening body
    const h = handleAt(e.offsetX, e.offsetY);
    if (h) {
      handleCursor = cursorForHandle(h.hx, h.hy);
      hoverOpeningId = selectedOpeningId;
      return;
    }
    handleCursor = null;
    const p = toWallCoords(e);
    hoverOpeningId = p ? (hitOpening(p.x, p.y)?.id ?? null) : null;
  }

  function endDrag(e: PointerEvent) {
    if (drag) {
      if (drag.grouped) {
        const noun = drag.kind === 'door' ? 'door' : 'window';
        endUndoGroup(`${drag.mode === 'resize' ? 'Resized' : 'Moved'} ${noun} (elevation)`);
      }
      drag = null;
      dragging = false;
      dragCursor = null;
      try { canvas?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
  }

  let cursor = $derived(
    dragCursor ? dragCursor
    : handleCursor ? handleCursor
    : hoverOpeningId ? 'move'
    : 'default'
  );

  // ── Drawing ───────────────────────────────────────────────────────

  function drawDimH(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, label: string) {
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y); ctx.lineTo(x2, y);
    ctx.moveTo(x1, y - 4); ctx.lineTo(x1, y + 4);
    ctx.moveTo(x2, y - 4); ctx.lineTo(x2, y + 4);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const cx = (x1 + x2) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - tw / 2 - 3, y - 8, tw + 6, 16);
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, y);
  }

  function drawDimV(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, label: string) {
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y1); ctx.lineTo(x, y2);
    ctx.moveTo(x - 4, y1); ctx.lineTo(x + 4, y1);
    ctx.moveTo(x - 4, y2); ctx.lineTo(x + 4, y2);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    const cy = (y1 + y2) / 2;
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(-Math.PI / 2);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-tw / 2 - 3, -8, tw + 6, 16);
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  $effect(() => {
    // Reactive dependencies: geometry, openings, selection, hover, units
    const c = canvas;
    const g = geom;
    const sel = selectedOpeningId;
    const hov = hoverOpeningId;
    const u = units;
    const rects = openingRects();
    if (!c) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    c.width = Math.max(1, Math.round(cw * dpr));
    c.height = Math.max(1, Math.round(ch * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!wall || !g) return;

    const { scale, ox, floorY } = g;
    const xAt = (cm: number) => ox + cm * scale;
    const yAt = (cmUp: number) => floorY - cmUp * scale;
    const wallRight = xAt(wallLen);
    const wallTop = yAt(wallH);

    // Wall face
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(ox, wallTop, wallLen * scale, wallH * scale);

    // 0.5 m grid (light), clipped to the wall face
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, wallTop, wallLen * scale, wallH * scale);
    ctx.clip();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = GRID_STEP; x < wallLen; x += GRID_STEP) {
      ctx.moveTo(xAt(x), wallTop);
      ctx.lineTo(xAt(x), floorY);
    }
    for (let y = GRID_STEP; y < wallH; y += GRID_STEP) {
      ctx.moveTo(ox, yAt(y));
      ctx.lineTo(wallRight, yAt(y));
    }
    ctx.stroke();
    ctx.restore();

    // Openings (doors first, then windows on top — same order as hit testing)
    for (const r of rects) {
      const px = xAt(r.x);
      const py = yAt(r.y + r.h);
      const pw = r.w * scale;
      const ph = r.h * scale;
      if (r.kind === 'door') {
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, pw, ph);
        // Door handle hint
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.arc(px + pw - 8, py + ph / 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, pw, ph);
        // Window mullions (cross)
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + pw / 2, py); ctx.lineTo(px + pw / 2, py + ph);
        ctx.moveTo(px, py + ph / 2); ctx.lineTo(px + pw, py + ph / 2);
        ctx.stroke();
      }
      if (r.id === hov && r.id !== sel) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
      }
    }

    // Wall outline + heavier floor line
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, wallTop, wallLen * scale, wallH * scale);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(ox - 24, floorY);
    ctx.lineTo(wallRight + 24, floorY);
    ctx.stroke();

    // Overall wall dimensions
    drawDimH(ctx, ox, wallRight, floorY + 28, formatLength(wallLen, u));
    drawDimV(ctx, ox - 28, wallTop, floorY, formatLength(wallH, u));

    // Selected opening: highlight + width / height / sill dimensions
    const selRect = sel ? rects.find((r) => r.id === sel) : undefined;
    if (selRect) {
      const px = xAt(selRect.x);
      const py = yAt(selRect.y + selRect.h);
      const pw = selRect.w * scale;
      const ph = selRect.h * scale;
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(px - 3, py - 3, pw + 6, ph + 6);
      ctx.setLineDash([]);
      // Resize handles (corners + edge midpoints)
      for (const hp of handlePoints(selRect)) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.fillRect(hp.sx - HANDLE_PX, hp.sy - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
        ctx.strokeRect(hp.sx - HANDLE_PX, hp.sy - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
      }
      // Width above the opening
      drawDimH(ctx, px, px + pw, py - 14, formatLength(selRect.w, u));
      // Height to the right of the opening
      drawDimV(ctx, px + pw + 14, py, py + ph, formatLength(selRect.h, u));
      // Sill height for windows (from floor up to the sill)
      if (selRect.kind === 'window' && selRect.y > 0) {
        drawDimV(ctx, px + pw + 38, py + ph, floorY, formatLength(selRect.y, u));
      }
    }
  });
</script>

{#if wall}
  <!-- Integrated view: fills the canvas area over the plan canvas; right padding
       leaves room for the fixed PropertiesPanel (w-64) that stays visible on md+ -->
  <div class="absolute inset-0 z-30 bg-white flex flex-col md:pr-64">
    <!-- Slim header: wall index, cycling, dimensions -->
    <div class="flex items-center gap-2 px-3 h-10 border-b border-gray-200 bg-slate-50 shrink-0">
      <button
        class="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors disabled:opacity-30 disabled:pointer-events-none text-lg leading-none"
        onclick={() => cycleWall(-1)}
        disabled={wallCount < 2}
        title="Previous wall"
        aria-label="Previous wall"
      >‹</button>
      <span class="text-sm font-semibold text-slate-700 tabular-nums">Wall {wallIndex + 1} of {wallCount}</span>
      <button
        class="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors disabled:opacity-30 disabled:pointer-events-none text-lg leading-none"
        onclick={() => cycleWall(1)}
        disabled={wallCount < 2}
        title="Next wall"
        aria-label="Next wall"
      >›</button>
      <span class="text-xs text-gray-400 ml-1">{formatLength(wallLen, units)} × {formatLength(wallH, units)}</span>
      <div class="flex-1"></div>
      <span class="text-[11px] text-gray-400 max-lg:hidden">Drag to move · drag the handles to resize · Esc for plan</span>
    </div>

    <!-- Elevation canvas -->
    <div class="flex-1 min-h-0 relative" bind:clientWidth={cw} bind:clientHeight={ch}>
      <canvas
        bind:this={canvas}
        class="absolute inset-0 w-full h-full touch-none select-none"
        style="cursor: {cursor}"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
      ></canvas>
    </div>
  </div>
{/if}
