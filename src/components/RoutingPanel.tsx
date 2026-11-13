import React from 'react';
import { ArrowLeftRight, Navigation, Trash2 } from 'lucide-react';
import type { NetworkResult, RouteResult } from '../types/gis';

interface RoutingPanelProps {
  network: NetworkResult;
  startNodeId: string | null;
  endNodeId: string | null;
  minVehicleWidth: number;
  route: RouteResult | null;
  onChangeStart: (id: string | null) => void;
  onChangeEnd: (id: string | null) => void;
  onSwap: () => void;
  onClear: () => void;
  onChangeMinWidth: (w: number) => void;
  onAutoPickDemoRoute: () => void;
  onOpenExport: () => void;
}

export const RoutingPanel: React.FC<RoutingPanelProps> = ({
  network,
  startNodeId,
  endNodeId,
  minVehicleWidth,
  route,
  onChangeStart,
  onChangeEnd,
  onSwap,
  onClear,
  onChangeMinWidth,
  onAutoPickDemoRoute,
  onOpenExport,
}) => {
  return (
    <aside className="w-[310px] shrink-0 bg-white border-l border-slate-200 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-slate-900">
            Roteamento de Carreadores
          </h2>
          {(startNodeId || endNodeId) && (
            <button
              type="button"
              onClick={onClear}
              title="Limpar rota"
              className="text-xs text-slate-500 hover:text-red-700 flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Clique nos nós do mapa ou selecione os pontos abaixo para traçar a menor rota navegável entre setores.
        </p>
      </div>

      <div className="p-4 border-b border-slate-200 space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">
            Ponto A (Origem)
          </label>
          <select
            value={startNodeId ?? ''}
            onChange={(e) => onChangeStart(e.target.value || null)}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-emerald-700"
          >
            <option value="">Clique no mapa ou escolha...</option>
            {network.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} — {n.kind === 'junction' ? 'Cruzamento' : n.kind === 'bridge' ? 'Ponte' : 'Ponta'} ({(n.halfWidthMeters * 2).toFixed(1)} m)
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={onSwap}
            disabled={!startNodeId && !endNodeId}
            className="px-2.5 py-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            <ArrowLeftRight className="w-3 h-3" />
            <span>Inverter A / B</span>
          </button>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">
            Ponto B (Destino)
          </label>
          <select
            value={endNodeId ?? ''}
            onChange={(e) => onChangeEnd(e.target.value || null)}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-emerald-700"
          >
            <option value="">Clique no mapa ou escolha...</option>
            {network.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} — {n.kind === 'junction' ? 'Cruzamento' : n.kind === 'bridge' ? 'Ponte' : 'Ponta'} ({(n.halfWidthMeters * 2).toFixed(1)} m)
              </option>
            ))}
          </select>
        </div>

        <div className="pt-2 border-t border-slate-200">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-700 font-medium">
              Largura mínima do maquinário
            </span>
            <span className="font-mono text-slate-900">
              {minVehicleWidth === 0 ? 'Livre' : `${minVehicleWidth.toFixed(1)} m`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={12}
            step={0.5}
            value={minVehicleWidth}
            onChange={(e) => onChangeMinWidth(Number(e.target.value))}
            className="w-full gis-slider"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Bloqueia automaticamente trechos mais estreitos que o implemento.
          </p>
        </div>

        {(!startNodeId || !endNodeId) && network.nodes.length >= 2 && (
          <button
            type="button"
            onClick={onAutoPickDemoRoute}
            className="w-full py-2 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Sugerir rota entre extremos</span>
          </button>
        )}
      </div>

      {/* Route Output */}
      <div className="p-4 flex-1">
        {!startNodeId || !endNodeId ? (
          <div className="text-xs text-slate-500 py-4 text-center">
            Defina a Origem (A) e o Destino (B) para calcular distância, gargalos e exportar para GPS.
          </div>
        ) : route && route.found ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-200">
              <div>
                <div className="text-[11px] text-slate-500">Distância total</div>
                <div className="text-lg font-semibold font-mono text-slate-900 mt-0.5">
                  {route.totalLengthMeters >= 1000
                    ? `${(route.totalLengthMeters / 1000).toFixed(2)} km`
                    : `${route.totalLengthMeters.toFixed(1)} m`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Largura mínima</div>
                <div className="text-lg font-semibold font-mono text-emerald-700 mt-0.5">
                  {route.minWidthMeters.toFixed(1)} m
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Trechos percorridos</div>
                <div className="text-sm font-medium font-mono text-slate-900 mt-0.5">
                  {route.edgeIds.length} trechos
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Conversões</div>
                <div className="text-sm font-medium font-mono text-slate-900 mt-0.5">
                  {route.turnCount} manobras
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-600 mb-1.5">
                Sequência de trechos
              </div>
              <div className="text-xs font-mono text-slate-700 leading-relaxed break-words">
                {route.edgeIds.join(' → ')}
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenExport}
              className="w-full py-2 px-4 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 transition-colors"
            >
              Exportar Rota (GPX / KML / GeoJSON)
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 leading-relaxed">
            {route?.reason ?? 'Não foi possível conectar Origem e Destino.'}
          </div>
        )}
      </div>
    </aside>
  );
};
