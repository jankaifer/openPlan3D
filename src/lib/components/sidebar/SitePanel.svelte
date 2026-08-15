<script lang="ts">
  import { currentProject, gisTool, activeGisLayerId, selectedGisFeatureId, draftGisFeatureId, showContours, contourInterval, addGisLayer, updateGisLayer, deleteGisLayer, updateGisFeature, deleteGisFeature, applyTerrainImport, setTerrainModel, setSite } from '$lib/stores/project';
  import { makeLayer } from '$lib/utils/gis';
  import { parseRtkPoints, terrainFromRtk } from '$lib/utils/rtkImport';
  import { archiveAsset } from '$lib/services/datastore';
  import { sjtskToWgs84 } from '$lib/utils/geo';
  import { jivinaTerrainModel } from '$lib/data/jivinaSite';

  let collapsed = $state(false);
  let importStatus = $state<string | null>(null);
  let fileInput: HTMLInputElement;
  let demStatus = $state<string | null>(null);

  const project = $derived($currentProject);
  const layers = $derived(project?.gisLayers ?? []);
  const features = $derived(project?.gisFeatures ?? []);
  const selectedFeature = $derived(features.find((f) => f.id === $selectedGisFeatureId) ?? null);
  const terrainPoints = $derived(project?.terrainModel ? project.terrainModel.xyz.length / 3 : 0);
  const origin = $derived(project?.site?.renderOrigin ?? null);
  const originWgs = $derived(origin && (origin.x !== 0 || origin.y !== 0) ? sjtskToWgs84({ x: origin.x, y: origin.y }) : null);

  async function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !project) return;
    importStatus = 'Parsing…';
    try {
      const text = await file.text();
      const parsed = parseRtkPoints(text);
      if (!parsed) {
        importStatus = 'No valid points found (need S-JTSK x y h, Krovak Y X H, or lat lon h lines).';
        return;
      }
      const { site, terrainModel } = terrainFromRtk(parsed, project.site && (project.site.renderOrigin.x !== 0 || project.site.renderOrigin.y !== 0) ? project.site : undefined);
      // Archive the raw upload out-of-band (best-effort, DB backend only).
      const assetId = await archiveAsset(project.id, 'rtk_points', {
        filename: file.name, format: parsed.format, points: parsed.xyz.length / 3
      }, text);
      if (assetId) terrainModel.sourceAssetId = assetId;
      applyTerrainImport(site, terrainModel);
      importStatus = `Imported ${parsed.xyz.length / 3} points (${parsed.format}${parsed.skipped ? `, ${parsed.skipped} lines skipped` : ''}).`;
    } catch (err: any) {
      importStatus = `Import failed: ${err?.message ?? err}`;
    } finally {
      input.value = '';
    }
  }

  let gisHint = $state<string | null>(null);
  let newCollectionOpen = $state(false);
  let newCollectionName = $state('');
  function createCollection() {
    const name = newCollectionName.trim();
    if (!name) return;
    const l = makeLayer(name, layers);
    addGisLayer(l);
    activeGisLayerId.set(l.id);
    newCollectionName = '';
    newCollectionOpen = false;
    gisHint = null;
  }
  function toolButton(t: 'point' | 'line' | 'polygon') {
    if ($gisTool === t) { gisTool.set(null); draftGisFeatureId.set(null); return; }
    // Every feature belongs to a collection — require one before drawing.
    if (!$activeGisLayerId) { gisHint = 'Select or create a collection first.'; return; }
    gisHint = null;
    gisTool.set(t);
  }

  function featureCount(layerId: string) {
    return features.filter((f) => f.layerId === layerId).length;
  }

  const basemap = $derived(project?.site?.basemap ?? null);


  function setBasemap(kind: 'satellite' | 'osm' | 'none') {
    if (!project?.site) return;
    setSite({
      ...project.site,
      basemap: kind === 'none' ? undefined : { kind, opacity: basemap?.opacity ?? 1 }
    });
  }

  function setBasemapOpacity(opacity: number) {
    if (!project?.site?.basemap) return;
    setSite({ ...project.site, basemap: { ...project.site.basemap, opacity } });
  }

  function loadDemTerrain() {
    if (!project?.site) return;
    if (terrainPoints > 0 && !confirm(`Replace the existing ${terrainPoints} terrain points with the built-in EU-DEM data?`)) return;
    const model = jivinaTerrainModel();
    applyTerrainImport(project.site, model);
    demStatus = `Loaded ${model.xyz.length / 3} built-in points (EU-DEM ~25 m).`;
  }
</script>

<div class="w-64 max-md:w-56 h-full bg-white border-l border-slate-200 flex flex-col text-sm overflow-y-auto">
  <button class="flex items-center justify-between px-3 py-2 font-semibold text-slate-700 border-b border-slate-200" onclick={() => collapsed = !collapsed}>
    <span>Site & Survey</span>
    <span class="text-slate-400">{collapsed ? '▸' : '▾'}</span>
  </button>

  {#if !collapsed}
    <!-- Location & basemap -->
    <div class="px-3 py-2 border-b border-slate-100 space-y-2">
      <div class="font-medium text-slate-600">Location & map</div>
      <label class="flex items-center gap-2 text-xs text-slate-600">Basemap
        <select class="flex-1 border border-slate-200 rounded px-1 py-0.5" value={basemap?.kind ?? 'none'}
          onchange={(e) => setBasemap(e.currentTarget.value as 'satellite' | 'osm' | 'none')}>
          <option value="none">None</option>
          <option value="satellite">Satellite</option>
          <option value="osm">OpenStreetMap</option>
        </select>
      </label>
      {#if basemap}
        <label class="flex items-center gap-2 text-xs text-slate-600">Opacity
          <input type="range" min="0.2" max="1" step="0.1" class="flex-1" value={basemap.opacity ?? 1}
            onchange={(e) => setBasemapOpacity(Number(e.currentTarget.value))} />
        </label>
      {/if}
    </div>

    <!-- Terrain -->
    <div class="px-3 py-2 border-b border-slate-100 space-y-2">
      <div class="font-medium text-slate-600">Terrain</div>
      <div class="text-xs text-slate-500">
        {#if terrainPoints > 0}{terrainPoints.toLocaleString()} survey points{:else}No terrain yet — import RTK points or sculpt in 3D.{/if}
      </div>
      {#if originWgs}
        <div class="text-xs text-slate-500">Origin: {originWgs.lat.toFixed(6)}°, {originWgs.lon.toFixed(6)}° · {origin?.z.toFixed(1)} m</div>
      {/if}
      <input type="file" accept=".txt,.csv,.xyz,.pts" class="hidden" bind:this={fileInput} onchange={onImportFile} />
      <button class="w-full px-2 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700" onclick={() => fileInput.click()}>
        Import RTK points…
      </button>
      <button class="w-full px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs" onclick={loadDemTerrain} title="Covers the whole property rectangle">
        Load terrain (EU-DEM, whole property)
      </button>
      {#if demStatus}<div class="text-xs text-slate-500">{demStatus}</div>{/if}
      {#if terrainPoints > 0}
        <button class="w-full px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs" onclick={() => { if (confirm('Remove all terrain points?')) setTerrainModel(undefined); }}>
          Clear terrain
        </button>
      {/if}
      {#if importStatus}<div class="text-xs text-slate-500">{importStatus}</div>{/if}
      <label class="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={$showContours} onchange={(e) => showContours.set(e.currentTarget.checked)} />
        Contours every
        <select class="border border-slate-200 rounded px-1 py-0.5" value={$contourInterval} onchange={(e) => contourInterval.set(Number(e.currentTarget.value))}>
          <option value={0.1}>10 cm</option>
          <option value={0.25}>25 cm</option>
          <option value={0.5}>50 cm</option>
          <option value={1}>1 m</option>
        </select>
      </label>
    </div>

    <!-- Draw tools -->
    <div class="px-3 py-2 border-b border-slate-100 space-y-2">
      <div class="font-medium text-slate-600">Draw on site</div>
      <div class="grid grid-cols-3 gap-1">
        {#each [['point', '⊙ Point'], ['line', '╱ Line'], ['polygon', '▱ Area']] as [t, label]}
          <button
            class="px-1.5 py-1.5 rounded border text-xs {$gisTool === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}"
            onclick={() => toolButton(t as 'point' | 'line' | 'polygon')}
          >{label}</button>
        {/each}
      </div>
      {#if $gisTool}
        <div class="text-xs text-slate-500">Click the plan to add vertices{$gisTool !== 'point' ? '; double-click to finish, Esc to cancel' : ''}.</div>
      {/if}
      {#if gisHint}<div class="text-xs text-amber-600">{gisHint}</div>{/if}
    </div>

    <!-- Collections -->
    <div class="px-3 py-2 border-b border-slate-100 space-y-1.5">
      <div class="flex items-center justify-between">
        <div class="font-medium text-slate-600">Collections</div>
        <button class="text-blue-600 hover:underline text-xs" onclick={() => { newCollectionOpen = !newCollectionOpen; }}>+ Add</button>
      </div>
      {#if newCollectionOpen}
        <div class="flex gap-1">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="flex-1 min-w-0 border border-blue-300 rounded px-1.5 py-1 text-xs"
            placeholder="Name (e.g. Water, Fence)"
            autofocus
            bind:value={newCollectionName}
            onkeydown={(e) => { if (e.key === 'Enter') createCollection(); if (e.key === 'Escape') { newCollectionOpen = false; newCollectionName = ''; } }}
          />
          <button class="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 text-xs disabled:opacity-40"
            disabled={!newCollectionName.trim()} onclick={createCollection}>Create</button>
        </div>
      {/if}
      {#each layers as layer (layer.id)}
        <div class="flex items-center gap-1.5 rounded px-1 py-0.5 {$activeGisLayerId === layer.id ? 'bg-blue-50' : ''}">
          <input type="checkbox" checked={layer.visible} title="Visible" onchange={(e) => updateGisLayer(layer.id, { visible: e.currentTarget.checked })} />
          <input type="color" class="w-5 h-5 p-0 border-0 bg-transparent" value={layer.color} onchange={(e) => updateGisLayer(layer.id, { color: e.currentTarget.value })} />
          <button class="flex-1 text-left truncate text-slate-700" onclick={() => activeGisLayerId.set(layer.id)} ondblclick={() => { const n = prompt('Layer name', layer.name); if (n) updateGisLayer(layer.id, { name: n }); }}>
            {layer.name} <span class="text-slate-400 text-xs">({featureCount(layer.id)})</span>
          </button>
          <select class="text-xs border-0 text-slate-400 bg-transparent" value={layer.lineStyle ?? 'solid'} onchange={(e) => updateGisLayer(layer.id, { lineStyle: e.currentTarget.value as any })}>
            <option value="solid">—</option>
            <option value="dashed">- -</option>
            <option value="dotted">···</option>
          </select>
          <button class="text-slate-300 hover:text-red-500" title="Delete layer" onclick={() => { if (confirm(`Delete layer "${layer.name}" and its ${featureCount(layer.id)} features?`)) deleteGisLayer(layer.id); }}>×</button>
        </div>
      {:else}
        <div class="text-xs text-slate-400">No collections yet. Add one for water, electricity, fences…</div>
      {/each}
    </div>

    <!-- Selected feature -->
    {#if selectedFeature}
      <div class="px-3 py-2 space-y-2">
        <div class="font-medium text-slate-600">Selected {selectedFeature.kind}</div>
        <label class="block text-xs text-slate-500">Label
          <input class="mt-0.5 w-full border border-slate-200 rounded px-1.5 py-1" value={selectedFeature.label ?? ''}
            onchange={(e) => updateGisFeature(selectedFeature.id, (f) => { f.label = e.currentTarget.value || undefined; })} />
        </label>
        <label class="block text-xs text-slate-500">Depth below surface (cm)
          <input type="number" class="mt-0.5 w-full border border-slate-200 rounded px-1.5 py-1" value={selectedFeature.depth ?? ''}
            placeholder="on surface"
            onchange={(e) => { const v = e.currentTarget.value; updateGisFeature(selectedFeature.id, (f) => { f.depth = v === '' ? undefined : Number(v); }); }} />
        </label>
        <div class="text-xs text-slate-400">{selectedFeature.vertices.length} vertices</div>
        <button class="w-full px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 text-xs" onclick={() => deleteGisFeature(selectedFeature.id)}>Delete feature</button>
      </div>
    {/if}
  {/if}
</div>
