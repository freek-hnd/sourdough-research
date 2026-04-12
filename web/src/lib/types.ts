export type UUID = string;
export type ISODate = string;

export interface RootStarter {
  id: UUID;
  name: string;
  origin: string;
  description: string | null;
  received_at: string | null;
  created_at: ISODate;
}

export interface Station {
  id: number;
  label: string;
  device_type: "esp32" | "rpi";
  has_load_cell: boolean;
  has_ir_sensor: boolean;
  mac_address: string | null;
  ip_address: string | null;
  notes: string | null;
}

export interface Batch {
  id: UUID;
  type: "starter" | "dough";
  parent_item_id: UUID | null;
  root_starter_id: UUID;
  flour_g: number;
  water_g: number;
  starter_g: number | null;
  salt_g: number | null;
  extras_json: unknown;
  total_weight_g: number;
  num_children: number;
  notes: string | null;
  mixed_at: ISODate;
  created_at: ISODate;
}

export interface Item {
  id: UUID;
  short_id: string;
  batch_id: UUID;
  type: "starter" | "dough";
  container_type: string;
  weight_g: number;
  station_id: number | null;
  inkbird_probe: 1 | 2 | 3 | 4 | null;
  notes: string | null;
  created_at: ISODate;
}

export interface Session {
  id: UUID;
  item_id: UUID;
  station_id: number;
  started_at: ISODate;
  ended_at: ISODate | null;
  notes: string | null;
}

export interface Measurement {
  id: number;
  station_id: number;
  measured_at: ISODate;
  tof_median_mm: number | null;
  tof_min_mm: number | null;
  tof_max_mm: number | null;
  tof_grid: number[] | null;
  co2_ppm: number | null;
  scd_temp_c: number | null;
  scd_humidity_pct: number | null;
  ds18b20_temp_c: number | null;
  ir_surface_temp_c: number | null;
  load_cell_g: number | null;
}

export interface PhReading {
  id: number;
  station_id: number;
  hanna_device_id: number;
  measured_at: ISODate;
  ph: number | null;
  mv: number | null;
  temp_c: number | null;
  status: string | null;
  hanna_code: string | null;
  is_manual: boolean;
}

export interface InkbirdReading {
  id: number;
  measured_at: ISODate;
  probe1_c: number | null;
  probe2_c: number | null;
  probe3_c: number | null;
  probe4_c: number | null;
}

export interface EventRow {
  id: UUID;
  session_id: UUID | null;
  station_id: number | null;
  event_name: string;
  occurred_at: ISODate;
  value: string | null;
  notes: string | null;
}

export interface Outcome {
  id: UUID;
  item_id: UUID;
  loaf_weight_g: number | null;
  bake_temp_c: number | null;
  bake_duration_min: number | null;
  internal_temp_c: number | null;
  notes: string | null;
  baked_at: ISODate;
}

export interface Rating {
  id: UUID;
  item_id: UUID;
  rater_name: string;
  scores_json: Record<string, number>;
  notes: string | null;
  rated_at: ISODate;
}

export interface Photo {
  id: UUID;
  item_id: UUID;
  storage_url: string;
  taken_at: ISODate;
  caption: string | null;
}

export interface ItemWithJoins extends Item {
  batch: Batch | null;
  station: Station | null;
}
