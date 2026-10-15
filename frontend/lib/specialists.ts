/** Marker/legend colour per listing type (shared by the map and the result list). */
export const CARE_TYPE_COLORS: Record<string, string> = {
  Hospital: "#c2493f",
  Clinic: "#1d4f8f",
  "Doctor / specialist": "#7b4fb3",
  "Physical therapy": "#2f8f78",
  "Organization / NGO": "#d79a2b",
  "Parkinson’s organization or service": "#d79a2b",
};

export function validateSpecialistLocation(location: string): string | null {
  const value = location.trim();
  if (!value) return "Enter a city, area or PIN code to search.";
  if (value.length < 2) return "Enter at least two characters for the location.";
  return null;
}

export function specialistUnavailableMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The specialist directory is temporarily unavailable. Please try again.";
}
