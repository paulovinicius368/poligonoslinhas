import React, { useRef, useState } from 'react';
import {
  FileUp,
  Layers,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  CenterlineParams,
  LayerVisibility,
  SampleFarmDataset,
} from '../types/gis';

interface SidebarControlsProps {
  samples: SampleFarmDataset[];
  activeSourceName: string;
  activeSampleId: string | null;
  params: CenterlineParams;
  layers: LayerVisibility;
  importError: string | null;
  isImporting: boolean;
  onSelectSample: (sample: SampleFarmDataset) => void;
  onUploadFile: (file: File) => void;
  onPasteWkt: (wkt: string) => void;
  onChangeParams: (next: CenterlineParams) => void;
  onResetParams: () => void;
  onChangeLayers: (next: LayerVisibility) => void;
}

export const SidebarControls: React.FC<SidebarControlsProps> = ({
  samples,
  activeSourceName,
  activeSampleId,
  params,
  layers,
  importError,
  isImporting,
  onSelectSample,
  onUploadFile,
  onPasteWkt,
  onChangeParams,
  onResetParams,
  onChangeLayers,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showWktBox, setShowWktBox] = useState(false);
  const [wktInput, setWktInput] = useState('');

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onUploadFile(file);
  };

  return (
    <aside className="w-[310px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-full overflow-y-auto">
      {/* Section 1: Vector Polygon Import */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-sm font-semibold text-slate-900">Camada de Polígonos</h2>
          <button
            type="button"
            onClick={() => setShowWktBox((v) => !v)}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap shrink-0"
          >
            {showWktBox ? 'Fechar WKT' : 'Colar WKT'}
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          className={`rounded-lg border border-dashed p-3.5 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-emerald-600 bg-emerald-50/70'
              : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100/70'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,.zip,.kml,.wkt,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
              e.target.value = '';
            }}
          />
          <FileUp className="w-5 h-5 text-emerald-700 mx-auto mb-1.5" />
          <p className="text-xs font-medium text-slate-800">
            {isImporting ? 'Processando arquivo...' : 'Importar vetor da fazenda'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            GeoJSON · Shapefile (.zip) · KML · WKT
          </p>
        </div>

        {showWktBox && (
          <div className="mt-2.5 space-y-2">
            <textarea
              value={wktInput}
              onChange={(e) => setWktInput(e.target.value)}
              placeholder="POLYGON((...)) ou MULTIPOLYGON(((...)))"
              rows={3}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-emerald-700"
            />
            <button
              type="button"
              onClick={() => {
                if (wktInput.trim()) {
                  onPasteWkt(wktInput.trim());
                  setShowWktBox(false);
                }
              }}
              className="w-full py-1.5 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
            >
              Carregar geometria WKT
            </button>
          </div>
        )}

        {importError && (
          <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-2">
            {importError}
          </p>
        )}

        <div className="mt-3">
          <p className="text-[11px] font-medium text-slate-500 mb-1.5">
            Camada ativa: <span className="text-slate-900">{activeSourceName}</span>
          </p>
          <div className="space-y-1">
            {samples.map((s) => {
              const active = s.id === activeSampleId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectSample(s)}
                  className={`w-full text-left px-2.5 py-2 rounded-md border text-xs transition-colors ${
                    active
                      ? 'bg-emerald-50/80 border-emerald-700/40 text-slate-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {s.region} · {s.subtitle}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 2: Centerline & Smoothing Engine Controls */}
      <div className="p-4 border-b border-slate-200 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Extração e Suavização
            </h2>
          </div>
          <button
            type="button"
            onClick={onResetParams}
            title="Restaurar padrões"
            className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Padrão</span>
          </button>
        </div>

        {/* Smoothing Iterations */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-700 font-medium">Suavização das curvas</span>
            <span className="font-mono text-slate-900">
              {params.smoothingIterations} passes
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={params.smoothingIterations}
            onChange={(e) =>
              onChangeParams({
                ...params,
                smoothingIterations: Number(e.target.value),
              })
            }
            className="w-full gis-slider"
          />
        </div>

        {/* Simplification RDP */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-700 font-medium">Simplificação (RDP)</span>
            <span className="font-mono text-slate-900">
              {params.simplificationMeters.toFixed(1)} m
            </span>
          </div>
          <input
            type="range"
            min={0.1}
            max={2.0}
            step={0.1}
            value={params.simplificationMeters}
            onChange={(e) =>
              onChangeParams({
                ...params,
                simplificationMeters: Number(e.target.value),
              })
            }
            className="w-full gis-slider"
          />
        </div>

        {/* Spur Pruning Factor */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-700 font-medium">Poda de cantos (esporões)</span>
            <span className="font-mono text-slate-900">
              {params.spurFactor.toFixed(2)}× raio
            </span>
          </div>
          <input
            type="range"
            min={1.1}
            max={3.0}
            step={0.05}
            value={params.spurFactor}
            onChange={(e) =>
              onChangeParams({ ...params, spurFactor: Number(e.target.value) })
            }
            className="w-full gis-slider"
          />
        </div>

        {/* Junction Clustering */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-700 font-medium">Fusão de cruzamentos</span>
            <span className="font-mono text-slate-900">
              {params.junctionMergeFactor.toFixed(1)}× raio
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={3.0}
            step={0.2}
            value={params.junctionMergeFactor}
            onChange={(e) =>
              onChangeParams({
                ...params,
                junctionMergeFactor: Number(e.target.value),
              })
            }
            className="w-full gis-slider"
          />
        </div>

        {/* Mesh Sample Precision */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-700 font-medium">Amostragem da borda</span>
            <span className="font-mono text-slate-900">
              {params.sampleStepMeters.toFixed(1)} m
            </span>
          </div>
          <input
            type="range"
            min={0.8}
            max={4.0}
            step={0.2}
            value={params.sampleStepMeters}
            onChange={(e) =>
              onChangeParams({
                ...params,
                sampleStepMeters: Number(e.target.value),
              })
            }
            className="w-full gis-slider"
          />
        </div>

        {/* Extend Dead Ends */}
        <label className="flex items-center justify-between pt-1 cursor-pointer">
          <span className="text-xs text-slate-700 font-medium">
            Estender pontas até o limite
          </span>
          <input
            type="checkbox"
            checked={params.extendDeadEnds}
            onChange={(e) =>
              onChangeParams({ ...params, extendDeadEnds: e.target.checked })
            }
            className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
          />
        </label>
      </div>

      {/* Section 3: Sector Connectivity & Auto-Bridge */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Conectividade dos Setores
          </h2>
          <input
            type="checkbox"
            checked={params.autoBridgeSectors}
            onChange={(e) =>
              onChangeParams({ ...params, autoBridgeSectors: e.target.checked })
            }
            aria-label="Conectar setores automaticamente"
            className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
          />
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Fecha automaticamente pequenas descontinuidades entre setores do talhão para garantir rede 100% navegável.
        </p>

        {params.autoBridgeSectors && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-700 font-medium">Raio máximo de ponte</span>
              <span className="font-mono text-slate-900">
                {params.maxBridgeMeters.toFixed(0)} m
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={80}
              step={1}
              value={params.maxBridgeMeters}
              onChange={(e) =>
                onChangeParams({
                  ...params,
                  maxBridgeMeters: Number(e.target.value),
                })
              }
              className="w-full gis-slider"
            />
          </div>
        )}
      </div>

      {/* Section 4: Layer Visibility */}
      <div className="p-4 space-y-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Layers className="w-3.5 h-3.5 text-slate-600" />
          <h2 className="text-sm font-semibold text-slate-900">Camadas Visíveis</h2>
        </div>

        {(
          [
            ['polygons', 'Polígonos originais'],
            ['centerlines', 'Linhas centrais suavizadas'],
            ['nodes', 'Nós e cruzamentos'],
            ['widthHeatmap', 'Faixa de largura dos trechos'],
            ['bridges', 'Pontes entre setores'],
            ['lengthLabels', 'Metragem nos trechos'],
            ['rawSkeleton', 'Esqueleto bruto (comparação)'],
          ] as Array<[keyof LayerVisibility, string]>
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex items-center justify-between text-xs text-slate-700 cursor-pointer py-0.5"
          >
            <span>{label}</span>
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={(e) =>
                onChangeLayers({ ...layers, [key]: e.target.checked })
              }
              className="w-3.5 h-3.5 accent-emerald-700 rounded cursor-pointer"
            />
          </label>
        ))}
      </div>
    </aside>
  );
};
