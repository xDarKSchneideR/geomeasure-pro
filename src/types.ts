import { FeatureCollection } from 'geojson';

export interface GeoZone {
  id: string;
  name: string;
  type: 'polygon' | 'polyline' | 'point';
  coordinates: [number, number][] | [number, number];
  area?: number; // in square meters
  perimeter?: number; // in meters
  distance?: number; // in meters
  color: string;
  description?: string;
  groupId?: string | null;
  noteText?: string;
  noteImage?: string;
  emoji?: string;
}

export interface GeoGroup {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface WMSLayer {
  id: string;
  name: string;
  url: string;
  layers: string;
  visible: boolean;
  opacity: number;
}

export interface AppState {
  zones: GeoZone[];
  groups: GeoGroup[];
  wmsLayers: WMSLayer[];
  selectedZoneId: string | null;
  selectedGroupIds: string[];
  isDrawing: boolean;
  isEditing: boolean;
  drawMode: 'polygon' | 'polyline' | 'point' | null;
  tempPoints: [number, number][];
  mapCenter: [number, number];
  mapZoom: number;
  multiSelectedIds: string[];
  isToolsExpanded?: boolean;
  filterByGroup?: boolean;
}
