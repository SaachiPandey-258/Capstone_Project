"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { SpecialistProvider } from "@/lib/types";
import { CARE_TYPE_COLORS as TYPE_COLORS } from "@/lib/specialists";


function FitBounds({ providers, selectedId }: { providers: SpecialistProvider[]; selectedId: string | null }) {
  const map = useMap();
  useEffect(() => {
    const selected = providers.find((provider) => provider.id === selectedId);
    if (selected) {
      map.flyTo([selected.latitude, selected.longitude], Math.max(map.getZoom(), 15), { duration: 0.8 });
      return;
    }
    if (!providers.length) return;
    const bounds: LatLngBoundsExpression = providers.map((provider) => [provider.latitude, provider.longitude]);
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
  }, [map, providers, selectedId]);
  return null;
}

export default function CareMap({
  providers, selectedId, onSelect,
}: { providers: SpecialistProvider[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const first = providers[0];
  return (
    <MapContainer
      className="care-map"
      center={first ? [first.latitude, first.longitude] : [20.59, 78.96]}
      zoom={first ? 12 : 5}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds providers={providers} selectedId={selectedId} />
      {providers.map((provider) => {
        const color = TYPE_COLORS[provider.listing_type] ?? "#5d6d86";
        const selected = provider.id === selectedId;
        return (
          <CircleMarker
            key={provider.id}
            center={[provider.latitude, provider.longitude]}
            radius={selected ? 11 : 7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 }}
            eventHandlers={{ click: () => onSelect(provider.id) }}
          >
            <Popup>
              <strong>{provider.name}</strong><br />
              {provider.listing_type} · {provider.distance_km} km<br />
              <a href={provider.osm_url} target="_blank" rel="noreferrer">Open in OpenStreetMap</a>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
