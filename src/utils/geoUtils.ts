import JSZip from 'jszip';
import { kml } from '@tmcw/togeojson';
import { area as turfArea, length as turfLength, polygon as turfPolygon, lineString as turfLineString } from '@turf/turf';
import { GeoZone, GeoGroup } from '../types';

// Comprimir imagen a base64 con calidad reducida para ahorrar espacio
export const compressImage = (file: File, maxWidth: number = 800, quality: number = 0.75): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Redimensionar si es más grande que el máximo
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo obtener el contexto del canvas'));
          return;
        }

        // Draw image with smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Compress to JPEG with reduced quality
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => reject(new Error('Error al cargar la imagen'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsDataURL(file);
  });
};

// Exporta zonas SIN imágenes (para compartir datos sin archivos pesados)
export const exportZonesWithoutImages = (zones: GeoZone[], groups: GeoGroup[] = []): string => {
  const features = zones.map(zone => {
    let geometry: any;
    if (zone.type === 'polygon') {
      const coords = zone.coordinates as [number, number][];
      geometry = {
        type: 'Polygon',
        coordinates: [[...coords, coords[0]].map(p => [p[1], p[0]])]
      };
    } else if (zone.type === 'polyline') {
      const coords = zone.coordinates as [number, number][];
      geometry = {
        type: 'LineString',
        coordinates: coords.map(p => [p[1], p[0]])
      };
    } else {
      const coords = zone.coordinates as [number, number];
      geometry = {
        type: 'Point',
        coordinates: [coords[1], coords[0]]
      };
    }

    const group = zone.groupId ? groups.find(g => g.id === zone.groupId) : null;

    return {
      type: 'Feature',
      properties: {
        name: zone.name,
        color: zone.color,
        area: zone.area,
        perimeter: zone.perimeter,
        distance: zone.distance,
        description: zone.description,
        groupId: zone.groupId,
        groupName: group ? group.name : null,
        noteText: zone.noteText,
        // NO incluye noteImage - solo datos
      },
      geometry
    };
  });

  const featureCollection = {
    type: 'FeatureCollection',
    features
  };

  return JSON.stringify(featureCollection, null, 2);
};

export const parseKMZ = async (file: File): Promise<GeoZone[]> => {
  const zip = new JSZip();
  const content = await zip.loadAsync(file);
  
  // Find the first .kml file
  const kmlFile = Object.keys(content.files).find(name => name.endsWith('.kml'));
  if (!kmlFile) throw new Error('No KML file found in KMZ');
  
  const kmlText = await content.files[kmlFile].async('text');
  const parser = new DOMParser();
  const kmlDom = parser.parseFromString(kmlText, 'text/xml');
  
  const geojson = kml(kmlDom);
  return convertGeoJSONToZones(geojson);
};

export const calculateArea = (points: [number, number][]): number => {
  if (points.length < 3) return 0;
  try {
    const poly = turfPolygon([[...points, points[0]].map(p => [p[1], p[0]])]);
    return turfArea(poly);
  } catch (e) {
    console.error('Error calculating area:', e);
    return 0;
  }
};

export const calculateDistance = (points: [number, number][]): number => {
  if (points.length < 2) return 0;
  try {
    const line = turfLineString(points.map(p => [p[1], p[0]]));
    return turfLength(line, { units: 'meters' });
  } catch (e) {
    console.error('Error calculating distance:', e);
    return 0;
  }
};

export const formatArea = (area: number): string => {
  if (area >= 1000000) {
    return `${(area / 1000000).toFixed(2)} km²`;
  }
  if (area >= 10000) {
    return `${(area / 10000).toFixed(2)} ha`;
  }
  return `${area.toFixed(2)} m²`;
};

export const formatDistance = (distance: number): string => {
  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(2)} km`;
  }
  return `${distance.toFixed(2)} m`;
};

export const exportToGeoJSON = (zones: GeoZone[], groups: GeoGroup[] = []): string => {
  const features = zones.map(zone => {
    let geometry: any;
    if (zone.type === 'polygon') {
      const coords = zone.coordinates as [number, number][];
      geometry = {
        type: 'Polygon',
        coordinates: [[...coords, coords[0]].map(p => [p[1], p[0]])]
      };
    } else if (zone.type === 'polyline') {
      const coords = zone.coordinates as [number, number][];
      geometry = {
        type: 'LineString',
        coordinates: coords.map(p => [p[1], p[0]])
      };
    } else {
      const coords = zone.coordinates as [number, number];
      geometry = {
        type: 'Point',
        coordinates: [coords[1], coords[0]]
      };
    }

    const group = zone.groupId ? groups.find(g => g.id === zone.groupId) : null;

    return {
      type: 'Feature',
      properties: {
        name: zone.name,
        color: zone.color,
        area: zone.area,
        perimeter: zone.perimeter,
        distance: zone.distance,
        description: zone.description,
        groupId: zone.groupId,
        groupName: group ? group.name : null,
        noteText: zone.noteText,
        noteImage: zone.noteImage
      },
      geometry
    };
  });

  const featureCollection = {
    type: 'FeatureCollection',
    features
  };

  return JSON.stringify(featureCollection, null, 2);
};

export const parseKML = (kmlText: string): GeoZone[] => {
  const parser = new DOMParser();
  const kmlDom = parser.parseFromString(kmlText, 'text/xml');
  const geojson = kml(kmlDom);
  return convertGeoJSONToZones(geojson);
};

export const parseGeoJSON = (jsonString: string): GeoZone[] => {
  try {
    const geojson = JSON.parse(jsonString);
    return convertGeoJSONToZones(geojson);
  } catch (e) {
    console.error('Error parsing GeoJSON:', e);
    return [];
  }
};

const convertGeoJSONToZones = (geojson: any): GeoZone[] => {
  const zones: GeoZone[] = [];
  
  if (geojson.type === 'FeatureCollection') {
    geojson.features.forEach((feature: any, index: number) => {
      const id = `import-${Date.now()}-${index}`;
      const name = feature.properties?.name || `Elemento ${index + 1}`;
      const color = feature.properties?.color || feature.properties?.fill || '#3b82f6';
      const description = feature.properties?.description;
      const noteText = feature.properties?.noteText;
      const noteImage = feature.properties?.noteImage;
      
      if (feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0].map((c: any) => [c[1], c[0]] as [number, number]);
        const area = calculateArea(coords);
        const perimeter = calculateDistance([...coords, coords[0]]);
        
        zones.push({
          id,
          name,
          type: 'polygon',
          coordinates: coords,
          area,
          perimeter,
          color,
          description,
          noteText,
          noteImage
        });
      } else if (feature.geometry.type === 'LineString') {
        const coords = feature.geometry.coordinates.map((c: any) => [c[1], c[0]] as [number, number]);
        const distance = calculateDistance(coords);
        
        zones.push({
          id,
          name,
          type: 'polyline',
          coordinates: coords,
          distance,
          color,
          description,
          noteText,
          noteImage
        });
      } else if (feature.geometry.type === 'Point') {
        const coords = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number];
        zones.push({
          id,
          name,
          type: 'point',
          coordinates: coords,
          color,
          description,
          noteText,
          noteImage
        });
      }
    });
  }
  
  return zones;
};
