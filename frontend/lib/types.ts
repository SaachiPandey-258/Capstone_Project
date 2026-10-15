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
  result: null | AssessmentResult;
  patient?: PatientDetails | null;
};

export type PatientSex = "female" | "male" | "other" | "prefer_not_to_say";

export type PatientDetails = {
  full_name: string;
  age: number | null;
  sex: PatientSex | null;
  location: string | null;
};

export type ScreeningTier = "detected" | "inconclusive" | "not_detected";

export type ScreeningErrorRates = Partial<Record<
  "pd_detected" | "pd_inconclusive" | "pd_not_detected" | "healthy_detected" | "healthy_inconclusive" | "healthy_not_detected",
  number
>>;

export type AssessmentResult = Record<string, unknown> & {
  summary?: string;
  model?: string;
  target?: string;
  prediction?: number;
  updrs_scale_max?: number;
  severity_band?: "Mild" | "Moderate" | "Severe";
  screening_model?: string;
  pd_probability?: number;
  pd_threshold?: number;
  pd_detected?: boolean | null;
  screening_tier?: ScreeningTier;
  pd_low_threshold?: number;
  pd_high_threshold?: number;
  screening_error_rates?: ScreeningErrorRates | null;
  prediction_mae?: number;
  screening_unavailable_reason?: string;
  is_diagnostic?: boolean;
  notice?: string;
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
  screening?: {
    artifact_available: boolean;
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
  category: "parkinsons-care" | "neurology" | "movement-disorders" | "physical-therapy" | "hospitals-clinics" | "organizations";
  radius: number;
  latitude?: number;
  longitude?: number;
};

export type SpecialistProvider = {
  id: string;
  name: string;
  listing_type: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_km: number;
  website: string | null;
  phone: string | null;
  osm_url: string;
};

export type SpecialistSearchResult = {
  location: string;
  providers: SpecialistProvider[];
  attribution: string;
};
