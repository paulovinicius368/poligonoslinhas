import React, { useMemo, useState } from 'react';
import { LocateFixed, Search } from 'lucide-react';
import type { GraphEdge, NetworkResult } from '../types/gis';

interface SegmentTableProps {
  network: NetworkResult;
  selectedEdgeId: string | null;
  onFocusEdge: (edge: GraphEdge) => void;
}

export const SegmentTable: React.FC<SegmentTableProps> = ({
  network,
  selectedEdgeId,
  onFocusEdge,
}) => {
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | 'principal' | 'secundario' | 'ponte'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return network.edges.filter((e) => {
      if (classFilter !== 'all' && e.roadClass !== classFilter) return false;
      if (!q) return true;
      return (
        e.id.toLowerCase().includes(q) ||
        e.startNodeId.toLowerCase().includes(q) ||
        e.endNodeId.toLowerCase().includes(q) ||
        e.roadClass.toLowerCase().includes(q)
      );
    });
  }, [network.edges, query, classFilter]);

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Tabela Topológica de Trechos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">
            {filtered.length} de {network.edges.length} trechos · {(network.stats.totalLengthMeters / 1000).toFixed(2)} km totais
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar trecho ou nó..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-300 text-slate-800 focus:outline-none focus:border-emerald-700 w-48"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', 'Todos'],
                ['principal', 'Principais'],
                ['secundario', 'Secundários'],
                ['ponte', 'Pontes'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setClassFilter(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  classFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
            Nenhum trecho encontrado com os filtros aplicados.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-6">Trecho</th>
                <th className="py-2.5 px-4">Classificação</th>
                <th className="py-2.5 px-4">Conexão (Nós)</th>
                <th className="py-2.5 px-4 text-right">Comprimento</th>
                <th className="py-2.5 px-4 text-right">Largura Média</th>
                <th className="py-2.5 px-4 text-right">Largura Mín.</th>
                <th className="py-2.5 px-4 text-right">Setor</th>
                <th className="py-2.5 px-6 text-right">Localizar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filtered.map((edge) => {
                const isSelected = edge.id === selectedEdgeId;
                return (
                  <tr
                    key={edge.id}
                    className={`transition-colors ${
                      isSelected ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2.5 px-6 font-mono font-semibold text-slate-900">
                      {edge.id}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">
                      {edge.roadClass === 'principal'
                        ? 'Principal'
                        : edge.roadClass === 'ponte'
                          ? 'Ponte de setor'
                          : 'Secundário'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">
                      {edge.startNodeId} ↔ {edge.endNodeId}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">
                      {edge.lengthMeters.toFixed(1)} m
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">
                      {edge.avgWidthMeters.toFixed(1)} m
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono ${
                        edge.minWidthMeters < 5.0 ? 'text-amber-700 font-semibold' : 'text-slate-700'
                      }`}
                    >
                      {edge.minWidthMeters.toFixed(1)} m
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                      {edge.componentId + 1}
                    </td>
                    <td className="py-2.5 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => onFocusEdge(edge)}
                        className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-medium whitespace-nowrap"
                      >
                        <LocateFixed className="w-3.5 h-3.5" />
                        <span>Ver no mapa</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
