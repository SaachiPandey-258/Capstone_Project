export type User = { id: string; email: string; name: string };

export type Assessment = {
  id: string;
  modality: "voice" | "voice_gait";
  status: "validation_required" | "unavailable" | "processing" | "completed" | "failed";
  unavailable_reason: string;
  created_at: string;
  consent_version: string;
  consented_at: string;
  duration_seconds: number;
  files: { kind: string; name: string; bytes: number; validated_rows: number | null }[];
  extracted_features?: Record<string, number> | null;
  extraction_version?: string | null;
  quality?: Record<string, unknown> | null;
  result: null | Record<string, unknown>;
};

export type Dashboard = {
  assessment_count: number;
  report_count: number;
  recent_assessments: Assessment[];
};

export type ModelAvailability = {
  voice: {
    artifact_available: boolean;
    precomputed_features_supported: boolean;
    raw_audio_inference_available: boolean;
    reason: string | null;
  };
  fusion: {
    artifact_files_available: boolean;
    portal_inference_available: boolean;
    reason: string;
  };
};

export type SpecialistSearch = {
  location: string;
  category: string;
  radius: number;
  latitude?: number;
  longitude?: number;
};

export type SpecialistProvider = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_miles: number;
  website: string | null;
  phone: string | null;
  osm_url: string;
};

export type SpecialistSearchResult = {
  location: string;
  providers: SpecialistProvider[];
  attribution: string;
};
