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
        bgColor = 'bg-blue-100 border-blue-200';
        iconName = 'shield';
        colorClass = 'text-[#4B7FBE]';
    } else if (t === 'hospital') {
        bgColor = 'bg-red-100 border-red-200';
        iconName = 'local_hospital';
        colorClass = 'text-[#DC2626]';
    } else if (t === 'pharmacy') {
        bgColor = 'bg-green-100 border-green-200';
        iconName = 'medical_services';
        colorClass = 'text-[#15803D]';
    } else if (t === 'public transport') {
        bgColor = 'bg-sky-100 border-sky-200';
        iconName = 'train';
        colorClass = 'text-[#0369A1]';
    } else if (t === 'mapped establishment') {
        bgColor = 'bg-amber-100 border-amber-200';
        iconName = 'storefront';
        colorClass = 'text-[#B45309]';
    } else {
        // Safezone / Crowd
        bgColor = 'bg-[#8B4A6A]/10 border-[#8B4A6A]/20';
        iconName = 'home';
        colorClass = 'text-[#8B4A6A]';
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
    <div class="w-7 h-7 rounded-full bg-white shadow-lg flex items-center justify-center z-10 border-2 border-[#8B4A6A]">
      <div class="w-3.5 h-3.5 rounded-full bg-[#8B4A6A]"></div>
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
                                color: index === selectedRouteIndex ? '#8B4A6A' : '#687585',
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
