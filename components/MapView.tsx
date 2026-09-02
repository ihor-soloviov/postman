"use client";

import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  lat: number;
  lon: number;
  label: string;
  badge: string;
  kind?: "depot" | "done" | "pending";
};

function pin(point: MapPoint) {
  return L.divIcon({
    className: "",
    html: `<div class="pin ${point.kind ?? "pending"}">${point.badge}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** Клік по карті = поставити точку вручну, коли геокодер промахнувся. */
function ClickHandler({ onPick }: { onPick: (point: { lat: number; lon: number }) => void }) {
  useMapEvents({
    click: (event) => onPick({ lat: event.latlng.lat, lon: event.latlng.lng }),
  });
  return null;
}

function FitBounds({ points, line }: { points: MapPoint[]; line: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const coords: [number, number][] = line.length
      ? line
      : points.map((p) => [p.lat, p.lon] as [number, number]);
    if (!coords.length) return;
    map.fitBounds(L.latLngBounds(coords), { padding: [24, 24] });
  }, [map, points, line]);
  return null;
}

export default function MapView({
  points,
  line = [],
  height = 300,
  zoom = 14,
  fit = true,
  onPick,
}: {
  points: MapPoint[];
  line?: [number, number][];
  height?: number;
  zoom?: number;
  /** Підганяти видимість під усі точки. Для однієї точки зручніше без цього. */
  fit?: boolean;
  /** Дозволити ставити точку кліком і перетягуванням маркера. */
  onPick?: (point: { lat: number; lon: number }) => void;
}) {
  if (!points.length) return null;
  return (
    <div className="map" style={{ height }}>
      <MapContainer
        center={[points[0].lat, points[0].lon]}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {line.length > 1 && <Polyline positions={line} pathOptions={{ weight: 4, opacity: 0.75 }} />}
        {points.map((point, index) => (
          <Marker
            key={index}
            position={[point.lat, point.lon]}
            icon={pin(point)}
            draggable={Boolean(onPick)}
            eventHandlers={
              onPick
                ? {
                    dragend: (event) => {
                      const position = event.target.getLatLng();
                      onPick({ lat: position.lat, lon: position.lng });
                    },
                  }
                : undefined
            }
          >
            <Tooltip direction="top">{point.label}</Tooltip>
          </Marker>
        ))}
        {onPick && <ClickHandler onPick={onPick} />}
        {fit && <FitBounds points={points} line={line} />}
      </MapContainer>
    </div>
  );
}
