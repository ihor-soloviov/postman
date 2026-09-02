export type Point = { lat: number; lon: number };

export type Address = {
  id: number;
  label: string;
  norm: string;
  lat: number | null;
  lon: number | null;
  source: string;
  note: string;
  visits: number;
  last_visit_at: string | null;
  created_at: string;
};

export type StopStatus = "pending" | "done" | "failed" | "skipped";

export type Stop = {
  id: number;
  trip_id: number;
  address_id: number;
  seq: number;
  status: StopStatus;
  comment: string;
  leg_distance_m: number | null;
  leg_duration_s: number | null;
  done_at: string | null;
};

export type StopWithAddress = Stop & {
  label: string;
  lat: number | null;
  lon: number | null;
  note: string;
};

export type TripStatus = "draft" | "planned" | "active" | "done";

export type Trip = {
  id: number;
  title: string;
  status: TripStatus;
  depot_label: string;
  depot_lat: number | null;
  depot_lon: number | null;
  objective: "duration" | "distance";
  engine: string;
  plan_distance_m: number | null;
  plan_duration_s: number | null;
  geometry: string | null;
  note: string;
  created_at: string;
  planned_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type Settings = {
  ors_api_key: string;
  depot_label: string;
  depot_lat: string;
  depot_lon: string;
  city: string;
  country: string;
  avg_speed_kmh: string;
  stop_minutes: string;
  geocoder: "nominatim" | "ors";
  search_radius_km: string;
  objective: "duration" | "distance";
  profile: string;
};
