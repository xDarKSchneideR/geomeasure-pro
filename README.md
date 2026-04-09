# GeoMeasure Pro

Herramienta profesional de medición de áreas y perímetros sobre mapa.

## Características

- Medición de áreas y perímetros
- Medición de distancias
- Puntos de interés
- Grupos con colores
- Notas con texto e imágenes
- Exportar datos
- PWA instalable
- Autenticación de usuarios

## Tech Stack

- **Frontend**: React 19 + Vite 6 + TypeScript
- **Estilos**: Tailwind CSS 4
- **Mapas**: Leaflet + React-Leaflet + Turf.js
- **Backend**: Express + Node.js
- **Base de datos**: PostgreSQL (Neon)

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev    # Frontend solo
npm run server # Backend + Frontend
```

## Deploy

### Backend (Render)
1. Crear Web Service en render.com
2. Conectar repositorio
3. Configurar:
   - Build: `npm install`
   - Start: `npm run server`
4. Agregar DATABASE_URL y JWT_SECRET

### Frontend (Netlify)
1. `npm run build`
2. Subir carpeta `dist/`

## Variables de Entorno

Crear `.env`:
```
DATABASE_URL=postgresql://...
JWT_SECRET=tu-clave-secreta
```

## Licencia

MIT