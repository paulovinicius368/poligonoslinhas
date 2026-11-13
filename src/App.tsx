import { useCallback, useMemo, useState } from 'react';
import { ConnectivityPanel } from './components/ConnectivityPanel';
import { ExportModal } from './components/ExportModal';
import { RoutingPanel } from './components/RoutingPanel';
import { SegmentTable } from './components/SegmentTable';
import { SidebarControls } from './components/SidebarControls';
import { VectorCanvas } from './components/VectorCanvas';
import { SAMPLE_FARMS } from './data/sampleFarms';
import type {
  CenterlineParams,
  GeoFeaturePolygon,
  GraphEdge,
  LayerVisibility,
  SampleFarmDataset,
  WorkspaceView,
} from './types/gis';
import {
  extractCenterlineNetwork,
  findShortestRoute,
} from './utils/centerlineEngine';
import { parseVectorFile, parseWKTPolygons } from './utils/gisParsers';

const DEFAULT_PARAMS: CenterlineParams = {
  sampleStepMeters: 1.4,
  spurFactor: 1.75,
  minBranchMeters: 4.0,
  junctionMergeFactor: 1.6,
  smoothingIterations: 3,
  simplificationMeters: 0.4,
  autoBridgeSectors: true,
  maxBridgeMeters: 25,
  extendDeadEnds: true,
};

const DEFAULT_LAYERS: LayerVisibility = {
  polygons: true,
  centerlines: true,
  widthHeatmap: false,
  nodes: true,
  bridges: true,
  lengthLabels: false,
  rawSkeleton: false,
};

export default function App() {
  const [features, setFeatures] = useState<GeoFeaturePolygon[]>(
    SAMPLE_FARMS[0].features
  );
  const [sourceName, setSourceName] = useState<string>(SAMPLE_FARMS[0].name);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(
    SAMPLE_FARMS[0].id
  );

  const [params, setParams] = useState<CenterlineParams>(DEFAULT_PARAMS);
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [activeView, setActiveView] = useState<WorkspaceView>('map');

  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [routeStartNodeId, setRouteStartNodeId] = useState<string | null>(null);
  const [routeEndNodeId, setRouteEndNodeId] = useState<string | null>(null);
  const [minVehicleWidth, setMinVehicleWidth] = useState<number>(0);

  const [focusBounds, setFocusBounds] = useState<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    nonce: number;
  } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Recompute topological centerline network whenever features or params change
  const network = useMemo(
    () => extractCenterlineNetwork(features, params),
    [features, params]
  );

  // Recompute active route when start/end/width constraints or network change
  const activeRoute = useMemo(() => {
    if (!routeStartNodeId || !routeEndNodeId) return null;
    const hasStart = network.nodes.some((n) => n.id === routeStartNodeId);
    const hasEnd = network.nodes.some((n) => n.id === routeEndNodeId);
    if (!hasStart || !hasEnd) return null;
    return findShortestRoute(
      network,
      routeStartNodeId,
      routeEndNodeId,
      minVehicleWidth
    );
  }, [network, routeStartNodeId, routeEndNodeId, minVehicleWidth]);

  const clearSelections = useCallback(() => {
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
    setRouteStartNodeId(null);
    setRouteEndNodeId(null);
  }, []);

  const handleSelectSample = useCallback(
    (sample: SampleFarmDataset) => {
      setImportError(null);
      setFeatures(sample.features);
      setSourceName(sample.name);
      setActiveSampleId(sample.id);
      clearSelections();
      // If user picks the gap demo dataset, keep autoBridge visible or let them toggle
      if (sample.id === 'complexo-cerrado') {
        setParams((prev) => ({ ...prev, autoBridgeSectors: false }));
        setActiveView('connectivity');
      }
    },
    [clearSelections]
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      setIsImporting(true);
      setImportError(null);
      try {
        const parsed = await parseVectorFile(file);
        setFeatures(parsed);
        setSourceName(file.name.replace(/\.[^.]+$/, ''));
        setActiveSampleId(null);
        clearSelections();
      } catch (err) {
        setImportError(
          err instanceof Error
            ? err.message
            : 'Falha ao importar o arquivo vetorial.'
        );
      } finally {
        setIsImporting(false);
      }
    },
    [clearSelections]
  );

  const handlePasteWkt = useCallback(
    (wkt: string) => {
      setImportError(null);
      const parsed = parseWKTPolygons(wkt);
      if (parsed.length === 0) {
        setImportError(
          'Nenhuma geometria POLYGON ou MULTIPOLYGON válida encontrada no texto WKT.'
        );
        return;
      }
      setFeatures(parsed);
      setSourceName('Camada WKT Importada');
      setActiveSampleId(null);
      clearSelections();
    },
    [clearSelections]
  );

  const handleRouteNodePick = useCallback(
    (nodeId: string) => {
      if (!routeStartNodeId || (routeStartNodeId && routeEndNodeId)) {
        setRouteStartNodeId(nodeId);
        setRouteEndNodeId(null);
      } else if (nodeId !== routeStartNodeId) {
        setRouteEndNodeId(nodeId);
      }
    },
    [routeStartNodeId, routeEndNodeId]
  );

  const handleAutoPickDemoRoute = useCallback(() => {
    if (network.nodes.length < 2) return;
    // Pick two nodes farthest apart in the largest component
    const mainComp = network.components[0]?.id ?? 0;
    const compNodes = network.nodes.filter((n) => n.componentId === mainComp);
    const pool = compNodes.length >= 2 ? compNodes : network.nodes;

    let bestA = pool[0];
    let bestB = pool[1];
    let bestD = -1;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const d = Math.hypot(
          pool[i].point[0] - pool[j].point[0],
          pool[i].point[1] - pool[j].point[1]
        );
        if (d > bestD) {
          bestD = d;
          bestA = pool[i];
          bestB = pool[j];
        }
      }
    }
    setRouteStartNodeId(bestA.id);
    setRouteEndNodeId(bestB.id);
  }, [network]);

  const handleFocusBox = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number) => {
      setFocusBounds({ minX, minY, maxX, maxY, nonce: Date.now() });
    },
    []
  );

  const handleFocusEdge = useCallback((edge: GraphEdge) => {
    const xs = edge.points.map((p) => p[0]);
    const ys = edge.points.map((p) => p[1]);
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setActiveView('map');
    setFocusBounds({
      minX: Math.min(...xs) - 25,
      minY: Math.min(...ys) - 25,
      maxX: Math.max(...xs) + 25,
      maxY: Math.max(...ys) + 25,
      nonce: Date.now(),
    });
  }, []);

  const selectedEdge = useMemo(
    () => network.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [network.edges, selectedEdgeId]
  );

  const selectedNode = useMemo(
    () => network.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [network.nodes, selectedNodeId]
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
      {/* Three-Zone Top Bar */}
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('map');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          EixoRural
        </a>

        <nav className="flex items-center gap-6 h-full">
          {(
            [
              ['map', 'Mapa Vetorial'],
              ['connectivity', 'Conectividade'],
              ['routing', 'Roteamento'],
              ['segments', 'Trechos'],
            ] as Array<[WorkspaceView, string]>
          ).map(([viewKey, label]) => {
            const active = activeView === viewKey;
            return (
              <button
                key={viewKey}
                type="button"
                onClick={() => setActiveView(viewKey)}
                className={`h-full inline-flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-emerald-700 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
          >
            Exportar Rede
          </button>
        </div>
      </header>

      {/* Quiet Inline Network Summary Strip */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-600 font-mono">
          <span className="text-slate-900 font-semibold font-sans">{sourceName}</span>
          <span aria-hidden="true">·</span>
          <span>{network.stats.inputPolygonCount} polígonos</span>
          <span aria-hidden="true">·</span>
          <span>{network.edges.length} trechos</span>
          <span aria-hidden="true">·</span>
          <span>{(network.stats.totalLengthMeters / 1000).toFixed(2)} km</span>
          <span aria-hidden="true">·</span>
          <span>{network.stats.junctionCount} cruzamentos</span>
          <span aria-hidden="true">·</span>
          <span>
            Largura {network.stats.minWidthMeters.toFixed(1)}–{network.stats.maxWidthMeters.toFixed(1)} m
          </span>
          <span aria-hidden="true">·</span>
          {network.stats.componentCount <= 1 ? (
            <span className="text-emerald-700 font-medium font-sans">
              Conectividade total (1 rede única)
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setActiveView('connectivity')}
              className="text-amber-700 font-medium font-sans hover:underline"
            >
              {network.stats.componentCount} setores desconectados — revisar
            </button>
          )}
        </div>

        {(selectedEdge || selectedNode) && (
          <div className="flex items-center gap-3 font-mono text-slate-800">
            {selectedEdge && (
              <span>
                Selecionado: <strong>{selectedEdge.id}</strong> ({selectedEdge.lengthMeters.toFixed(1)} m · larg. média {selectedEdge.avgWidthMeters.toFixed(1)} m · mín. {selectedEdge.minWidthMeters.toFixed(1)} m)
              </span>
            )}
            {selectedNode && (
              <span>
                Nó: <strong>{selectedNode.id}</strong> ({selectedNode.kind === 'junction' ? `Cruzamento ${selectedNode.degree} vias` : selectedNode.kind === 'bridge' ? 'Ponte de setor' : 'Extremidade'} · larg. {(selectedNode.halfWidthMeters * 2).toFixed(1)} m)
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedEdgeId(null);
                setSelectedNodeId(null);
              }}
              className="text-slate-500 hover:text-slate-900 font-sans"
            >
              Fechar
            </button>
          </div>
        )}
      </div>

      {/* Main Workstation Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <SidebarControls
          samples={SAMPLE_FARMS}
          activeSourceName={sourceName}
          activeSampleId={activeSampleId}
          params={params}
          layers={layers}
          importError={importError}
          isImporting={isImporting}
          onSelectSample={handleSelectSample}
          onUploadFile={handleUploadFile}
          onPasteWkt={handlePasteWkt}
          onChangeParams={setParams}
          onResetParams={() => setParams(DEFAULT_PARAMS)}
          onChangeLayers={setLayers}
        />

        {activeView === 'segments' ? (
          <SegmentTable
            network={network}
            selectedEdgeId={selectedEdgeId}
            onFocusEdge={handleFocusEdge}
          />
        ) : (
          <main className="flex-1 min-w-0 relative">
            <VectorCanvas
              network={network}
              layers={layers}
              activeView={activeView}
              selectedEdgeId={selectedEdgeId}
              selectedNodeId={selectedNodeId}
              routeStartNodeId={routeStartNodeId}
              routeEndNodeId={routeEndNodeId}
              route={activeRoute}
              focusBounds={focusBounds}
              onSelectEdge={setSelectedEdgeId}
              onSelectNode={setSelectedNodeId}
              onRouteNodePick={handleRouteNodePick}
            />
          </main>
        )}

        {activeView === 'connectivity' && (
          <ConnectivityPanel
            network={network}
            onFocusBox={handleFocusBox}
            onEnableAutoBridge={() =>
              setParams((prev) => ({
                ...prev,
                autoBridgeSectors: true,
                maxBridgeMeters: Math.max(prev.maxBridgeMeters, 30),
              }))
            }
          />
        )}

        {activeView === 'routing' && (
          <RoutingPanel
            network={network}
            startNodeId={routeStartNodeId}
            endNodeId={routeEndNodeId}
            minVehicleWidth={minVehicleWidth}
            route={activeRoute}
            onChangeStart={setRouteStartNodeId}
            onChangeEnd={setRouteEndNodeId}
            onSwap={() => {
              setRouteStartNodeId(routeEndNodeId);
              setRouteEndNodeId(routeStartNodeId);
            }}
            onClear={() => {
              setRouteStartNodeId(null);
              setRouteEndNodeId(null);
            }}
            onChangeMinWidth={setMinVehicleWidth}
            onAutoPickDemoRoute={handleAutoPickDemoRoute}
            onOpenExport={() => setExportOpen(true)}
          />
        )}
      </div>

      <ExportModal
        open={exportOpen}
        network={network}
        route={activeRoute}
        sourceName={sourceName}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
