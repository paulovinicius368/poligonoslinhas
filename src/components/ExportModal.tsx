import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import type { NetworkResult, RouteResult } from '../types/gis';
import {
  exportNetworkToCSV,
  exportNetworkToGeoJSON,
  exportNetworkToGPX,
  exportNetworkToKML,
} from '../utils/gisParsers';

interface ExportModalProps {
  open: boolean;
  network: NetworkResult;
  route: RouteResult | null;
  sourceName: string;
  onClose: () => void;
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  network,
  route,
  sourceName,
  onClose,
}) => {
  const [includeNodes, setIncludeNodes] = useState(true);
  const [includeRoute, setIncludeRoute] = useState(true);

  if (!open) return null;

  const baseName = sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'carreadores';

  const activeRoute = includeRoute ? route : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Exportar Rede de Carreadores
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {network.edges.length} trechos · {(network.stats.totalLengthMeters / 1000).toFixed(2)} km · {network.nodes.length} nós
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2 border-b border-slate-200 pb-4">
            <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
              <span>Incluir camada de nós topológicos (GeoJSON)</span>
              <input
                type="checkbox"
                checked={includeNodes}
                onChange={(e) => setIncludeNodes(e.target.checked)}
                className="w-4 h-4 accent-emerald-700 rounded"
              />
            </label>
            {route?.found && (
              <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
                <span>
                  Incluir rota ativa ({(route.totalLengthMeters / 1000).toFixed(2)} km)
                </span>
                <input
                  type="checkbox"
                  checked={includeRoute}
                  onChange={(e) => setIncludeRoute(e.target.checked)}
                  className="w-4 h-4 accent-emerald-700 rounded"
                />
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                triggerDownload(
                  `${baseName}_eixos.geojson`,
                  exportNetworkToGeoJSON(network, includeNodes, activeRoute),
                  'application/geo+json'
                );
              }}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 text-left transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">GeoJSON</div>
                <div className="text-[11px] text-slate-500">
                  QGIS, ArcGIS, Leaflet
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-700 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerDownload(
                  `${baseName}_eixos.kml`,
                  exportNetworkToKML(network, activeRoute),
                  'application/vnd.google-earth.kml+xml'
                );
              }}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 text-left transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">KML</div>
                <div className="text-[11px] text-slate-500">
                  Google Earth, Monitores
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-700 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerDownload(
                  `${baseName}_rotas.gpx`,
                  exportNetworkToGPX(network, activeRoute),
                  'application/gpx+xml'
                );
              }}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 text-left transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">GPX</div>
                <div className="text-[11px] text-slate-500">
                  GPS Agrícola e Piloto Automático
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-700 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerDownload(
                  `${baseName}_trechos.csv`,
                  exportNetworkToCSV(network),
                  'text/csv;charset=utf-8'
                );
              }}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 text-left transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">CSV Topológico</div>
                <div className="text-[11px] text-slate-500">
                  Tabela de larguras e comprimentos
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-700 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
