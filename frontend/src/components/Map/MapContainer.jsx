import React, { useEffect } from 'react';
import { MapContainer as LeafletMap, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix custom markers styling since Leaflet adds hardcoded background and border
const customMarkerStyle = `
  .custom-leaflet-marker {
    background: transparent !important;
    border: none !important;
  }
`;

const createIcon = (type) => {
    const t = type?.toLowerCase() || '';
    let bgColor, iconName, colorClass;
    if (t === 'police') {
        bgColor = 'bg-info/10 border-info/20';
        iconName = 'shield';
        colorClass = 'text-info';
    } else if (t === 'hospital') {
        bgColor = 'bg-error/10 border-error/20';
        iconName = 'local_hospital';
        colorClass = 'text-error';
    } else if (t === 'pharmacy') {
        bgColor = 'bg-success/10 border-success/20';
        iconName = 'medical_services';
        colorClass = 'text-success';
    } else if (t === 'public transport') {
        bgColor = 'bg-info/10 border-info/20';
        iconName = 'train';
        colorClass = 'text-info';
    } else if (t === 'mapped establishment') {
        bgColor = 'bg-warning/10 border-warning/20';
        iconName = 'storefront';
        colorClass = 'text-warning';
    } else {
        // Safezone / Crowd
        bgColor = 'bg-primary-container/10 border-primary-container/20';
        iconName = 'home';
        colorClass = 'text-primary-container';
    }

    return new L.DivIcon({
        className: 'custom-leaflet-marker',
        html: `<div class="w-10 h-10 rounded-full shadow-md flex items-center justify-center z-10 border-2 ${bgColor}">
      <span class="material-symbols-outlined text-[20px] ${colorClass}">${iconName}</span>
    </div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20]
    });
};

const userIcon = new L.DivIcon({
    className: 'custom-leaflet-marker',
    html: `<div class="relative flex items-center justify-center w-12 h-12">
    <div class="absolute w-12 h-12 bg-primary/20 rounded-full animate-ping"></div>
    <div class="w-7 h-7 rounded-full bg-card shadow-lg flex items-center justify-center z-10 border-2 border-primary-container">
      <div class="w-3.5 h-3.5 rounded-full bg-primary-container"></div>
    </div>
  </div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24]
});

function MapZoomController({ center }) {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.setView(center, 14);
        }
    }, [center, map]);
    return null;
}

function MapDestinationPicker({ onSelectDestination }) {
    useMapEvents({
        click(event) {
            if (onSelectDestination) {
                onSelectDestination({ lat: event.latlng.lat, lon: event.latlng.lng });
            }
        },
    });
    return null;
}

function RouteViewport({ route }) {
    const map = useMap();
    useEffect(() => {
        if (route?.coordinates?.length > 1) {
            map.fitBounds(route.coordinates, { padding: [40, 40], maxZoom: 15 });
        }
    }, [map, route]);
    return null;
}

export default function CustomMapContainer({
    location,
    origin = null,
    originName = 'Route start',
    pois,
    routes = [],
    selectedRouteIndex = null,
    destination = null,
    routeFacilities = [],
    onSelectRoute,
    onSelectDestination,
}) {
    const selectedRoute = selectedRouteIndex === null ? null : routes[selectedRouteIndex];
    const visiblePois = [...new Map(
        [...pois, ...routeFacilities].map((poi) => [`${poi.id}:${poi.lat}:${poi.lon}`, poi]),
    ).values()];

    return (
        <>
            <style>{customMarkerStyle}</style>
            <div className="absolute inset-0 z-0">
                <LeafletMap center={location} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={true}>
                    <MapZoomController center={location} />
                    <MapDestinationPicker onSelectDestination={onSelectDestination} />
                    <RouteViewport route={selectedRoute} />
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />

                    <Marker position={location} icon={userIcon} bubblingMouseEvents={false}>
                        <Popup className="font-body shadow-sm text-center font-bold">You are here</Popup>
                    </Marker>

                    {origin && (
                        <Marker position={origin} bubblingMouseEvents={false}>
                            <Popup>{originName}</Popup>
                        </Marker>
                    )}

                    {visiblePois.map(poi => (
                        <Marker key={poi.id} position={[poi.lat, poi.lon]} icon={createIcon(poi.type)} bubblingMouseEvents={false}>
                            <Popup className="font-body shadow-sm border-none rounded-xl">
                                <div className="text-center p-1">
                                    <h4 className="font-serif font-bold text-on-surface text-[14px] mb-1">{poi.name}</h4>
                                    <p className="text-[10px] uppercase text-on-surface-variant font-bold">{poi.type}</p>
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {routes.map((route, index) => (
                        <Polyline
                            key={`route-${route.id}`}
                            positions={route.coordinates}
                            bubblingMouseEvents={false}
                            pathOptions={{
                                color: index === selectedRouteIndex ? 'rgb(var(--primary-container))' : 'rgb(var(--ink-muted))',
                                weight: index === selectedRouteIndex ? 7 : 4,
                                opacity: index === selectedRouteIndex ? 0.95 : 0.6,
                            }}
                            eventHandlers={{ click: () => onSelectRoute?.(index) }}
                        />
                    ))}

                    {destination && (
                        <Marker position={[destination.lat, destination.lon]} bubblingMouseEvents={false}>
                            <Popup>{destination.name || 'Selected destination'}</Popup>
                        </Marker>
                    )}
                </LeafletMap>
            </div>
        </>
    );
}
