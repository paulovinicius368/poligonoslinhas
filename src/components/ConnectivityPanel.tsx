import React from 'react';
import { AlertTriangle, CheckCircle2, LocateFixed } from 'lucide-react';
import type { NetworkResult } from '../types/gis';

interface ConnectivityPanelProps {
  network: NetworkResult;
  onFocusBox: (minX: number, minY: number, maxX: number, maxY: number) => void;
  onEnableAutoBridge: () => void;
}

export const ConnectivityPanel: React.FC<ConnectivityPanelProps> = ({
  network,
  onFocusBox,
  onEnableAutoBridge,
}) => {
  const isFullyConnected = network.components.length <= 1;
  const bridges = network.edges.filter((e) => e.isBridge);

  return (
    <aside className="w-[310px] shrink-0 bg-white border-l border-slate-200 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">
          Diagnóstico de Conectividade
        </h2>
        <div className="mt-2.5 flex items-start gap-2.5">
          {isFullyConnected ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="text-xs leading-relaxed">
            {isFullyConnected ? (
              <span className="text-slate-700">
                <strong className="text-emerald-800 font-semibold">Rede 100% conectada.</strong> Todos os setores do talhão pertencem a um único grafo navegável.
              </span>
            ) : (
              <span className="text-slate-700">
                <strong className="text-amber-700 font-semibold">
                  {network.components.length} setores isolados detectados.
                </strong>{' '}
                Ative ou aumente o raio de ponte para ligar automaticamente os setores.
              </span>
            )}
          </div>
        </div>

        {!isFullyConnected && (
          <button
            type="button"
            onClick={onEnableAutoBridge}
            className="mt-3 w-full py-2 px-3 rounded-md bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 transition-colors"
          >
            Conectar setores automaticamente
          </button>
        )}
      </div>

      {/* Topological Summary */}
      <div className="p-4 border-b border-slate-200 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-[11px] text-slate-500">Cruzamentos</div>
          <div className="text-base font-semibold font-mono text-slate-900">
            {network.stats.junctionCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Extremidades</div>
          <div className="text-base font-semibold font-mono text-slate-900">
            {network.stats.endpointCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Largura média</div>
          <div className="text-base font-semibold font-mono text-slate-900">
            {network.stats.avgWidthMeters.toFixed(1)} m
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Faixa de largura</div>
          <div className="text-sm font-medium font-mono text-slate-900 mt-0.5">
            {network.stats.minWidthMeters.toFixed(1)}–{network.stats.maxWidthMeters.toFixed(1)} m
          </div>
        </div>
      </div>

      {/* Connected Components List */}
      <div className="p-4 border-b border-slate-200">
        <h3 className="text-xs font-semibold text-slate-900 mb-2">
          Componentes Topológicos ({network.components.length})
        </h3>
        <div className="space-y-1.5">
          {network.components.map((comp) => (
            <button
              key={comp.id}
              type="button"
              onClick={() => {
                const edges = network.edges.filter((e) => e.componentId === comp.id);
                if (edges.length === 0) return;
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;
                for (const e of edges) {
                  for (const [x, y] of e.points) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                  }
                }
                onFocusBox(minX - 20, minY - 20, maxX + 20, maxY + 20);
              }}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-md border border-slate-200 hover:bg-slate-50 text-left text-xs transition-colors"
            >
              <div>
                <div className="font-medium text-slate-900">
                  Setor / Componente {comp.id + 1}
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  {comp.edgeCount} trechos · {(comp.totalLengthMeters / 1000).toFixed(2)} km
                </div>
              </div>
              <LocateFixed className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Sector Bridges Created */}
      <div className="p-4">
        <h3 className="text-xs font-semibold text-slate-900 mb-2">
          Pontes Automáticas ({bridges.length})
        </h3>
        {bridges.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nenhuma ponte artificial necessária ou raio de conexão abaixo da lacuna.
          </p>
        ) : (
          <div className="space-y-1.5">
            {bridges.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  const xs = b.points.map((p) => p[0]);
                  const ys = b.points.map((p) => p[1]);
                  onFocusBox(
                    Math.min(...xs) - 35,
                    Math.min(...ys) - 35,
                    Math.max(...xs) + 35,
                    Math.max(...ys) + 35
                  );
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-md border border-amber-200 bg-amber-50/50 hover:bg-amber-50 text-left text-xs transition-colors"
              >
                <div>
                  <div className="font-medium font-mono text-slate-900">
                    {b.id} ({b.startNodeId} ↔ {b.endNodeId})
                  </div>
                  <div className="text-[11px] font-mono text-amber-800">
                    Lacuna fechada: {b.lengthMeters.toFixed(1)} m
                  </div>
                </div>
                <LocateFixed className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
