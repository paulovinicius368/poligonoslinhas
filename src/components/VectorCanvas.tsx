import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  Maximize2,
  Minus,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import type {
  GraphEdge,
  GraphNode,
  LayerVisibility,
  NetworkResult,
  Point2D,
  RouteResult,
  WorkspaceView,
} from '../types/gis';
import { toGeo } from '../utils/centerlineEngine';

interface VectorCanvasProps {
  network: NetworkResult;
  layers: LayerVisibility;
  activeView: WorkspaceView;
  selectedEdgeId: string | null;
  selectedNodeId: string | null;
  routeStartNodeId: string | null;
  routeEndNodeId: string | null;
  route: RouteResult | null;
  focusBounds: { minX: number; minY: number; maxX: number; maxY: number; nonce: number } | null;
  onSelectEdge: (edgeId: string | null) => void;
  onSelectNode: (nodeId: string | null) => void;
  onRouteNodePick: (nodeId: string) => void;
}

interface ViewportTransform {
  cx: number; // world center X (meters)
  cy: number; // world center Y (meters)
  scale: number; // pixels per meter
}

const COMPONENT_COLORS = [
  '#15803d', // Emerald 700
  '#0284c7', // Sky 600
  '#9333ea', // Purple 600
  '#dc2626', // Red 600
  '#d97706', // Amber 600
  '#0d9488', // Teal 600
];

function pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function niceStep(rawMeters: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, rawMeters))));
  const norm = rawMeters / pow;
  if (norm < 1.5) return pow;
  if (norm < 3.5) return 2 * pow;
  if (norm < 7.5) return 5 * pow;
  return 10 * pow;
}

export const VectorCanvas: React.FC<VectorCanvasProps> = ({
  network,
  layers,
  activeView,
  selectedEdgeId,
  selectedNodeId,
  routeStartNodeId,
  routeEndNodeId,
  route,
  focusBounds,
  onSelectEdge,
  onSelectNode,
  onRouteNodePick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [canvasDark, setCanvasDark] = useState(false);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [transform, setTransform] = useState<ViewportTransform>({
    cx: 0,
    cy: 0,
    scale: 1,
  });

  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);
  const [cursorScreen, setCursorScreen] = useState<{ x: number; y: number } | null>(null);

  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startCx: number;
    startCy: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startCx: 0,
    startCy: 0,
    moved: false,
  });

  const fitToBounds = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }, padding = 0.84) => {
      const w = Math.max(10, bounds.maxX - bounds.minX);
      const h = Math.max(10, bounds.maxY - bounds.minY);
      const scaleX = (size.width * padding) / w;
      const scaleY = (size.height * padding) / h;
      setTransform({
        cx: (bounds.minX + bounds.maxX) * 0.5,
        cy: (bounds.minY + bounds.maxY) * 0.5,
        scale: Math.max(0.02, Math.min(40, Math.min(scaleX, scaleY))),
      });
    },
    [size.width, size.height]
  );

  // Measure container via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 50 && height > 50) {
          setSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-fit when network bounds change significantly
  const boundsKeyRef = useRef<string>('');
  useEffect(() => {
    const b = network.projection.boundsMeters;
    const key = `${b.minX.toFixed(1)}_${b.minY.toFixed(1)}_${b.maxX.toFixed(1)}_${b.maxY.toFixed(1)}`;
    if (boundsKeyRef.current !== key && size.width > 100) {
      boundsKeyRef.current = key;
      fitToBounds(b, 0.82);
    }
  }, [network.projection.boundsMeters, size.width, fitToBounds]);

  // Explicit focus fly-to from tables or panels
  useEffect(() => {
    if (!focusBounds) return;
    fitToBounds(focusBounds, 0.65);
  }, [focusBounds, fitToBounds]);

  const worldToScreen = useCallback(
    (pt: Point2D): Point2D => {
      const sx = size.width * 0.5 + (pt[0] - transform.cx) * transform.scale;
      const sy = size.height * 0.5 - (pt[1] - transform.cy) * transform.scale;
      return [sx, sy];
    },
    [size.width, size.height, transform]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number): Point2D => {
      const wx = transform.cx + (sx - size.width * 0.5) / transform.scale;
      const wy = transform.cy - (sy - size.height * 0.5) / transform.scale;
      return [wx, wy];
    },
    [size.width, size.height, transform]
  );

  // Render Vector Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Background
    ctx.fillStyle = canvasDark ? '#0b1311' : '#f5f7f4';
    ctx.fillRect(0, 0, size.width, size.height);

    // 2. Cartographic Grid
    const gridMeters = niceStep(95 / transform.scale);
    const leftW = transform.cx - (size.width * 0.5) / transform.scale;
    const rightW = transform.cx + (size.width * 0.5) / transform.scale;
    const bottomW = transform.cy - (size.height * 0.5) / transform.scale;
    const topW = transform.cy + (size.height * 0.5) / transform.scale;

    const startGx = Math.floor(leftW / gridMeters) * gridMeters;
    const startGy = Math.floor(bottomW / gridMeters) * gridMeters;

    ctx.strokeStyle = canvasDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = startGx; gx <= rightW; gx += gridMeters) {
      const [sx] = worldToScreen([gx, 0]);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, size.height);
    }
    for (let gy = startGy; gy <= topW; gy += gridMeters) {
      const [, sy] = worldToScreen([0, gy]);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(size.width, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    // 3. Dissolved Polygons
    if (layers.polygons) {
      for (const poly of network.dissolvedPolygonsMeters) {
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const [sx, sy] = worldToScreen(ring[i]);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
        }
        ctx.fillStyle = canvasDark
          ? 'rgba(34, 197, 94, 0.14)'
          : 'rgba(21, 128, 61, 0.13)';
        ctx.fill('evenodd');

        ctx.strokeStyle = canvasDark
          ? 'rgba(74, 222, 128, 0.42)'
          : 'rgba(21, 128, 61, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 4. Raw Pre-Smoothed Medial Skeleton (Optional comparison layer)
    if (layers.rawSkeleton) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = canvasDark
        ? 'rgba(148, 163, 184, 0.45)'
        : 'rgba(100, 116, 139, 0.5)';
      ctx.lineWidth = 1.25;
      for (const edge of network.edges) {
        if (edge.isBridge || edge.rawPoints.length < 2) continue;
        ctx.beginPath();
        edge.rawPoints.forEach((pt, idx) => {
          const [sx, sy] = worldToScreen(pt);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Width Heatmap Underlay
    if (layers.widthHeatmap) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const edge of network.edges) {
        if (edge.isBridge || edge.points.length < 2) continue;
        const pxWidth = Math.max(4, Math.min(28, edge.avgWidthMeters * transform.scale * 0.45));
        const w = edge.avgWidthMeters;
        let color = 'rgba(21, 128, 61, 0.30)'; // >= 8m wide
        if (w < 5.2) color = 'rgba(220, 38, 38, 0.34)'; // narrow bottleneck
        else if (w < 8.0) color = 'rgba(217, 119, 6, 0.30)'; // medium

        ctx.strokeStyle = color;
        ctx.lineWidth = pxWidth;
        ctx.beginPath();
        edge.points.forEach((pt, idx) => {
          const [sx, sy] = worldToScreen(pt);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
      ctx.restore();
    }

    // 6. Smoothed Centerline Edges
    if (layers.centerlines) {
      const hasMultipleComponents = network.components.length > 1;
      for (const edge of network.edges) {
        if (edge.isBridge && !layers.bridges) continue;
        if (edge.points.length < 2) continue;

        const isSelected = edge.id === selectedEdgeId;
        const isHovered = hoveredEdge?.id === edge.id;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (edge.isBridge) {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = isSelected || isHovered ? '#ea580c' : '#d97706';
          ctx.lineWidth = isSelected || isHovered ? 3.5 : 2.5;
        } else {
          let strokeColor: string;
          if (hasMultipleComponents) {
            strokeColor =
              COMPONENT_COLORS[edge.componentId % COMPONENT_COLORS.length];
          } else if (edge.roadClass === 'principal') {
            strokeColor = canvasDark ? '#34d399' : '#0f5132';
          } else {
            strokeColor = canvasDark ? '#e2e8f0' : '#0f172a';
          }

          if (isSelected || isHovered) {
            // Subtle halo under selected/hovered edge
            ctx.strokeStyle = canvasDark
              ? 'rgba(251, 191, 36, 0.45)'
              : 'rgba(217, 119, 6, 0.35)';
            ctx.lineWidth = 8;
            ctx.beginPath();
            edge.points.forEach((pt, idx) => {
              const [sx, sy] = worldToScreen(pt);
              if (idx === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            });
            ctx.stroke();
          }

          ctx.strokeStyle = isSelected
            ? '#d97706'
            : strokeColor;
          ctx.lineWidth =
            edge.roadClass === 'principal'
              ? isSelected || isHovered
                ? 4.0
                : 3.0
              : isSelected || isHovered
                ? 3.2
                : 2.0;
        }

        ctx.beginPath();
        edge.points.forEach((pt, idx) => {
          const [sx, sy] = worldToScreen(pt);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
        ctx.restore();

        // Optional length labels
        if (layers.lengthLabels && edge.lengthMeters * transform.scale > 48) {
          const midPt = edge.points[Math.floor(edge.points.length * 0.5)];
          const [mx, my] = worldToScreen(midPt);
          const label = `${edge.lengthMeters.toFixed(0)} m`;
          ctx.save();
          ctx.font = '500 10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = canvasDark
            ? 'rgba(15, 23, 42, 0.85)'
            : 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(mx - tw * 0.5 - 4, my - 8, tw + 8, 16);
          ctx.fillStyle = canvasDark ? '#e2e8f0' : '#1e293b';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, mx, my);
          ctx.restore();
        }
      }
    }

    // 7. Active Route Overlay
    if (route && route.found && route.polylineMeters.length >= 2) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Outer white/dark casing
      ctx.strokeStyle = canvasDark ? '#0b1311' : '#ffffff';
      ctx.lineWidth = 8.5;
      ctx.beginPath();
      route.polylineMeters.forEach((pt, idx) => {
        const [sx, sy] = worldToScreen(pt);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();

      // Primary Amber Route Line
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      route.polylineMeters.forEach((pt, idx) => {
        const [sx, sy] = worldToScreen(pt);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();

      // Directional chevrons every ~55px along route
      let accumPx = 0;
      const chevronSpacing = 60;
      for (let i = 1; i < route.polylineMeters.length; i++) {
        const [x1, y1] = worldToScreen(route.polylineMeters[i - 1]);
        const [x2, y2] = worldToScreen(route.polylineMeters[i]);
        const segPx = Math.hypot(x2 - x1, y2 - y1);
        if (segPx < 1) continue;
        accumPx += segPx;
        if (accumPx >= chevronSpacing) {
          accumPx = 0;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const mx = (x1 + x2) * 0.5;
          const my = (y1 + y2) * 0.5;
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(angle);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-4, -3.5);
          ctx.lineTo(3, 0);
          ctx.lineTo(-4, 3.5);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 8. Topological Nodes (Junctions, Endpoints, Bridges)
    if (layers.nodes || activeView === 'routing' || activeView === 'connectivity') {
      const hasMulti = network.components.length > 1;
      for (const node of network.nodes) {
        const [sx, sy] = worldToScreen(node.point);
        const isStart = node.id === routeStartNodeId;
        const isEnd = node.id === routeEndNodeId;
        const isSelected = node.id === selectedNodeId;
        const isHovered = hoveredNode?.id === node.id;

        if (isStart || isEnd) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, 10, 0, Math.PI * 2);
          ctx.fillStyle = isStart ? '#15803d' : '#dc2626';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(isStart ? 'A' : 'B', sx, sy + 0.5);
          ctx.restore();
          continue;
        }

        if (!layers.nodes && activeView !== 'routing' && !isSelected && !isHovered) {
          continue;
        }

        ctx.save();
        const r =
          node.kind === 'junction'
            ? isSelected || isHovered
              ? 6.5
              : 4.5
            : isSelected || isHovered
              ? 5.5
              : 3.5;

        const baseColor = hasMulti
          ? COMPONENT_COLORS[node.componentId % COMPONENT_COLORS.length]
          : node.kind === 'bridge'
            ? '#d97706'
            : node.kind === 'junction'
              ? '#15803d'
              : '#475569';

        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected || isHovered ? '#ea580c' : baseColor;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = canvasDark ? '#0b1311' : '#ffffff';
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }, [
    size,
    transform,
    network,
    layers,
    canvasDark,
    selectedEdgeId,
    selectedNodeId,
    hoveredEdge,
    hoveredNode,
    routeStartNodeId,
    routeEndNodeId,
    route,
    activeView,
    worldToScreen,
  ]);

  // Hit-testing helper
  const findHit = useCallback(
    (sx: number, sy: number) => {
      const worldPt = screenToWorld(sx, sy);
      const nodeToleranceMeters = 11 / transform.scale;
      const edgeToleranceMeters = 8 / transform.scale;

      let bestNode: GraphNode | null = null;
      let bestNodeDist = nodeToleranceMeters;
      for (const node of network.nodes) {
        const d = Math.hypot(worldPt[0] - node.point[0], worldPt[1] - node.point[1]);
        if (d < bestNodeDist) {
          bestNodeDist = d;
          bestNode = node;
        }
      }

      if (bestNode) {
        return { node: bestNode, edge: null, worldPt };
      }

      let bestEdge: GraphEdge | null = null;
      let bestEdgeDist = edgeToleranceMeters;
      for (const edge of network.edges) {
        if (edge.isBridge && !layers.bridges) continue;
        for (let i = 1; i < edge.points.length; i++) {
          const d = pointToSegmentDist(worldPt, edge.points[i - 1], edge.points[i]);
          if (d < bestEdgeDist) {
            bestEdgeDist = d;
            bestEdge = edge;
          }
        }
      }

      return { node: null, edge: bestEdge, worldPt };
    },
    [network.nodes, network.edges, layers.bridges, screenToWorld, transform.scale]
  );

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextScale = Math.max(0.02, Math.min(60, transform.scale * zoomFactor));

    const nextCx = before[0] - (sx - size.width * 0.5) / nextScale;
    const nextCy = before[1] + (sy - size.height * 0.5) / nextScale;
    setTransform({ cx: nextCx, cy: nextCy, scale: nextScale });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startCx: transform.cx,
      startCy: transform.cy,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setCursorScreen({ x: sx, y: sy });

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragRef.current.moved = true;
      }
      setTransform((prev) => ({
        ...prev,
        cx: dragRef.current.startCx - dx / prev.scale,
        cy: dragRef.current.startCy + dy / prev.scale,
      }));
      return;
    }

    const hit = findHit(sx, sy);
    setCursorWorld(hit.worldPt);
    setHoveredNode(hit.node);
    setHoveredEdge(hit.edge);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (wasMoved) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = findHit(sx, sy);

    if (activeView === 'routing') {
      if (hit.node) {
        onRouteNodePick(hit.node.id);
      } else if (hit.edge) {
        // Snap to nearest endpoint of clicked edge
        const sn = network.nodes.find((n) => n.id === hit.edge!.startNodeId);
        const en = network.nodes.find((n) => n.id === hit.edge!.endNodeId);
        if (sn && en) {
          const ds = Math.hypot(hit.worldPt[0] - sn.point[0], hit.worldPt[1] - sn.point[1]);
          const de = Math.hypot(hit.worldPt[0] - en.point[0], hit.worldPt[1] - en.point[1]);
          onRouteNodePick(ds <= de ? sn.id : en.id);
        }
      }
      return;
    }

    if (hit.node) {
      onSelectNode(hit.node.id);
      onSelectEdge(null);
    } else if (hit.edge) {
      onSelectEdge(hit.edge.id);
      onSelectNode(null);
    } else {
      onSelectEdge(null);
      onSelectNode(null);
    }
  };

  // Scale bar calculation
  const scaleBarMeters = niceStep(90 / transform.scale);
  const scaleBarPx = Math.max(36, Math.min(160, scaleBarMeters * transform.scale));
  const scaleBarLabel =
    scaleBarMeters >= 1000
      ? `${(scaleBarMeters / 1000).toFixed(1)} km`
      : `${scaleBarMeters.toFixed(0)} m`;

  const cursorGeo =
    cursorWorld && network.projection.isGeographic
      ? toGeo(cursorWorld, network.projection)
      : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-slate-100"
    >
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          dragRef.current.active = false;
          setHoveredEdge(null);
          setHoveredNode(null);
          setCursorScreen(null);
        }}
        style={{ width: size.width, height: size.height }}
        className={`block ${
          hoveredNode || hoveredEdge
            ? 'cursor-pointer'
            : activeView === 'routing'
              ? 'cursor-crosshair'
              : 'cursor-grab active:cursor-grabbing'
        }`}
      />

      {/* Top-right Map Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-1.5">
        <div className="flex flex-col bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() =>
              setTransform((p) => ({ ...p, scale: Math.min(60, p.scale * 1.35) }))
            }
            title="Aproximar zoom"
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors border-b border-slate-200"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setTransform((p) => ({ ...p, scale: Math.max(0.02, p.scale / 1.35) }))
            }
            title="Afastar zoom"
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors border-b border-slate-200"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => fitToBounds(network.projection.boundsMeters, 0.82)}
            title="Enquadrar toda a fazenda"
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors border-b border-slate-200"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setCanvasDark((d) => !d)}
            title={canvasDark ? 'Tema claro do mapa' : 'Tema escuro técnico'}
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {canvasDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Top-left Legend & Quick Hint */}
      <div className="absolute top-4 left-4 pointer-events-none">
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-2 shadow-sm text-xs text-slate-700 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-emerald-700/20 border border-emerald-700/60 inline-block" />
            <span>Polígono</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-emerald-800 inline-block" />
            <span>Eixo Principal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-slate-900 inline-block" />
            <span>Secundário</span>
          </div>
          {network.stats.bridgeCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-b-2 border-dashed border-amber-600 inline-block" />
              <span>Ponte de Setor</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom-left Scale Bar & North Indicator */}
      <div className="absolute bottom-4 left-4 pointer-events-none flex items-center gap-3 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
        <div className="flex items-center gap-1.5 text-slate-600 pr-2 border-r border-slate-200">
          <Compass className="w-3.5 h-3.5 text-emerald-700" />
          <span className="text-[11px] font-semibold">N</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-mono text-slate-700 leading-none">
            {scaleBarLabel}
          </span>
          <div
            style={{ width: `${scaleBarPx}px` }}
            className="h-1.5 border-x border-b border-slate-800"
          />
        </div>
      </div>

      {/* Bottom-right Coordinate Readout */}
      {cursorWorld && (
        <div className="absolute bottom-4 right-4 pointer-events-none bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm text-[11px] font-mono text-slate-700">
          {cursorGeo ? (
            <span>
              Lat {cursorGeo[1].toFixed(6)} · Lon {cursorGeo[0].toFixed(6)}
            </span>
          ) : (
            <span>
              X {cursorWorld[0].toFixed(1)} m · Y {cursorWorld[1].toFixed(1)} m
            </span>
          )}
        </div>
      )}

      {/* Hover Tooltip */}
      {cursorScreen && (hoveredEdge || hoveredNode) && (
        <div
          style={{
            left: Math.min(size.width - 210, cursorScreen.x + 14),
            top: Math.max(12, cursorScreen.y - 38),
          }}
          className="absolute pointer-events-none bg-slate-900 text-white rounded-md px-2.5 py-1.5 shadow-md text-xs z-20"
        >
          {hoveredNode ? (
            <div className="flex items-center gap-2 font-mono">
              <span className="font-semibold text-emerald-300">{hoveredNode.id}</span>
              <span>·</span>
              <span>
                {hoveredNode.kind === 'junction'
                  ? `Cruzamento (${hoveredNode.degree} vias)`
                  : hoveredNode.kind === 'bridge'
                    ? 'Ponte de Setor'
                    : 'Extremidade'}
              </span>
              <span>·</span>
              <span>{(hoveredNode.halfWidthMeters * 2).toFixed(1)} m</span>
            </div>
          ) : hoveredEdge ? (
            <div className="flex items-center gap-2 font-mono">
              <span className="font-semibold text-emerald-300">{hoveredEdge.id}</span>
              <span>·</span>
              <span>{hoveredEdge.lengthMeters.toFixed(1)} m</span>
              <span>·</span>
              <span>Larg. {hoveredEdge.avgWidthMeters.toFixed(1)} m</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
