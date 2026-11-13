declare module 'shpjs' {
  interface ShpFeatureCollection {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      properties?: Record<string, unknown> | null;
      geometry: {
        type: string;
        coordinates: unknown;
      } | null;
    }>;
  }

  function shp(
    buffer: ArrayBuffer | Uint8Array | string
  ): Promise<ShpFeatureCollection | ShpFeatureCollection[]>;

  export default shp;
}
