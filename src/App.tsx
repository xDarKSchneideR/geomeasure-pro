import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  Polygon, 
  Polyline, 
  Marker, 
  Popup, 
  Tooltip,
  WMSTileLayer,
  useMapEvents,
  useMap,
  ZoomControl
} from 'react-leaflet';
import * as L_raw from 'leaflet';
import { centroid as turfCentroid, polygon as turfPolygon, lineString as turfLineString } from '@turf/turf';
import MarkerClusterGroup_raw from 'react-leaflet-cluster';
import { 
  Map as MapIcon, 
  Layers, 
  Square, 
  Move, 
  Trash2, 
  Download, 
  Upload, 
  Info, 
  MousePointer2,
  MapPin,
  Maximize2,
  Menu,
  X,
  ChevronRight,
  Plus,
  Save,
  Ruler,
  Navigation,
  ExternalLink,
  LocateFixed,
  Edit3,
  FolderPlus,
  Folder,
  Settings2,
  Check,
  Palette,
  Undo2,
  Copy,
  CheckSquare,
  Search,
  Globe,
  Database,
  Heart,
  StickyNote,
  Image as ImageIcon,
  Type as TypeIcon,
  HelpCircle,
  AlertTriangle,
  BookOpen,
  MousePointer,
  Layers as LayersIcon,
  Wrench,
  LogIn,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng, toJpeg } from 'html-to-image';
import { saveAs } from 'file-saver';
import { GeoZone, AppState, GeoGroup, WMSLayer } from './types';
import { 
  parseKMZ, 
  parseKML,
  parseGeoJSON,
  calculateArea, 
  calculateDistance, 
  formatArea, 
  formatDistance,
  exportToGeoJSON,
  exportZonesWithoutImages,
  compressImage
} from './utils/geoUtils';

// Handle Leaflet ESM import issues
const L = (L_raw as any).default || L_raw;
const MarkerClusterGroup = (MarkerClusterGroup_raw as any).default || MarkerClusterGroup_raw;

// Fix Leaflet default icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const getZoneCenter = (zone: GeoZone): [number, number] => {
  if (zone.type === 'point') return zone.coordinates as [number, number];
  
  try {
    const coords = zone.coordinates as [number, number][];
    if (coords.length === 0) return [0, 0];
    
    // Convert to GeoJSON for turf (Leaflet uses [lat, lng], GeoJSON uses [lng, lat])
    let feature;
    if (zone.type === 'polygon') {
      // Ensure polygon is closed for turf
      const closedCoords = [...coords];
      if (closedCoords[0][0] !== closedCoords[closedCoords.length - 1][0] || 
          closedCoords[0][1] !== closedCoords[closedCoords.length - 1][1]) {
        closedCoords.push(closedCoords[0]);
      }
      feature = turfPolygon([closedCoords.map(c => [c[1], c[0]])]);
    } else {
      feature = turfLineString(coords.map(c => [c[1], c[0]]));
    }
    
    const centroid = turfCentroid(feature);
    return [centroid.geometry.coordinates[1], centroid.geometry.coordinates[0]];
  } catch (e) {
    // Fallback to simple average if turf fails
    const coords = zone.coordinates as [number, number][];
    if (!Array.isArray(coords) || coords.length === 0) return [0, 0];
    const lat = coords.reduce((sum, c) => sum + (Array.isArray(c) ? c[0] : 0), 0) / coords.length;
    const lng = coords.reduce((sum, c) => sum + (Array.isArray(c) ? c[1] : 0), 0) / coords.length;
    return [lat, lng];
  }
};

// Memoized Zone Layer Component for Performance
const ZoneLayer = React.memo(({ 
  zone, 
  isSelected, 
  isMultiSelected,
  isEditing, 
  onSelect, 
  onUpdateGeometry,
  layerRef
}: { 
  zone: GeoZone; 
  isSelected: boolean; 
  isMultiSelected: boolean;
  isEditing: boolean; 
  onSelect: (id: string) => void;
  onUpdateGeometry: (id: string, coords: [number, number][]) => void;
  layerRef: (id: string, el: L.Layer | null) => void;
}) => {
  const pathOptions = React.useMemo(() => ({ 
    fillColor: zone.color,
    color: isMultiSelected ? '#3b82f6' : zone.color, 
    fillOpacity: isSelected || isMultiSelected ? 0.4 : 0.2,
    weight: isSelected || isMultiSelected ? 4 : 2,
    dashArray: isMultiSelected ? '5, 5' : undefined,
    bubblingMouseEvents: false
  }), [zone.color, isSelected, isMultiSelected]);

  if (zone.type === 'polygon') {
    return (
      <React.Fragment>
        <Polygon 
          ref={(el) => layerRef(zone.id, el)}
          positions={zone.coordinates as [number, number][]}
          pathOptions={pathOptions}
          eventHandlers={{
            click: (e) => {
              onSelect(zone.id);
              const layer = e.target;
              if (layer.bringToFront) layer.bringToFront();
              L.DomEvent.stopPropagation(e);
            }
          }}
        >
          <Popup>
            <div className="p-1 font-sans">
              <h3 className="font-bold text-sm mb-1">{zone.name}</h3>
              <p className="text-xs">Área: {formatArea(zone.area || 0)}</p>
              <p className="text-xs">Perímetro: {formatDistance(zone.perimeter || 0)}</p>
              {zone.noteText && (
                <div className="mt-2 p-2 bg-slate-50 rounded border border-slate-100 italic text-[10px] text-slate-600">
                  {zone.noteText}
                </div>
              )}
              {zone.noteImage && (
                <div className="mt-2 rounded overflow-hidden border border-slate-100">
                  <img src={zone.noteImage} alt="Nota" className="w-full h-auto max-h-[100px] object-cover" referrerPolicy="no-referrer" />
                </div>
              )}
            </div>
          </Popup>
        </Polygon>
        {isEditing && (zone.coordinates as [number, number][]).map((coord, idx) => (
          <Marker 
            key={`${zone.id}-vertex-${idx}`}
            position={coord}
            draggable={true}
            icon={L.divIcon({ 
              className: 'bg-white w-3 h-3 rounded-full border-2 border-blue-600 shadow-md',
              iconSize: [12, 12],
              iconAnchor: [6, 6]
            })}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target;
                const position = marker.getLatLng();
                const newCoords = [...(zone.coordinates as [number, number][])];
                newCoords[idx] = [position.lat, position.lng];
                onUpdateGeometry(zone.id, newCoords);
              }
            }}
          />
        ))}
      </React.Fragment>
    );
  } else if (zone.type === 'polyline') {
    return (
      <React.Fragment>
        <Polyline 
          ref={(el) => layerRef(zone.id, el)}
          positions={zone.coordinates as [number, number][]}
          pathOptions={pathOptions}
          eventHandlers={{
            click: (e) => {
              onSelect(zone.id);
              const layer = e.target;
              if (layer.bringToFront) layer.bringToFront();
              L.DomEvent.stopPropagation(e);
            }
          }}
        >
          <Popup>
            <div className="p-1 font-sans">
              <h3 className="font-bold text-sm mb-1">{zone.name}</h3>
              <p className="text-xs">Distancia: {formatDistance(zone.distance || 0)}</p>
              {zone.noteText && (
                <div className="mt-2 p-2 bg-slate-50 rounded border border-slate-100 italic text-[10px] text-slate-600">
                  {zone.noteText}
                </div>
              )}
              {zone.noteImage && (
                <div className="mt-2 rounded overflow-hidden border border-slate-100">
                  <img 
                    src={zone.noteImage} 
                    alt="Nota" 
                    className="w-full h-auto max-h-[100px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    referrerPolicy="no-referrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullImageUrl(zone.noteImage);
                      setShowImageModal(true);
                    }}
                  />
                </div>
              )}
            </div>
          </Popup>
        </Polyline>
        {isEditing && (zone.coordinates as [number, number][]).map((coord, idx) => (
          <Marker 
            key={`${zone.id}-vertex-${idx}`}
            position={coord}
            draggable={true}
            icon={L.divIcon({ 
              className: 'bg-white w-3 h-3 rounded-full border-2 border-blue-600 shadow-md',
              iconSize: [12, 12],
              iconAnchor: [6, 6]
            })}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target;
                const position = marker.getLatLng();
                const newCoords = [...(zone.coordinates as [number, number][])];
                newCoords[idx] = [position.lat, position.lng];
                onUpdateGeometry(zone.id, newCoords);
              }
            }}
          />
        ))}
      </React.Fragment>
    );
  } else {
    return (
      <Marker 
        position={zone.coordinates as [number, number]}
        draggable={isEditing}
        icon={L.divIcon({ 
          className: 'flex items-center justify-center',
          html: `<div class="w-4 h-4 rounded-full border-2 border-white shadow-lg transition-all ${isSelected || isMultiSelected ? 'scale-125' : ''} ${isMultiSelected ? 'ring-4 ring-blue-500/50' : ''}" style="background-color: ${zone.color}"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })}
        eventHandlers={{
          click: (e) => {
            onSelect(zone.id);
            L.DomEvent.stopPropagation(e);
          },
          dragend: (e) => {
            const marker = e.target;
            const position = marker.getLatLng();
            onUpdateGeometry(zone.id, [position.lat, position.lng]);
          }
        }}
      >
        <Popup>
          <div className="p-1 font-sans">
            <h3 className="font-bold text-sm mb-1">{zone.name}</h3>
            <p className="text-xs">Punto de interés</p>
            {zone.noteText && (
              <div className="mt-2 p-2 bg-slate-50 rounded border border-slate-100 italic text-[10px] text-slate-600">
                {zone.noteText}
              </div>
            )}
              {zone.noteImage && (
                <div className="mt-2 rounded overflow-hidden border border-slate-100">
                  <img 
                    src={zone.noteImage} 
                    alt="Nota" 
                    className="w-full h-auto max-h-[100px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    referrerPolicy="no-referrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullImageUrl(zone.noteImage);
                      setShowImageModal(true);
                    }}
                  />
                </div>
              )}
          </div>
        </Popup>
      </Marker>
    );
  }
}, (prev, next) => {
  return prev.zone.id === next.zone.id && 
         prev.zone.name === next.zone.name &&
         prev.zone.color === next.zone.color &&
         prev.zone.coordinates === next.zone.coordinates &&
         prev.zone.noteText === next.zone.noteText &&
         prev.zone.noteImage === next.zone.noteImage &&
         prev.isSelected === next.isSelected && 
         prev.isEditing === next.isEditing &&
         prev.isMultiSelected === next.isMultiSelected;
});

// Map Events Component
const MapEvents = ({ 
  isDrawing, 
  drawMode, 
  onMapClick, 
  onMouseMove,
  onFinish
}: { 
  isDrawing: boolean; 
  drawMode: string | null; 
  onMapClick: (e: L.LeafletMouseEvent) => void;
  onMouseMove: (e: L.LeafletMouseEvent) => void;
  onFinish: () => void;
}) => {
  useMapEvents({
    click: (e) => {
      if (isDrawing) {
        onMapClick(e);
      }
    },
    mousemove: (e) => {
      if (isDrawing) {
        onMouseMove(e);
      }
    },
    dblclick: (e) => {
      if (isDrawing && (drawMode === 'polygon' || drawMode === 'polyline')) {
        onFinish();
        // Prevent map zoom on double click when finishing
        L.DomEvent.stopPropagation(e);
      }
    },
    contextmenu: (e) => {
      if (isDrawing && (drawMode === 'polygon' || drawMode === 'polyline')) {
        onFinish();
        // Prevent default context menu
        L.DomEvent.preventDefault(e);
      }
    }
  });
  return null;
};

// Map State Tracker Component
const MapStateTracker = ({ onMapMove }: { onMapMove: (center: [number, number], zoom: number) => void }) => {
  const map = useMap();
  
  useMapEvents({
    moveend: () => {
      const center = map.getCenter();
      onMapMove([center.lat, center.lng], map.getZoom());
    },
    zoomend: () => {
      const center = map.getCenter();
      onMapMove([center.lat, center.lng], map.getZoom());
    }
  });
  
  return null;
};

// Component to handle map view changes and fix rendering issues
const MapViewHandler = ({ 
  selectedZone, 
  sidebarOpen 
}: { 
  selectedZone: GeoZone | null; 
  sidebarOpen: boolean;
}) => {
  const map = useMap();

  // Fix gray areas when sidebar toggles
  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 300); // Match sidebar animation duration
  }, [sidebarOpen, map]);

  useEffect(() => {
    if (!selectedZone) return;

    if (selectedZone.type === 'point') {
      map.setView(selectedZone.coordinates as [number, number], 16, { animate: true });
    } else {
      const bounds = L.latLngBounds(selectedZone.coordinates as [number, number][]);
      map.fitBounds(bounds, { padding: [50, 50], animate: true });
    }
  }, [selectedZone, map]);

  return null;
};

// Geolocation Component
const LocateControl = ({ onLocationFound }: { onLocationFound: (pos: [number, number]) => void }) => {
  const map = useMap();
  const [locating, setLocating] = useState(false);

  const handleLocate = () => {
    setLocating(true);
    map.locate({ 
      setView: true, 
      maxZoom: 18, 
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
  };

  useMapEvents({
    locationfound(e) {
      setLocating(false);
      onLocationFound([e.latlng.lat, e.latlng.lng]);
    },
    locationerror(e) {
      setLocating(false);
      alert("No se pudo obtener tu ubicación: " + e.message);
    }
  });

  return (
    <button 
      onClick={handleLocate}
      disabled={locating}
      className={`p-3 rounded-xl shadow-lg border border-slate-200 transition-all flex items-center justify-center ${
        locating ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700 hover:bg-slate-50'
      }`}
      title="Mi ubicación"
    >
      <LocateFixed className={`w-5 h-5 ${locating ? 'animate-pulse' : ''}`} />
    </button>
  );
};

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem('geo-app-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          wmsLayers: parsed.wmsLayers || [],
          isDrawing: false,
          isEditing: false,
          drawMode: null,
          tempPoints: [],
          multiSelectedIds: [],
          isToolsExpanded: false,
          filterByGroup: parsed.filterByGroup || false
        };
      }
    } catch (e) {
      console.error('Error loading state from localStorage', e);
    }
    return {
      zones: [],
      groups: [],
      wmsLayers: [],
      selectedZoneId: null,
      selectedGroupId: null,
      isDrawing: false,
      isEditing: false,
      drawMode: null,
      tempPoints: [],
      mapCenter: [40.4168, -3.7038],
      mapZoom: 6,
      multiSelectedIds: [],
      isToolsExpanded: false,
      filterByGroup: false
    };
  });
  
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mousePos, setMousePos] = useState<[number, number] | null>(null);
  const [mapType, setMapType] = useState<'osm' | 'satellite'>('osm');
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [editingZone, setEditingZone] = useState<GeoZone | null>(null);
  const [editingGroup, setEditingGroup] = useState<any | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#3b82f6');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importingZones, setImportingZones] = useState<GeoZone[]>([]);
  const [importTargetGroupId, setImportTargetGroupId] = useState<string>('none');
  const [importNewGroupName, setImportNewGroupName] = useState('');
  const [importNewGroupColor, setImportNewGroupColor] = useState('#3b82f6');
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showWMSModal, setShowWMSModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  const [newWMSName, setNewWMSName] = useState('');
  const [newWMSUrl, setNewWMSUrl] = useState('');
  const [newWMSLayers, setNewWMSLayers] = useState('');

  const [noteZone, setNoteZone] = useState<GeoZone | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteImage, setNoteImage] = useState<string | null>(null);
  const noteImageInputRef = useRef<HTMLInputElement>(null);
  
  const projectInputRef = useRef<HTMLInputElement>(null);
  const zoneLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Auth state - conectar con backend de Render
  const API_URL = 'https://geomeasure-pro.onrender.com';
  const [user, setUser] = useState<{ id: number; email: string; name: string } | null>(() => {
    const saved = localStorage.getItem('geo-user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('geo-token'));
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [cloudProjects, setCloudProjects] = useState<{ id: number; name: string; updated_at: string }[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('geo-app-state', JSON.stringify(state));
    } catch (e) {
      console.error('Error saving state to localStorage', e);
    }
  }, [state]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    // Standard Leaflet icon fix for modern build systems
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: icon,
      iconUrl: icon,
      shadowUrl: iconShadow,
    });
  }, []);

  const handleMapClick = useCallback((e: L.LeafletMouseEvent) => {
    const { lat, lng } = e.latlng;
    
    setState(prev => {
      if (prev.drawMode === 'point') {
        const newZone: GeoZone = {
          id: `point-${Date.now()}`,
          name: `Punto ${prev.zones.length + 1}`,
          type: 'point',
          coordinates: [lat, lng],
          color: '#3b82f6'
        };
        return {
          ...prev,
          zones: [...prev.zones, newZone],
          isDrawing: false,
          drawMode: null,
          tempPoints: []
        };
      }
      
      return {
        ...prev,
        tempPoints: [...prev.tempPoints, [lat, lng]]
      };
    });
  }, []);

  const handleMouseMove = useCallback((e: L.LeafletMouseEvent) => {
    setMousePos([e.latlng.lat, e.latlng.lng]);
  }, []);

  const finishDrawing = useCallback(() => {
    setState(prev => {
      if (prev.tempPoints.length < 2) return { ...prev, isDrawing: false, drawMode: null, tempPoints: [] };
      
      const id = `${prev.drawMode}-${Date.now()}`;
      const name = `${prev.drawMode === 'polygon' ? 'Zona' : 'Ruta'} ${prev.zones.length + 1}`;
      
      const newZone: GeoZone = {
        id,
        name,
        type: prev.drawMode as 'polygon' | 'polyline',
        coordinates: prev.tempPoints,
        color: '#3b82f6',
        area: prev.drawMode === 'polygon' ? calculateArea(prev.tempPoints) : undefined,
        distance: prev.drawMode === 'polyline' ? calculateDistance(prev.tempPoints) : undefined,
        perimeter: prev.drawMode === 'polygon' ? calculateDistance([...prev.tempPoints, prev.tempPoints[0]]) : undefined
      };
      
      return {
        ...prev,
        zones: [...prev.zones, newZone],
        isDrawing: false,
        drawMode: null,
        tempPoints: [],
        selectedZoneId: id
      };
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (state.isDrawing) {
        if (e.key === 'Enter') {
          finishDrawing();
        } else if (e.key === 'Escape') {
          setState(prev => ({ ...prev, isDrawing: false, drawMode: null, tempPoints: [] }));
        } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
          setState(prev => ({ ...prev, tempPoints: prev.tempPoints.slice(0, -1) }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isDrawing, finishDrawing]);

  const toggleZoneSelection = (id: string) => {
    setState(prev => {
      const isSelected = prev.multiSelectedIds.includes(id);
      return {
        ...prev,
        multiSelectedIds: isSelected 
          ? prev.multiSelectedIds.filter(i => i !== id)
          : [...prev.multiSelectedIds, id]
      };
    });
  };

  const selectAllVisibleZones = () => {
    setState(prev => {
      const visibleZones = prev.zones.filter(z => 
        (!prev.selectedGroupId || z.groupId === prev.selectedGroupId) &&
        z.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
      const visibleIds = visibleZones.map(z => z.id);
      return {
        ...prev,
        multiSelectedIds: visibleIds
      };
    });
  };

  const bulkAddToGroup = (groupId: string | null) => {
    setState(prev => ({
      ...prev,
      zones: prev.zones.map(z => 
        prev.multiSelectedIds.includes(z.id) ? { ...z, groupId } : z
      ),
      multiSelectedIds: []
    }));
  };

  // PWA Install Prompt Listener
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowInstallButton(false);
    }
  };

  const confirmAction = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({
      show: true,
      title,
      message,
      onConfirm
    });
  };

  const bulkDeleteZones = () => {
    confirmAction(
      'Eliminar Zonas',
      `¿Estás seguro de que quieres eliminar ${state.multiSelectedIds.length} zonas? Esta acción no se puede deshacer.`,
      () => {
        setState(prev => ({
          ...prev,
          zones: prev.zones.filter(z => !prev.multiSelectedIds.includes(z.id)),
          multiSelectedIds: [],
          selectedZoneId: prev.multiSelectedIds.includes(prev.selectedZoneId || '') ? null : prev.selectedZoneId
        }));
      }
    );
  };

  const updateZoneColor = (id: string, color: string) => {
    setState(prev => ({
      ...prev,
      zones: prev.zones.map(z => z.id === id ? { ...z, color } : z)
    }));
  };

  const bulkUpdateZoneColor = (color: string) => {
    setState(prev => ({
      ...prev,
      zones: prev.zones.map(z => 
        prev.multiSelectedIds.includes(z.id) ? { ...z, color } : z
      ),
      multiSelectedIds: []
    }));
  };

  const deleteZone = (id: string) => {
    confirmAction(
      'Eliminar Zona',
      '¿Estás seguro de que quieres eliminar esta zona? Esta acción no se puede deshacer.',
      () => {
        setState(prev => ({
          ...prev,
          zones: prev.zones.filter(z => z.id !== id),
          selectedZoneId: prev.selectedZoneId === id ? null : prev.selectedZoneId
        }));
      }
    );
  };

  const confirmImport = () => {
    let groupId: string | null = null;
    let groupColor = '#3b82f6';

    if (importTargetGroupId === 'new') {
      if (!importNewGroupName.trim()) return;
      const newId = `group-${Date.now()}`;
      const newGroup = {
        id: newId,
        name: importNewGroupName,
        color: importNewGroupColor
      };
      setState(prev => ({
        ...prev,
        groups: [...prev.groups, newGroup]
      }));
      groupId = newId;
      groupColor = importNewGroupColor;
    } else if (importTargetGroupId !== 'none') {
      groupId = importTargetGroupId;
      const existingGroup = state.groups.find(g => g.id === groupId);
      if (existingGroup) groupColor = existingGroup.color;
    }

    const zonesWithGroup = importingZones.map(zone => ({
      ...zone,
      groupId,
      color: groupId ? groupColor : zone.color
    }));

    setState(prev => ({
      ...prev,
      zones: [...prev.zones, ...zonesWithGroup]
    }));

    setShowImportModal(false);
    setImportingZones([]);
    setImportTargetGroupId('none');
    setImportNewGroupName('');
  };

  useEffect(() => {
    if (state.selectedZoneId && sidebarOpen) {
      // Small delay to ensure the element is rendered if filters were just cleared
      setTimeout(() => {
        const element = document.getElementById(`zone-item-${state.selectedZoneId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [state.selectedZoneId, sidebarOpen]);

  const selectZone = (id: string) => {
    const zone = state.zones.find(z => z.id === id);
    if (!zone) return;

    // Ensure the zone is visible in the sidebar
    if (state.selectedGroupId && zone.groupId !== state.selectedGroupId) {
      setState(prev => ({ ...prev, selectedGroupId: null, selectedZoneId: id }));
    } else {
      setState(prev => ({ ...prev, selectedZoneId: id }));
    }

    if (searchQuery && !zone.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      setSearchQuery('');
    }
  };

  const startDrawing = (mode: 'polygon' | 'polyline' | 'point') => {
    setState(prev => ({
      ...prev,
      isDrawing: true,
      drawMode: mode,
      tempPoints: [],
      selectedZoneId: null,
      isToolsExpanded: false
    }));
  };

  const getDirections = (zone: GeoZone) => {
    let lat, lng;
    if (zone.type === 'point') {
      [lat, lng] = zone.coordinates as [number, number];
    } else {
      const coords = zone.coordinates as [number, number][];
      [lat, lng] = coords[0];
    }
    
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  };

  const createGroup = () => {
    if (!newGroupName.trim()) return;
    const newGroupId = `group-${Date.now()}`;
    const newGroup = {
      id: newGroupId,
      name: newGroupName,
      color: newGroupColor
    };
    
    setState(prev => {
      const updatedZones = prev.multiSelectedIds.length > 0
        ? prev.zones.map(z => prev.multiSelectedIds.includes(z.id) ? { ...z, groupId: newGroupId, color: newGroupColor } : z)
        : prev.zones;
        
      return {
        ...prev,
        groups: [...prev.groups, newGroup],
        zones: updatedZones,
        multiSelectedIds: [] // Clear selection after creating group and adding them
      };
    });
    
    setNewGroupName('');
    setNewGroupColor('#3b82f6');
    setShowGroupModal(false);
  };

  const updateGroup = (updatedGroup: any) => {
    setState(prev => ({
      ...prev,
      groups: prev.groups.map(g => g.id === updatedGroup.id ? updatedGroup : g),
      zones: prev.zones.map(z => z.groupId === updatedGroup.id ? { ...z, color: updatedGroup.color } : z)
    }));
  };

  const deleteGroup = (groupId: string) => {
    confirmAction(
      'Eliminar Grupo',
      '¿Estás seguro de que quieres eliminar este grupo? Las zonas asociadas no se eliminarán, pero perderán su asignación de grupo.',
      () => {
        setState(prev => ({
          ...prev,
          groups: prev.groups.filter(g => g.id !== groupId),
          zones: prev.zones.map(z => z.groupId === groupId ? { ...z, groupId: null } : z),
          selectedGroupId: prev.selectedGroupId === groupId ? null : prev.selectedGroupId
        }));
      }
    );
  };

  const addWMSLayer = () => {
    if (!newWMSName.trim() || !newWMSUrl.trim() || !newWMSLayers.trim()) return;
    const newLayer: WMSLayer = {
      id: `wms-${Date.now()}`,
      name: newWMSName,
      url: newWMSUrl,
      layers: newWMSLayers,
      visible: true,
      opacity: 0.7
    };
    setState(prev => ({
      ...prev,
      wmsLayers: [...prev.wmsLayers, newLayer]
    }));
    setNewWMSName('');
    setNewWMSUrl('');
    setNewWMSLayers('');
    setShowWMSModal(false);
  };

  const toggleWMSLayer = (id: string) => {
    setState(prev => ({
      ...prev,
      wmsLayers: prev.wmsLayers.map(l => l.id === id ? { ...l, visible: !l.visible } : l)
    }));
  };

  const deleteWMSLayer = (id: string) => {
    confirmAction(
      'Eliminar Capa WMS',
      '¿Estás seguro de que quieres eliminar esta capa WMS?',
      () => {
        setState(prev => ({
          ...prev,
          wmsLayers: prev.wmsLayers.filter(l => l.id !== id)
        }));
      }
    );
  };

  const updateWMSOpacity = (id: string, opacity: number) => {
    setState(prev => ({
      ...prev,
      wmsLayers: prev.wmsLayers.map(l => l.id === id ? { ...l, opacity } : l)
    }));
  };

  const saveNote = () => {
    if (!noteZone) return;
    
    setState(prev => ({
      ...prev,
      zones: prev.zones.map(z => z.id === noteZone.id ? { 
        ...z, 
        noteText: noteText || undefined, 
        noteImage: noteImage || undefined 
      } : z)
    }));
    
    setNoteZone(null);
    setNoteText('');
    setNoteImage(null);
  };

  const handleNoteImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Comprimir imagen antes de guardar (reduce calidad y tamaño)
    try {
      const compressedImage = await compressImage(file, 800, 0.6);
      setNoteImage(compressedImage);
    } catch (error) {
      console.error('Error al comprimir imagen:', error);
      alert('Error al procesar la imagen. Intenta con una imagen más pequeña.');
    }
  };

  const updateZone = (updatedZone: GeoZone) => {
    let finalZone = { ...updatedZone };
    if (updatedZone.groupId) {
      const group = state.groups.find(g => g.id === updatedZone.groupId);
      if (group) {
        finalZone.color = group.color;
      }
    }
    
    setState(prev => ({
      ...prev,
      zones: prev.zones.map(z => z.id === finalZone.id ? finalZone : z)
    }));
    setEditingZone(null);
  };

  const updateZoneGeometry = (id: string, newCoords: [number, number][] | [number, number]) => {
    setState(prev => {
      const zone = prev.zones.find(z => z.id === id);
      if (!zone) return prev;

      let updatedZone = { ...zone, coordinates: newCoords };
      
      if (zone.type === 'polygon') {
        updatedZone.area = calculateArea(newCoords as [number, number][]);
        updatedZone.perimeter = calculateDistance([...(newCoords as [number, number][]), (newCoords as [number, number][])[0]]);
      } else if (zone.type === 'polyline') {
        updatedZone.distance = calculateDistance(newCoords as [number, number][]);
      }

      return {
        ...prev,
        zones: prev.zones.map(z => z.id === id ? updatedZone : z)
      };
    });
  };

  // Bring selected zone to front
  useEffect(() => {
    if (state.selectedZoneId) {
      const bringToFront = () => {
        const layer = zoneLayersRef.current.get(state.selectedZoneId!);
        if (layer && (layer as any).bringToFront) {
          (layer as any).bringToFront();
        }
      };
      
      bringToFront();
      // Small delay to handle potential re-renders
      const timer = setTimeout(bringToFront, 100);
      return () => clearTimeout(timer);
    }
  }, [state.selectedZoneId]);

  const handleExport = () => {
    if (state.zones.length === 0) {
      alert('No hay zonas para exportar.');
      return;
    }
    
    const confirmed = confirm(
      '¿Exportar a GeoJSON?\n\n' +
      '- Se guardarán todas las zonas (polígonos, líneas, puntos)\n' +
      '- NO se incluirán las imágenes adjuntas\n' +
      '- Ideal para compartir datos con otros programas GIS'
    );
    if (!confirmed) return;
    
    // Exportar SIN imágenes (solo datos, ideal para compartir)
    const geojson = exportZonesWithoutImages(state.zones, state.groups);
    const blob = new Blob([geojson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `geomeasure_export_${Date.now()}.geojson`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportProject = async () => {
    if (user && token) {
      const confirmed = confirm(
        '¿Guardar proyecto en la nube?\n\n' +
        '- Se guardarán todas las zonas, grupos y configuración del mapa\n' +
        '- Se incluirán las imágenes adjuntas\n' +
        '- Podrás recuperar este proyecto desde cualquier dispositivo\n\n' +
        'NOTA: Si ya existe un proyecto con la misma fecha, será sobrescrito.'
      );
      if (!confirmed) return;
      
      // Guardar en la base de datos (cloud) - CON imágenes
      try {
        const projectData = {
          zones: state.zones,
          groups: state.groups,
          mapCenter: state.mapCenter,
          mapZoom: state.mapZoom
        };
        
        const projectName = `proyecto-${new Date().toISOString().split('T')[0]}`;
        
        console.log('Saving to:', `${API_URL}/api/auth/projects`);
        console.log('Data size:', JSON.stringify(projectData).length, 'bytes');
        
        const response = await fetch(`${API_URL}/api/auth/projects`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            name: projectName,
            data: projectData
          })
        });

        console.log('Response status:', response.status);
        
        if (response.ok) {
          alert('Proyecto guardado en la nube');
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('Error response:', errorData);
          alert('Error al guardar: ' + errorData.error);
        }
      } catch (err: any) {
        console.error('Error saving to cloud:', err);
        alert('Error al guardar en la nube: ' + err.message);
      }
    } else {
      // Guardar localmente (sin login)
      const confirmed = confirm(
        '¿Descargar proyecto como archivo?\n\n' +
        '- Se guardarán todas las zonas, grupos y configuración del mapa\n' +
        '- Se incluirán las imágenes adjuntas\n' +
        '- Se descargará un archivo JSON en tu dispositivo'
      );
      if (!confirmed) return;
      
      const projectData = {
        version: '1.0',
        state: {
          zones: state.zones,
          groups: state.groups,
          mapCenter: state.mapCenter,
          mapZoom: state.mapZoom
        }
      };
      const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
      saveAs(blob, `proyecto-mapa-${new Date().toISOString().split('T')[0]}.json`);
    }
  };

  const handleImportProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.kmz')) {
      try {
        const newZones = await parseKMZ(file);
        setImportingZones(newZones);
        setShowImportModal(true);
      } catch (error) {
        console.error('Error parsing KMZ:', error);
        alert('Error al leer el archivo KMZ. Asegúrate de que sea un archivo válido.');
      }
    } else if (fileName.endsWith('.kml')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const newZones = parseKML(event.target?.result as string);
          setImportingZones(newZones);
          setShowImportModal(true);
        } catch (error) {
          console.error('Error parsing KML:', error);
          alert('Error al leer el archivo KML.');
        }
      };
      reader.readAsText(file);
    } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const data = JSON.parse(content);
          
          // Check if it's a project file (has state property)
          if (data.state) {
            // Confirmar antes de sobrescribir
            const hasData = state.zones.length > 0 || state.groups.length > 0;
            if (hasData) {
              const confirmed = confirm('¿Estás seguro de cargar este proyecto? Se sobrescribirá todo lo que tienes actualmente en pantalla.');
              if (!confirmed) return;
            }
            
            setState(prev => ({
              ...prev,
              ...data.state,
              selectedZoneId: null,
              selectedGroupId: null,
              isDrawing: false,
              isEditing: false,
              drawMode: null,
              tempPoints: []
            }));
            alert('Proyecto cargado correctamente');
          } 
          // Check if it's a GeoJSON (has type FeatureCollection)
          else if (data.type === 'FeatureCollection') {
            const newZones = parseGeoJSON(content);
            setImportingZones(newZones);
            setShowImportModal(true);
          } else {
            alert('El archivo JSON no parece ser un proyecto válido ni un GeoJSON.');
          }
        } catch (err) {
          console.error('Error al importar el archivo:', err);
          alert('Error al procesar el archivo. Asegúrate de que sea un JSON o GeoJSON válido.');
        }
      };
      reader.readAsText(file);
    }

    // Reset input
    e.target.value = '';
  };

  const handleExportImage = async () => {
    if (!mapContainerRef.current) return;
    
    const confirmed = confirm(
      '¿Exportar mapa como imagen?\n\n' +
      '- Se capturará el área visible del mapa\n' +
      '- Se incluirá el fondo del mapa que estés usando\n' +
      '- Se descargará una imagen PNG'
    );
    if (!confirmed) return;
    
    setIsExportingImage(true);
    try {
      // Wait a bit for map to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const dataUrl = await toPng(mapContainerRef.current, {
        cacheBust: true,
        filter: (node) => {
          // Filter out controls if needed, but usually we want them
          return true;
        }
      });
      
      saveAs(dataUrl, `mapa-${new Date().toISOString().split('T')[0]}.png`);
    } catch (err) {
      console.error('Error al exportar imagen:', err);
      alert('Error al exportar la imagen del mapa.');
    } finally {
      setIsExportingImage(false);
    }
  };

  const handleExportNotes = () => {
    const notesData = state.zones
      .filter(z => z.noteText || z.noteImage)
      .map(z => ({
        id: z.id,
        name: z.name,
        type: z.type,
        group: z.groupId ? state.groups.find(g => g.id === z.groupId)?.name : 'Sin grupo',
        noteText: z.noteText,
        noteImage: z.noteImage
      }));

    if (notesData.length === 0) {
      alert('No hay notas para exportar.');
      return;
    }

    const blob = new Blob([JSON.stringify(notesData, null, 2)], { type: 'application/json' });
    saveAs(blob, `notas-geomeasure-${new Date().toISOString().split('T')[0]}.json`);
  };

  // Auth functions - conectar con backend de Render
  const authAPI = async (endpoint: string, body: object) => {
    const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error');
    return data;
  };

  const handleAuth = async () => {
    setAuthError('');
    setAuthLoading(true);
    try {
      const data = await authAPI(authMode, {
        email: authEmail,
        password: authPassword,
        name: authName
      });
      setUser(data.user);
      setToken(data.token);
      localStorage.setItem('geo-user', JSON.stringify(data.user));
      localStorage.setItem('geo-token', data.token);
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthName('');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('geo-user');
    localStorage.removeItem('geo-token');
    setCloudProjects([]);
  };

  const verifyToken = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        localStorage.setItem('geo-user', JSON.stringify(data.user));
      } else {
        handleLogout();
      }
    } catch {
      handleLogout();
    }
  };

  // Load projects from cloud
  const loadCloudProjects = async () => {
    if (!user || !token) return;
    setLoadingProjects(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCloudProjects(data.projects);
      }
    } catch (err) {
      console.error('Error loading projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  };

  // Load a single project from cloud
  const loadCloudProject = async (projectId: number) => {
    if (!token) return;
    
    // Confirmar antes de sobrescribir
    const hasData = state.zones.length > 0 || state.groups.length > 0;
    if (hasData) {
      const confirmed = confirm('¿Estás seguro de cargar este proyecto? Se sobrescribirá todo lo que tienes actualmente en pantalla.');
      if (!confirmed) return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/auth/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        const projectData = data.project.data;
        setState(prev => ({
          ...prev,
          zones: projectData.zones || [],
          groups: projectData.groups || [],
          mapCenter: projectData.mapCenter || [40.4168, -3.7038],
          mapZoom: projectData.mapZoom || 6,
          selectedZoneId: null,
          selectedGroupId: null,
          isDrawing: false,
          isEditing: false,
          drawMode: null,
          tempPoints: []
        }));
        setShowProjectsModal(false);
        alert('Proyecto cargado desde la nube');
      }
    } catch (err) {
      console.error('Error loading project:', err);
      alert('Error al cargar el proyecto');
    }
  };

  // Delete project from cloud
  const deleteCloudProject = async (projectId: number) => {
    if (!token) return;
    if (!confirm('¿Estás seguro de que quieres eliminar este proyecto?')) return;
    
    try {
      const response = await fetch(`${API_URL}/api/auth/projects/${projectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        loadCloudProjects();
        alert('Proyecto eliminado');
      }
    } catch (err) {
      console.error('Error deleting project:', err);
      alert('Error al eliminar el proyecto');
    }
  };

  useEffect(() => {
    verifyToken();
  }, [token]);

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50 overflow-hidden font-sans">
      {/* Header */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20 shadow-sm shrink-0">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="bg-blue-600 p-2 rounded-lg shrink-0">
            <MapIcon className="text-white w-6 h-6" />
          </div>
          <div className="overflow-hidden">
            <h1 className="font-bold text-slate-900 text-base sm:text-lg leading-tight truncate">GeoMeasure Pro</h1>
            <p className="text-[10px] sm:text-xs text-slate-500 font-medium truncate hidden sm:block">Medición de Áreas y Perímetros</p>
          </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {user ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-bold text-slate-700">{user.name || user.email}</p>
                <p className="text-[10px] text-slate-400">{user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-red-50 text-slate-600 rounded-lg transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span className="text-sm font-bold hidden sm:block">Iniciar Sesión</span>
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 relative overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside 
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              className="absolute left-0 top-0 bottom-0 w-[85vw] sm:w-80 bg-white border-r border-slate-200 flex flex-col z-[2000] shadow-2xl h-full overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-800 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    Capas y Zonas
                  </h2>
                  <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    placeholder="Buscar zonas o grupos..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 transition-all font-medium"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar p-4 space-y-4 select-none" style={{ flexBasis: 0 }}>
                {/* Group Management Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Grupos</h3>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setState(prev => ({ ...prev, filterByGroup: !prev.filterByGroup }))}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold transition-all ${
                          state.filterByGroup 
                            ? 'bg-blue-100 text-blue-700' 
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                        title="Filtrar mapa por grupo seleccionado"
                      >
                        {state.filterByGroup ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                        Filtrar Mapa
                      </button>
                      <button 
                        onClick={() => setShowGroupModal(true)}
                        className="p-1 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                      >
                        <FolderPlus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <button 
                      onClick={() => setState(prev => ({ ...prev, selectedGroupId: null }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                        state.selectedGroupId === null 
                          ? 'bg-blue-600 border-blue-600 text-white' 
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      Todos
                    </button>
                    {state.groups
                      .filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(group => (
                      <div key={group.id} className="relative group">
                        <button 
                          onClick={() => setState(prev => ({ ...prev, selectedGroupId: group.id }))}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 ${
                            state.selectedGroupId === group.id 
                              ? 'bg-blue-600 border-blue-600 text-white' 
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }}></div>
                          {group.name}
                        </button>
                        <div className="absolute -top-1 -right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <button 
                            onClick={() => setEditingGroup(group)}
                            className="bg-blue-500 text-white rounded-full p-0.5 shadow-sm hover:bg-blue-600"
                          >
                            <Settings2 className="w-2 h-2" />
                          </button>
                          <button 
                            onClick={() => deleteGroup(group.id)}
                            className="bg-red-500 text-white rounded-full p-0.5 shadow-sm hover:bg-red-600"
                          >
                            <X className="w-2 h-2" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WMS Layers Section */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Globe className="w-3 h-3" />
                      Capas WMS
                    </h3>
                    <button 
                      onClick={() => setShowWMSModal(true)}
                      className="p-1 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                      title="Añadir Capa WMS"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                    {state.wmsLayers.length === 0 ? (
                      <p className="text-[10px] text-slate-400 italic">No hay capas WMS añadidas.</p>
                    ) : (
                      state.wmsLayers.map(layer => (
                        <div key={layer.id} className="bg-slate-50 p-2 rounded-lg border border-slate-100 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <input 
                                type="checkbox" 
                                checked={layer.visible}
                                onChange={() => toggleWMSLayer(layer.id)}
                                className="w-3 h-3 rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-xs font-bold text-slate-700 truncate">{layer.name}</span>
                            </div>
                            <button 
                              onClick={() => deleteWMSLayer(layer.id)}
                              className="text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          {layer.visible && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 uppercase font-bold">Opacidad</span>
                              <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.1" 
                                value={layer.opacity}
                                onChange={(e) => updateWMSOpacity(layer.id, parseFloat(e.target.value))}
                                className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                              />
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Zonas</h3>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={handleExportNotes}
                      className="p-1 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                      title="Exportar Informe de Notas (JSON)"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={selectAllVisibleZones}
                      className="p-1 hover:bg-slate-100 text-slate-500 rounded transition-colors"
                      title="Seleccionar todas"
                    >
                      <CheckSquare className="w-4 h-4" />
                    </button>
                    {state.multiSelectedIds.length > 0 && (
                      <button 
                        onClick={() => setState(prev => ({ ...prev, multiSelectedIds: [] }))}
                        className="p-1 hover:bg-red-50 text-red-500 rounded transition-colors"
                        title="Deseleccionar todas"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {state.zones
                  .filter(z => (!state.selectedGroupId || z.groupId === state.selectedGroupId) && 
                               (z.name.toLowerCase().includes(searchQuery.toLowerCase())))
                  .length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                    <div className="bg-slate-100 p-4 rounded-full">
                      <MousePointer2 className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500 max-w-[200px]">
                      No hay zonas en este grupo. Usa las herramientas de dibujo para empezar.
                    </p>
                  </div>
                ) : (
                  state.zones
                    .filter(z => (!state.selectedGroupId || z.groupId === state.selectedGroupId) && 
                                 (z.name.toLowerCase().includes(searchQuery.toLowerCase())))
                    .map(zone => {
                      const isMultiSelected = state.multiSelectedIds.includes(zone.id);
                      return (
                          <motion.div 
                            key={zone.id}
                            id={`zone-item-${zone.id}`}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`p-3 rounded-xl border transition-all cursor-pointer relative group/item ${
                              state.selectedZoneId === zone.id 
                                ? 'border-blue-500 bg-blue-50/50 shadow-sm' 
                                : isMultiSelected
                                  ? 'border-blue-400 bg-blue-50/30'
                                  : 'border-slate-200 hover:border-slate-300 bg-white'
                            }`}
                            onClick={() => {
                              if (state.multiSelectedIds.length > 0) {
                                toggleZoneSelection(zone.id);
                              } else {
                                setState(prev => ({ ...prev, selectedZoneId: zone.id }));
                              }
                            }}
                          >
                          {/* Multi-select Checkbox */}
                          <div 
                            className={`absolute -left-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all z-10 ${
                              isMultiSelected 
                                ? 'bg-blue-600 border-blue-600 text-white' 
                                : 'bg-white border-slate-300 opacity-0 group-hover/item:opacity-100'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleZoneSelection(zone.id);
                            }}
                          >
                            {isMultiSelected && <Check className="w-3 h-3" />}
                          </div>

                          <div className="flex items-center justify-between mb-2">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <div className="relative group/color">
                                  <div className="w-3 h-3 rounded-full border border-slate-200" style={{ backgroundColor: zone.color }}></div>
                                  <input 
                                    type="color" 
                                    value={zone.color}
                                    onChange={(e) => updateZoneColor(zone.id, e.target.value)}
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    title="Cambiar color"
                                  />
                                </div>
                                <span className="font-bold text-slate-800 text-sm">{zone.name}</span>
                              </div>
                              {(zone.noteText || zone.noteImage) && (
                                <div className="flex items-center gap-1 mt-0.5 ml-5">
                                  {zone.noteText && <TypeIcon className="w-2.5 h-2.5 text-slate-400" />}
                                  {zone.noteImage && <ImageIcon className="w-2.5 h-2.5 text-slate-400" />}
                                  <span className="text-[10px] text-slate-400 font-medium truncate max-w-[120px]">
                                    {zone.noteText || 'Imagen adjunta'}
                                  </span>
                                </div>
                              )}
                            </div>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setNoteZone(zone);
                              setNoteText(zone.noteText || '');
                              setNoteImage(zone.noteImage || null);
                            }}
                            className={`p-1 rounded transition-colors ${
                              zone.noteText || zone.noteImage 
                                ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' 
                                : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'
                            }`}
                            title="Notas e Imágenes"
                          >
                            <StickyNote className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingZone(zone);
                            }}
                            className="p-1 hover:text-blue-600 text-slate-400 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteZone(zone.id);
                            }}
                            className="p-1 hover:text-red-600 text-slate-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        {zone.area !== undefined && (
                          <div className="bg-white p-2 rounded-lg border border-slate-100">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Área</p>
                            <p className="text-xs font-bold text-slate-700">{formatArea(zone.area)}</p>
                          </div>
                        )}
                        {zone.perimeter !== undefined && (
                          <div className="bg-white p-2 rounded-lg border border-slate-100">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Perímetro</p>
                            <p className="text-xs font-bold text-slate-700">{formatDistance(zone.perimeter)}</p>
                          </div>
                        )}
                        {zone.distance !== undefined && (
                          <div className="bg-white p-2 rounded-lg border border-slate-100 col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Distancia Total</p>
                            <p className="text-xs font-bold text-slate-700">{formatDistance(zone.distance)}</p>
                          </div>
                        )}
                        {zone.type === 'point' && (
                          <div className="bg-white p-2 rounded-lg border border-slate-100 col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Coordenadas</p>
                            <p className="text-[10px] font-mono text-slate-600">
                              {(zone.coordinates as [number, number])[0].toFixed(6)}, {(zone.coordinates as [number, number])[1].toFixed(6)}
                            </p>
                          </div>
                        )}
                      </div>

                      {state.selectedZoneId === zone.id && (
                        <motion.button
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            getDirections(zone);
                          }}
                          className="mt-3 w-full bg-blue-600 text-white py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors"
                        >
                          <Navigation className="w-3 h-3" />
                          Cómo llegar
                        </motion.button>
                      )}
                    </motion.div>
                  );
                })
            )}
          </div>

              {/* Bulk Actions Bar */}
              <AnimatePresence>
                {state.multiSelectedIds.length > 0 && (
                  <motion.div 
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    exit={{ y: 100 }}
                    className="p-4 bg-blue-600 text-white border-t border-blue-700 space-y-3 shadow-2xl z-20"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {state.multiSelectedIds.length} seleccionadas
                      </span>
                      <button 
                        onClick={() => setState(prev => ({ ...prev, multiSelectedIds: [] }))}
                        className="p-1 hover:bg-white/10 rounded"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="relative col-span-2">
                        <select 
                          className="w-full bg-blue-700 text-white text-xs font-bold py-2 px-3 rounded-lg border border-blue-500 appearance-none outline-none"
                          onChange={(e) => {
                            if (e.target.value === 'new') {
                              setShowGroupModal(true);
                              // We'll need to handle the bulk add after group creation
                            } else if (e.target.value !== '') {
                              bulkAddToGroup(e.target.value === 'none' ? null : e.target.value);
                            }
                          }}
                          value=""
                        >
                          <option value="" disabled>Añadir a grupo...</option>
                          <option value="none">Sin grupo</option>
                          {state.groups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                          <option value="new">+ Nuevo Grupo</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                          <ChevronRight className="w-3 h-3 rotate-90" />
                        </div>
                      </div>
                      <div className="relative col-span-2">
                        <div className="flex items-center gap-2 bg-blue-700 border border-blue-500 rounded-lg px-3 py-2">
                          <Palette className="w-3 h-3" />
                          <span className="text-[10px] font-bold uppercase">Cambiar Color</span>
                          <input 
                            type="color" 
                            className="ml-auto w-6 h-6 rounded border-0 p-0 cursor-pointer bg-transparent"
                            onChange={(e) => bulkUpdateZoneColor(e.target.value)}
                          />
                        </div>
                      </div>
                      <button 
                        onClick={bulkDeleteZones}
                        className="col-span-2 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        Eliminar seleccionadas
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
                <div className="flex gap-2">
                  <button 
                    onClick={handleExport}
                    className="flex-1 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2"
                    title="Exportar como GeoJSON"
                  >
                    <Download className="w-3 h-3" />
                    GeoJSON
                  </button>
                  <button 
                    onClick={handleExportProject}
                    className="flex-1 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2"
                    title="Guardar proyecto completo"
                  >
                    <Save className="w-3 h-3" />
                    Proyecto
                  </button>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => projectInputRef.current?.click()}
                    className="flex-1 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload className="w-3 h-3" />
                    Cargar
                  </button>
                  {user && (
                    <button 
                      onClick={() => { loadCloudProjects(); setShowProjectsModal(true); }}
                      className="flex-1 bg-blue-600 border border-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <Database className="w-3 h-3" />
                      Nube
                    </button>
                  )}
                  <button 
                    onClick={handleExportImage}
                    disabled={isExportingImage}
                    className={`flex-1 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 ${isExportingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <MapIcon className="w-3 h-3" />
                    {isExportingImage ? 'Exportando...' : 'Imagen'}
                  </button>
                </div>
                <input 
                  type="file" 
                  ref={projectInputRef} 
                  onChange={handleImportProject} 
                  accept=".json,.kmz,.kml,.geojson" 
                  className="hidden" 
                />

                <div className="h-px bg-slate-200 my-2"></div>
                
                <button 
                  onClick={() => window.open('https://paypal.me/DarkSchneideR', '_blank')}
                  className="w-full flex items-center justify-center gap-2 bg-rose-50 text-rose-600 py-3 rounded-xl font-bold text-sm hover:bg-rose-100 transition-all border border-rose-100 shadow-sm"
                  title="Donar"
                >
                  <Heart className="w-4 h-4 fill-rose-600" />
                  <span>Donar para apoyar el proyecto</span>
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Map Container */}
        <main className="flex-1 relative" ref={mapContainerRef}>
          {!sidebarOpen && (
            <button 
              onClick={() => setSidebarOpen(true)}
              className="absolute left-4 top-20 z-[1001] bg-white p-3 rounded-xl shadow-lg border border-slate-200 hover:bg-slate-50 transition-all"
            >
              <Menu className="w-5 h-5 text-slate-700" />
            </button>
          )}

          <MapContainer 
            center={state.mapCenter} 
            zoom={state.mapZoom} 
            className="w-full h-full"
            zoomControl={false}
            preferCanvas={true}
          >
            <MapStateTracker onMapMove={(center, zoom) => {
              setState(prev => ({ ...prev, mapCenter: center, mapZoom: zoom }));
            }} />
            <ZoomControl position="bottomright" />
            <TileLayer
              url={mapType === 'osm' 
                ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              }
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              updateWhenIdle={true}
              updateWhenZooming={false}
              keepBuffer={2}
            />

            {state.wmsLayers.filter(l => l.visible).map(layer => (
              <WMSTileLayer
                key={layer.id}
                url={layer.url}
                layers={layer.layers}
                format="image/png"
                transparent={true}
                opacity={layer.opacity}
                attribution={layer.name}
              />
            ))}
            
            <MapEvents 
              isDrawing={state.isDrawing} 
              drawMode={state.drawMode}
              onMapClick={handleMapClick}
              onMouseMove={handleMouseMove}
              onFinish={finishDrawing}
            />

            <MapViewHandler 
              selectedZone={state.zones.find(z => z.id === state.selectedZoneId) || null} 
              sidebarOpen={sidebarOpen}
            />

            {userLocation && (
              <Marker position={userLocation} icon={L.divIcon({ 
                className: 'bg-blue-600 rounded-full border-2 border-white shadow-lg ring-4 ring-blue-500/30',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              })} />
            )}

            {/* Render Existing Zones */}
            {React.useMemo(() => {
              const filteredZones = state.filterByGroup && state.selectedGroupId 
                ? state.zones.filter(z => z.groupId === state.selectedGroupId)
                : state.zones;
                
              return filteredZones.map((zone) => (
                <ZoneLayer 
                  key={zone.id}
                  zone={zone}
                  isSelected={state.selectedZoneId === zone.id}
                  isMultiSelected={state.multiSelectedIds.includes(zone.id)}
                  isEditing={state.isEditing && state.selectedZoneId === zone.id}
                  onSelect={selectZone}
                  onUpdateGeometry={updateZoneGeometry}
                  layerRef={(id, el) => {
                    if (el) zoneLayersRef.current.set(id, el);
                    else zoneLayersRef.current.delete(id);
                  }}
                />
              ));
            }, [state.zones, state.selectedZoneId, state.multiSelectedIds, state.isEditing, state.filterByGroup, state.selectedGroupId])}

            {/* Clustered Labels */}
            <MarkerClusterGroup 
              chunkedLoading 
              maxClusterRadius={40}
              showCoverageOnHover={false}
              spiderfyOnMaxZoom={true}
              disableClusteringAtZoom={18}
            >
              {React.useMemo(() => {
                const filteredZones = state.filterByGroup && state.selectedGroupId 
                  ? state.zones.filter(z => z.groupId === state.selectedGroupId)
                  : state.zones;
                  
                return filteredZones.map(zone => (
                  <Marker 
                    key={`label-${zone.id}`}
                    position={getZoneCenter(zone)}
                    icon={L.divIcon({
                      className: 'invisible-marker',
                      iconSize: [1, 1],
                      iconAnchor: [0, 0]
                    })}
                    eventHandlers={{
                      click: (e) => {
                        selectZone(zone.id);
                        const layer = zoneLayersRef.current.get(zone.id);
                        if (layer && (layer as any).bringToFront) (layer as any).bringToFront();
                        L.DomEvent.stopPropagation(e);
                      }
                    }}
                  >
                    <Tooltip 
                      permanent 
                      direction="top" 
                      offset={[0, -10]}
                      className="custom-zone-label"
                      interactive
                      eventHandlers={{
                        click: (e) => {
                          selectZone(zone.id);
                          const layer = zoneLayersRef.current.get(zone.id);
                          if (layer && (layer as any).bringToFront) (layer as any).bringToFront();
                          L.DomEvent.stopPropagation(e);
                        }
                      }}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-bold text-[10px]">{zone.name}</span>
                        {(zone.noteText || zone.noteImage) && (
                          <div className="flex gap-0.5">
                            {zone.noteText && <StickyNote className="w-2 h-2 text-blue-600" />}
                            {zone.noteImage && <ImageIcon className="w-2 h-2 text-blue-600" />}
                          </div>
                        )}
                      </div>
                    </Tooltip>
                  </Marker>
                ));
              }, [state.zones, state.filterByGroup, state.selectedGroupId])}
            </MarkerClusterGroup>

            {/* Render Drawing Preview */}
            {state.isDrawing && state.tempPoints.length > 0 && (
              <>
                {state.drawMode === 'polygon' && (
                  <Polygon 
                    positions={[...state.tempPoints, mousePos || state.tempPoints[state.tempPoints.length-1]]}
                    pathOptions={{ color: '#3b82f6', dashArray: '5, 10', fillOpacity: 0.1 }}
                  />
                )}
                {state.drawMode === 'polyline' && (
                  <Polyline 
                    positions={[...state.tempPoints, mousePos || state.tempPoints[state.tempPoints.length-1]]}
                    pathOptions={{ color: '#3b82f6', dashArray: '5, 10' }}
                  />
                )}
                {state.tempPoints.map((p, i) => (
                  <Marker key={i} position={p} icon={L.divIcon({ 
                    className: 'bg-blue-500 w-2 h-2 rounded-full border border-white',
                    iconSize: [8, 8],
                    iconAnchor: [4, 4]
                  })} />
                ))}
              </>
            )}

            {/* LocateControl must be inside MapContainer to use Leaflet context */}
            <div className="absolute top-20 right-4 z-[1000]">
              <LocateControl onLocationFound={setUserLocation} />
            </div>
          </MapContainer>

          {/* Sidebar Overlay for Mobile */}
          {sidebarOpen && isMobile && (
            <div 
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[1999]"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Floating Toolbar - Redesigned as a collapsible menu for better mobile experience */}
          <div 
            className="absolute top-36 right-4 flex flex-col items-end gap-2 z-[1001]"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setState(prev => ({ ...prev, isToolsExpanded: !prev.isToolsExpanded }))}
              className={`w-12 h-12 rounded-2xl shadow-2xl border flex items-center justify-center transition-all ${
                state.isToolsExpanded ? 'bg-blue-600 border-blue-700 text-white rotate-90' : 'bg-white border-slate-200 text-slate-700'
              }`}
              title={state.isToolsExpanded ? "Cerrar herramientas" : "Abrir herramientas"}
            >
              {state.isToolsExpanded ? <X className="w-6 h-6" /> : <Wrench className="w-6 h-6" />}
            </button>

            <AnimatePresence>
              {state.isToolsExpanded && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: -20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -20 }}
                  className="bg-white p-1 rounded-2xl shadow-2xl border border-slate-200 flex flex-col gap-1 max-h-[60vh] overflow-y-auto"
                >
                  <ToolButton 
                    active={false} 
                    onClick={() => {
                      setMapType(mapType === 'osm' ? 'satellite' : 'osm');
                      setState(prev => ({ ...prev, isToolsExpanded: false }));
                    }}
                    icon={<Layers className="w-5 h-5 text-slate-600" />}
                    label="Tipo de Mapa"
                  />
                  <ToolButton 
                    active={false} 
                    onClick={() => {
                      setShowHelpModal(true);
                      setState(prev => ({ ...prev, isToolsExpanded: false }));
                    }}
                    icon={<HelpCircle className="w-5 h-5 text-slate-600" />}
                    label="Ayuda"
                  />
                  <div className="h-px bg-slate-100 mx-2 my-1"></div>
                  <ToolButton 
                    active={state.drawMode === 'polygon'} 
                    onClick={() => startDrawing('polygon')}
                    icon={<Square className="w-5 h-5" />}
                    label="Dibujar Área"
                  />
                  <ToolButton 
                    active={state.drawMode === 'polyline'} 
                    onClick={() => startDrawing('polyline')}
                    icon={<Ruler className="w-5 h-5" />}
                    label="Medir Distancia"
                  />
                  <ToolButton 
                    active={state.drawMode === 'point'} 
                    onClick={() => startDrawing('point')}
                    icon={<MapPin className="w-5 h-5" />}
                    label="Añadir Punto"
                  />
                  <div className="h-px bg-slate-100 mx-2 my-1"></div>
                  <ToolButton 
                    active={state.isEditing} 
                    onClick={() => setState(prev => ({ ...prev, isEditing: !prev.isEditing, isDrawing: false, drawMode: null, isToolsExpanded: false }))}
                    icon={<Edit3 className="w-5 h-5" />}
                    label="Editar Geometría"
                  />
                  <div className="h-px bg-slate-100 mx-2 my-1"></div>
                  <ToolButton 
                    active={!state.isDrawing && !state.drawMode && !state.isEditing} 
                    onClick={() => setState(prev => ({ ...prev, isDrawing: false, isEditing: false, drawMode: null, tempPoints: [], isToolsExpanded: false }))}
                    icon={<MousePointer2 className="w-5 h-5" />}
                    label="Seleccionar"
                  />
                  
                  {showInstallButton && (
                    <>
                      <div className="h-px bg-slate-100 mx-2 my-1"></div>
                      <ToolButton 
                        active={false} 
                        onClick={() => {
                          handleInstallClick();
                          setState(prev => ({ ...prev, isToolsExpanded: false }));
                        }}
                        icon={<Download className="w-5 h-5 text-blue-600" />}
                        label="Instalar App"
                      />
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Map Info Overlay */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <AnimatePresence>
              {state.isDrawing && (
                <motion.div 
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 50, opacity: 0 }}
                  className="bg-slate-900/90 backdrop-blur-md text-white p-4 sm:px-6 sm:py-3 rounded-2xl sm:rounded-full shadow-2xl flex flex-col sm:flex-row items-center gap-3 sm:gap-4 pointer-events-auto w-[90vw] sm:w-auto max-w-md sm:max-w-none border border-white/10"
                >
                  <div className="flex items-center justify-between w-full sm:w-auto sm:border-r sm:border-white/20 sm:pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span className="text-sm font-bold">Dibujando {state.drawMode === 'polygon' ? 'Área' : 'Ruta'}</span>
                    </div>
                    <span className="text-xs font-medium text-slate-300 sm:hidden">{state.tempPoints.length} pts</span>
                  </div>
                  
                  <div className="flex items-center justify-between w-full sm:w-auto gap-4 text-xs font-medium">
                    <span className="hidden sm:inline">{state.tempPoints.length} puntos añadidos</span>
                    {state.drawMode === 'polygon' && state.tempPoints.length >= 3 && (
                      <span className="text-blue-400 bg-blue-500/10 px-2 py-1 rounded sm:bg-transparent sm:p-0">Área: {formatArea(calculateArea(state.tempPoints))}</span>
                    )}
                    {state.drawMode === 'polyline' && state.tempPoints.length >= 2 && (
                      <span className="text-blue-400 bg-blue-500/10 px-2 py-1 rounded sm:bg-transparent sm:p-0">Distancia: {formatDistance(calculateDistance(state.tempPoints))}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-2 pt-2 sm:pt-0 border-t border-white/10 sm:border-0">
                    <button 
                      onClick={() => setState(prev => ({ ...prev, tempPoints: prev.tempPoints.slice(0, -1) }))}
                      disabled={state.tempPoints.length === 0}
                      className="flex-1 sm:flex-none bg-white/10 hover:bg-white/20 py-2 sm:px-3 sm:py-1.5 rounded-xl sm:rounded-full text-xs font-bold transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                      title="Deshacer último punto"
                    >
                      <Undo2 className="w-4 h-4 sm:w-3 sm:h-3" />
                      <span className="hidden min-[400px]:inline">Deshacer</span>
                    </button>
                    <button 
                      onClick={() => setState(prev => ({ ...prev, isDrawing: false, drawMode: null, tempPoints: [] }))}
                      className="flex-1 sm:flex-none bg-red-500/20 hover:bg-red-500/40 text-red-400 py-2 sm:px-3 sm:py-1.5 rounded-xl sm:rounded-full text-xs font-bold transition-colors flex items-center justify-center gap-1"
                    >
                      <X className="w-4 h-4 sm:w-3 sm:h-3" />
                      <span className="hidden min-[400px]:inline">Cancelar</span>
                    </button>
                    <button 
                      onClick={finishDrawing}
                      disabled={state.tempPoints.length < (state.drawMode === 'polygon' ? 3 : 2)}
                      className="flex-1 sm:flex-none bg-green-500 hover:bg-green-600 text-white py-2 sm:px-4 sm:py-1.5 rounded-xl sm:rounded-full text-xs font-bold transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                    >
                      <Check className="w-4 h-4 sm:w-3 sm:h-3" />
                      <span className="hidden min-[400px]:inline">Finalizar</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Edit Zone Modal */}
      <AnimatePresence>
        {editingZone && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-blue-600" />
                  Editar Propiedades
                </h3>
                <button onClick={() => setEditingZone(null)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre</label>
                  <input 
                    type="text" 
                    value={editingZone.name}
                    onChange={(e) => setEditingZone({ ...editingZone, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all font-medium"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'].map(color => (
                      <button 
                        key={color}
                        onClick={() => setEditingZone({ ...editingZone, color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          editingZone.color === color ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <div className="flex items-center gap-2 ml-auto">
                      <Palette className="w-4 h-4 text-slate-400" />
                      <input 
                        type="color" 
                        value={editingZone.color}
                        onChange={(e) => setEditingZone({ ...editingZone, color: e.target.value })}
                        className="w-8 h-8 rounded border-0 p-0 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Asignar a Grupo</label>
                  <select 
                    value={editingZone.groupId || ''}
                    onChange={(e) => setEditingZone({ ...editingZone, groupId: e.target.value || null })}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-blue-500 outline-none transition-all font-medium bg-white"
                  >
                    <option value="">Sin grupo</option>
                    {state.groups.map(group => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setEditingZone(null)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => updateZone(editingZone)}
                  className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Guardar Cambios
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Edit Group Modal */}
        {editingGroup && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-blue-600" />
                  Editar Grupo
                </h3>
                <button onClick={() => setEditingGroup(null)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre del Grupo</label>
                  <input 
                    type="text" 
                    value={editingGroup.name}
                    onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-blue-500 outline-none transition-all font-medium"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Color del Grupo</label>
                  <div className="flex flex-wrap gap-2">
                    {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'].map(color => (
                      <button 
                        key={color}
                        onClick={() => setEditingGroup({ ...editingGroup, color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          editingGroup.color === color ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <div className="flex items-center gap-2 ml-auto">
                      <Palette className="w-4 h-4 text-slate-400" />
                      <input 
                        type="color" 
                        value={editingGroup.color}
                        onChange={(e) => setEditingGroup({ ...editingGroup, color: e.target.value })}
                        className="w-8 h-8 rounded border-0 p-0 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setEditingGroup(null)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => {
                    updateGroup(editingGroup);
                    setEditingGroup(null);
                  }}
                  className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Guardar
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* New Group Modal */}
        {showGroupModal && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-blue-600" />
                  Nuevo Grupo
                </h3>
                <button onClick={() => setShowGroupModal(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre del Grupo</label>
                  <input 
                    type="text" 
                    autoFocus
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                    placeholder="Ej: Parcelas Norte"
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-blue-500 outline-none transition-all font-medium"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Color del Grupo</label>
                  <div className="flex flex-wrap gap-2">
                    {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'].map(color => (
                      <button 
                        key={color}
                        onClick={() => setNewGroupColor(color)}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          newGroupColor === color ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <div className="flex items-center gap-2 ml-auto">
                      <Palette className="w-4 h-4 text-slate-400" />
                      <input 
                        type="color" 
                        value={newGroupColor}
                        onChange={(e) => setNewGroupColor(e.target.value)}
                        className="w-8 h-8 rounded border-0 p-0 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setShowGroupModal(false)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={createGroup}
                  className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
                >
                  Crear Grupo
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* WMS Layer Modal */}
        {showWMSModal && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-blue-600" />
                  Añadir Capa WMS
                </h3>
                <button onClick={() => setShowWMSModal(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre de la Capa</label>
                  <input 
                    type="text" 
                    placeholder="Ej: Catastro, Ortofoto..."
                    value={newWMSName}
                    onChange={(e) => setNewWMSName(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-blue-500 outline-none transition-all font-medium"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">URL del Servicio WMS</label>
                  <input 
                    type="text" 
                    placeholder="https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx"
                    value={newWMSUrl}
                    onChange={(e) => setNewWMSUrl(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-blue-500 outline-none transition-all font-medium text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Capas (separadas por comas)</label>
                  <input 
                    type="text" 
                    placeholder="Catastro,PARCELA"
                    value={newWMSLayers}
                    onChange={(e) => setNewWMSLayers(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-blue-500 outline-none transition-all font-medium"
                  />
                </div>

                <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
                  <Info className="w-5 h-5 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Asegúrate de que la URL sea correcta y que el servidor soporte el formato <strong>image/png</strong> con transparencia.
                  </p>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setShowWMSModal(false)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={addWMSLayer}
                  disabled={!newWMSName.trim() || !newWMSUrl.trim() || !newWMSLayers.trim()}
                  className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Añadir Capa
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Notes Modal */}
        {noteZone && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <StickyNote className="w-5 h-5 text-blue-600" />
                  Notas de {noteZone.name}
                </h3>
                <button onClick={() => setNoteZone(null)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <TypeIcon className="w-3 h-3" />
                    Nota de Texto
                  </label>
                  <textarea 
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Escribe una nota aquí..."
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 outline-none transition-all font-medium min-h-[120px] resize-none"
                  />
                  {noteText && (
                    <button 
                      onClick={() => setNoteText('')}
                      className="text-[10px] text-red-500 font-bold hover:underline"
                    >
                      Borrar texto
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <ImageIcon className="w-3 h-3" />
                    Imagen Adjunta
                  </label>
                  
                  {noteImage ? (
                    <div className="relative group rounded-xl overflow-hidden border border-slate-200 bg-slate-50 aspect-video flex items-center justify-center">
                      <img 
                        src={noteImage} 
                        alt="Nota" 
                        className="max-w-full max-h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button 
                          onClick={() => noteImageInputRef.current?.click()}
                          className="p-2 bg-white rounded-full text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Cambiar imagen"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setNoteImage(null)}
                          className="p-2 bg-white rounded-full text-red-600 hover:bg-red-50 transition-colors"
                          title="Borrar imagen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => noteImageInputRef.current?.click()}
                      className="w-full py-8 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-blue-600"
                    >
                      <ImageIcon className="w-8 h-8" />
                      <span className="text-xs font-bold">Añadir Imagen</span>
                    </button>
                  )}
                  <input 
                    type="file" 
                    ref={noteImageInputRef}
                    onChange={handleNoteImageUpload}
                    accept="image/*"
                    className="hidden"
                  />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setNoteZone(null)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={saveNote}
                  className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Guardar Notas
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Import Modal */}
        {showImportModal && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600" />
                  Opciones de Importación
                </h3>
                <button onClick={() => setShowImportModal(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-sm text-blue-800 font-medium">
                    Se han detectado <span className="font-bold">{importingZones.length}</span> elementos en el archivo.
                  </p>
                </div>

                <div className="space-y-4">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Destino de Importación</label>
                  
                  <div className="grid grid-cols-1 gap-3">
                    <button 
                      onClick={() => setImportTargetGroupId('none')}
                      className={`p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${
                        importTargetGroupId === 'none' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-200'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        importTargetGroupId === 'none' ? 'border-blue-600' : 'border-slate-300'
                      }`}>
                        {importTargetGroupId === 'none' && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm">Sin grupo</p>
                        <p className="text-xs text-slate-500">Importar como elementos individuales</p>
                      </div>
                    </button>

                    {state.groups.length > 0 && (
                      <button 
                        onClick={() => setImportTargetGroupId(state.groups[0].id)}
                        className={`p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${
                          importTargetGroupId !== 'none' && importTargetGroupId !== 'new' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          importTargetGroupId !== 'none' && importTargetGroupId !== 'new' ? 'border-blue-600' : 'border-slate-300'
                        }`}>
                          {importTargetGroupId !== 'none' && importTargetGroupId !== 'new' && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-slate-800 text-sm">Grupo existente</p>
                          <select 
                            value={importTargetGroupId !== 'none' && importTargetGroupId !== 'new' ? importTargetGroupId : ''}
                            onChange={(e) => setImportTargetGroupId(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2 w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm outline-none bg-white"
                          >
                            {state.groups.map(group => (
                              <option key={group.id} value={group.id}>{group.name}</option>
                            ))}
                          </select>
                        </div>
                      </button>
                    )}

                    <button 
                      onClick={() => setImportTargetGroupId('new')}
                      className={`p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${
                        importTargetGroupId === 'new' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-200'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        importTargetGroupId === 'new' ? 'border-blue-600' : 'border-slate-300'
                      }`}>
                        {importTargetGroupId === 'new' && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-slate-800 text-sm">Crear nuevo grupo</p>
                        {importTargetGroupId === 'new' && (
                          <div className="mt-3 space-y-3">
                            <input 
                              type="text" 
                              placeholder="Nombre del grupo"
                              value={importNewGroupName}
                              onChange={(e) => setImportNewGroupName(e.target.value)}
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm outline-none"
                            />
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold text-slate-500">Color del grupo:</span>
                              <div className="flex gap-1.5">
                                {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'].map(color => (
                                  <button 
                                    key={color}
                                    onClick={(e) => { e.stopPropagation(); setImportNewGroupColor(color); }}
                                    className={`w-6 h-6 rounded-full border-2 ${importNewGroupColor === color ? 'border-slate-900 scale-110' : 'border-transparent'}`}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                                <input 
                                  type="color" 
                                  value={importNewGroupColor}
                                  onChange={(e) => setImportNewGroupColor(e.target.value)}
                                  className="w-6 h-6 rounded border-0 p-0 cursor-pointer"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setShowImportModal(false)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmImport}
                  className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all"
                >
                  Confirmar Importación
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Confirmation Dialog */}
        {confirmDialog.show && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[5000] flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">{confirmDialog.title}</h2>
                <p className="text-slate-500 font-medium">{confirmDialog.message}</p>
              </div>
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setConfirmDialog(prev => ({ ...prev, show: false }))}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog(prev => ({ ...prev, show: false }));
                  }}
                  className="flex-1 px-4 py-2 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 shadow-lg shadow-rose-500/20 transition-all"
                >
                  Eliminar
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Help Modal */}
        {showHelpModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[5000] flex items-center justify-center p-4">
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="p-6 bg-blue-600 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-xl">
                    <HelpCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Guía de Uso</h2>
                    <p className="text-blue-100 text-sm font-medium">Aprende a usar GeoMeasure Pro</p>
                  </div>
                </div>
                <button onClick={() => setShowHelpModal(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-8">
                <section>
                  <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <MousePointer className="w-5 h-5 text-blue-600" />
                    Herramientas de Dibujo
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-3">
                        <Square className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-800 text-sm mb-1">Polígono</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Haz clic en el mapa para añadir puntos. Haz clic en el primer punto para cerrar el área.</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-3">
                        <Ruler className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-800 text-sm mb-1">Línea</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Haz clic para añadir puntos. Haz clic en el último punto o pulsa Enter para terminar.</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-3">
                        <MapPin className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-800 text-sm mb-1">Punto</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Haz un solo clic en el mapa para marcar una ubicación específica.</p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <LayersIcon className="w-5 h-5 text-blue-600" />
                    Organización y Capas
                  </h3>
                  <div className="space-y-4">
                    <div className="flex gap-4 items-start">
                      <div className="bg-slate-100 p-3 rounded-xl text-slate-600 shrink-0">
                        <FolderPlus className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">Grupos</h4>
                        <p className="text-xs text-slate-500">Crea grupos para organizar tus mediciones por categorías o proyectos. Puedes asignar colores a cada grupo.</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="bg-slate-100 p-3 rounded-xl text-slate-600 shrink-0">
                        <Database className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">Capas WMS</h4>
                        <p className="text-xs text-slate-500">Añade servicios de mapas externos (WMS) para superponer información catastral, satelital o topográfica.</p>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Download className="w-5 h-5 text-blue-600" />
                    Exportación e Importación
                  </h3>
                  <p className="text-sm text-slate-600 mb-4">
                    GeoMeasure Pro permite trabajar con múltiples formatos para que tus datos sean portátiles.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl border border-slate-100 bg-blue-50/50">
                      <h4 className="font-bold text-blue-900 text-sm mb-2">Formatos Soportados</h4>
                      <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
                        <li>KMZ / KML (Google Earth)</li>
                        <li>GeoJSON (Estándar GIS)</li>
                        <li>JSON (Proyecto completo)</li>
                        <li>Imagen (Captura del mapa)</li>
                      </ul>
                    </div>
                    <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50">
                      <h4 className="font-bold text-slate-800 text-sm mb-2">Notas y Fotos</h4>
                      <p className="text-xs text-slate-500">
                        Cada zona puede tener notas de texto e imágenes asociadas. Estas se guardan dentro del proyecto y se pueden exportar.
                      </p>
                    </div>
                  </div>
                </section>

                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div className="text-xs text-amber-800 leading-relaxed">
                    <span className="font-bold">Pro Tip:</span> Usa el modo de selección múltiple (icono de lista en la barra lateral) para cambiar el color o grupo de varias zonas a la vez.
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100">
                <button 
                  onClick={() => setShowHelpModal(false)}
                  className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all"
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
            onClick={() => setShowAuthModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-800">
                  {authMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
                </h2>
                <button
                  onClick={() => setShowAuthModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="space-y-4">
                {authMode === 'register' && (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Nombre</label>
                    <input
                      type="text"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
                      placeholder="Tu nombre"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
                    placeholder="tu@email.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Contraseña</label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
                    placeholder="••••••••"
                  />
                </div>

                {authError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 font-medium">
                    {authError}
                  </div>
                )}

                <button
                  onClick={handleAuth}
                  disabled={authLoading || !authEmail || !authPassword}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl transition-colors"
                >
                  {authLoading ? 'Cargando...' : authMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
                </button>

                <div className="text-center">
                  <button
                    onClick={() => {
                      setAuthMode(authMode === 'login' ? 'register' : 'login');
                      setAuthError('');
                    }}
                    className="text-sm text-blue-600 font-bold hover:underline"
                  >
                    {authMode === 'login' 
                      ? '¿No tienes cuenta? Regístrate' 
                      : '¿Ya tienes cuenta? Inicia sesión'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cloud Projects Modal */}
      <AnimatePresence>
        {showProjectsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
            onClick={() => setShowProjectsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[80vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-slate-800">Mis Proyectos en la Nube</h2>
                <button
                  onClick={() => setShowProjectsModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {loadingProjects ? (
                <p className="text-center text-slate-500 py-8">Cargando proyectos...</p>
              ) : cloudProjects.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No tienes proyectos guardados en la nube.</p>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2">
                  {cloudProjects.map(project => (
                    <div key={project.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div className="flex-1 cursor-pointer" onClick={() => loadCloudProject(project.id)}>
                        <p className="font-bold text-slate-800">{project.name}</p>
                        <p className="text-xs text-slate-500">
                          Actualizado: {new Date(project.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteCloudProject(project.id)}
                        className="p-2 hover:bg-red-100 text-red-500 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowProjectsModal(false)}
                className="w-full mt-4 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all"
              >
                Cerrar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Screen Image Modal */}
      <AnimatePresence>
        {showImageModal && fullImageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 flex items-center justify-center z-[9999] p-4"
            onClick={() => { setShowImageModal(false); setFullImageUrl(null); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-full max-h-full"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { setShowImageModal(false); setFullImageUrl(null); }}
                className="absolute -top-10 right-0 text-white hover:text-slate-300 transition-colors"
              >
                <X className="w-8 h-8" />
              </button>
              <img 
                src={fullImageUrl} 
                alt="Imagen completa" 
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`p-3 rounded-xl transition-all flex items-center justify-center relative group ${
        active 
          ? 'bg-blue-600 text-white shadow-lg' 
          : 'text-slate-500 hover:bg-slate-100'
      }`}
      title={label}
    >
      {icon}
      <span className="absolute left-full ml-3 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap font-bold z-50">
        {label}
      </span>
    </button>
  );
}
