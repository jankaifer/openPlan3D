import type { Project, Terrain, TerrainModel } from '$lib/models/types';
import { roundMm } from '$lib/utils/geo';

export interface DataStore {
  save(project: Project): Promise<void>;
  load(id: string): Promise<Project | null>;
  list(): Promise<{ id: string; name: string; updatedAt: string }[]>;
  delete(id: string): Promise<void>;
  duplicate(id: string): Promise<Project | null>;
  saveThumbnail(id: string, dataUrl: string): void;
  getThumbnail(id: string): string | null;
}

const KEY = 'floorplan_projects';

function getAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * One-time conversion of the legacy sculpted grid heightfield into TIN terrain
 * points. Legacy projects are not georeferenced, so they get the identity
 * render origin (0,0,0) — plan geometry keeps its meaning and the user can
 * re-anchor later. Grids are downsampled to at most ~20k points.
 */
function terrainModelFromLegacyGrid(t: Terrain): TerrainModel {
  const total = t.cols * t.rows;
  const stride = Math.max(1, Math.ceil(Math.sqrt(total / 20000)));
  const xyz: number[] = [];
  for (let r = 0; r < t.rows; r += stride) {
    for (let c = 0; c < t.cols; c += stride) {
      const px = t.origin.x + c * t.cellSize; // plan cm
      const py = t.origin.y + r * t.cellSize;
      const h = t.heights[r * t.cols + c] ?? 0;
      // plan cm → S-JTSK m at identity origin (see geo.ts conventions).
      xyz.push(roundMm(px / 100), roundMm(-py / 100), roundMm(h / 100));
    }
  }
  return { xyz };
}

/** Revive dates and backfill any missing fields on a loaded project. */
export function normalizeProject(p: any): Project {
  p.createdAt = new Date(p.createdAt);
  p.updatedAt = new Date(p.updatedAt);
  for (const floor of (p.floors ?? [])) {
    if (!floor.rooms) floor.rooms = [];
    if (!floor.doors) floor.doors = [];
    if (!floor.windows) floor.windows = [];
    if (!floor.furniture) floor.furniture = [];
    if (!floor.stairs) floor.stairs = [];
    if (!floor.columns) floor.columns = [];
    if (!floor.beams) floor.beams = [];
    if (!floor.slabs) floor.slabs = [];
    if (!floor.roofs) floor.roofs = [];
  }
  if (!p.gisLayers) p.gisLayers = [];
  if (!p.gisFeatures) p.gisFeatures = [];
  if (!p.site) p.site = { renderOrigin: { x: 0, y: 0, z: 0 } };
  if (!p.terrainModel && p.terrain?.heights?.length) {
    p.terrainModel = terrainModelFromLegacyGrid(p.terrain as Terrain);
  }
  delete p.terrain; // legacy grid is converted above and no longer written
  return p as Project;
}

export const localStore: DataStore = {
  async save(project) {
    const all = getAll();
    all[project.id] = JSON.stringify(project);
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError' || e?.code === 22 || e?.code === 1014) {
        console.warn('[DataStore] localStorage quota exceeded');
        // Attempt to save just this project by removing others if needed
        const minimal: Record<string, string> = {};
        minimal[project.id] = all[project.id];
        try {
          localStorage.setItem(KEY, JSON.stringify(minimal));
          alert('Storage quota exceeded. Other projects were removed to save this one. Consider exporting important projects as JSON.');
        } catch {
          alert('Storage quota exceeded. Please export your project as JSON and clear browser data.');
        }
      } else {
        throw e;
      }
    }
  },

  async load(id) {
    const all = getAll();
    const raw = all[id];
    if (!raw) return null;
    return normalizeProject(JSON.parse(raw));
  },

  async list() {
    const all = getAll();
    return Object.values(all).map((raw) => {
      const p = JSON.parse(raw as string);
      return { id: p.id, name: p.name, updatedAt: p.updatedAt };
    });
  },

  async delete(id) {
    const all = getAll();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
    // Also remove thumbnail
    try { localStorage.removeItem(`floorplan_thumb_${id}`); } catch {}
  },

  async duplicate(id: string): Promise<Project | null> {
    const original = await this.load(id);
    if (!original) return null;
    const newId = Math.random().toString(36).slice(2, 10);
    const dup: Project = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.save(dup);
    // Copy thumbnail if exists
    try {
      const thumb = localStorage.getItem(`floorplan_thumb_${id}`);
      if (thumb) localStorage.setItem(`floorplan_thumb_${newId}`, thumb);
    } catch {}
    return dup;
  },

  saveThumbnail(id: string, dataUrl: string) {
    try { localStorage.setItem(`floorplan_thumb_${id}`, dataUrl); } catch {}
  },

  getThumbnail(id: string): string | null {
    try { return localStorage.getItem(`floorplan_thumb_${id}`); } catch { return null; }
  },
};

/**
 * Server-backed store talking to the /api/projects routes (Postgres).
 * Thumbnails stay in localStorage (they are large images, not project data).
 */
export const remoteStore: DataStore = {
  async save(project) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(project),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
  },

  async load(id) {
    const res = await fetch(`/api/projects/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`load failed: ${res.status}`);
    return normalizeProject(await res.json());
  },

  async list() {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    return res.json();
  },

  async delete(id) {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
    try { localStorage.removeItem(`floorplan_thumb_${id}`); } catch {}
  },

  async duplicate(id) {
    const original = await this.load(id);
    if (!original) return null;
    const newId = Math.random().toString(36).slice(2, 10);
    const dup: Project = { ...original, id: newId, name: `${original.name} (Copy)`, createdAt: new Date(), updatedAt: new Date() };
    await this.save(dup);
    try {
      const thumb = localStorage.getItem(`floorplan_thumb_${id}`);
      if (thumb) localStorage.setItem(`floorplan_thumb_${newId}`, thumb);
    } catch {}
    return dup;
  },

  saveThumbnail: localStore.saveThumbnail,
  getThumbnail: localStore.getThumbnail,
};

// Capability probe: is the server DB reachable? Cached after first check so we
// route every call consistently and only migrate once.
let backendPromise: Promise<DataStore> | null = null;

async function migrateLocalToRemote() {
  const FLAG = 'floorplan_migrated_to_db';
  try {
    if (localStorage.getItem(FLAG)) return;
    const localProjects = await localStore.list();
    if (localProjects.length === 0) { localStorage.setItem(FLAG, '1'); return; }
    const remoteProjects = await remoteStore.list();
    const remoteIds = new Set(remoteProjects.map((p) => p.id));
    for (const summary of localProjects) {
      if (remoteIds.has(summary.id)) continue;
      const full = await localStore.load(summary.id);
      if (full) await remoteStore.save(full);
    }
    localStorage.setItem(FLAG, '1');
    console.info('[DataStore] Migrated local projects into the server database');
  } catch (e) {
    console.warn('[DataStore] Local→DB migration skipped:', e);
  }
}

async function resolveBackend(): Promise<DataStore> {
  // SSR / no fetch → localStorage only.
  if (typeof window === 'undefined') return localStore;
  try {
    const res = await fetch('/api/projects', { method: 'GET' });
    if (res.ok) {
      await migrateLocalToRemote();
      return remoteStore;
    }
  } catch {
    // network error → fall through to local
  }
  return localStore;
}

function backend(): Promise<DataStore> {
  if (!backendPromise) backendPromise = resolveBackend();
  return backendPromise;
}

/**
 * The active project store. Uses the server Postgres database when the
 * /api/projects routes are available, otherwise transparently falls back to
 * localStorage — so the app keeps working before the DB is provisioned.
 */
/**
 * Archive a bulky per-project upload (e.g. the raw RTK point file) in the
 * assets table. Best-effort: with no server DB the archive is skipped — the
 * parsed terrain still lives in the project itself.
 */
export async function archiveAsset(
  projectId: string,
  kind: string,
  meta: Record<string, unknown>,
  data: unknown
): Promise<string | null> {
  const id = `${kind}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    const res = await fetch(`/api/projects/${projectId}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, kind, meta, data }),
    });
    if (!res.ok) return null;
    return id;
  } catch {
    return null;
  }
}

export const store: DataStore = {
  async save(project) { return (await backend()).save(project); },
  async load(id) { return (await backend()).load(id); },
  async list() { return (await backend()).list(); },
  async delete(id) { return (await backend()).delete(id); },
  async duplicate(id) { return (await backend()).duplicate(id); },
  // Thumbnails are always local (both backends delegate here anyway).
  saveThumbnail: localStore.saveThumbnail,
  getThumbnail: localStore.getThumbnail,
};
