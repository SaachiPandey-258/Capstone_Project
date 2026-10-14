import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { AssessmentWizard } from "@/components/assessment-wizard";
import { AnalyticsView } from "@/components/analytics-view";
import { ReportView } from "@/components/report-view";
import SpecialistsPage from "@/app/specialists/page";
import { previewGaitText, validateGaitFile, validateVoiceDuration, validateVoiceFile, hasValidFusionInputs } from "@/lib/assessment";
import { specialistUnavailableMessage, validateSpecialistLocation } from "@/lib/specialists";
import type { Assessment, User } from "@/lib/types";
import { api } from "@/lib/api";

let currentUser: User | null = null;
const replace = vi.fn();
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    user: currentUser,
    loading: false,
    authError: "",
    retrySession: vi.fn(),
    signIn: vi.fn(),
    register: vi.fn(),
    googleSignIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
}));

const unavailable: Assessment = {
  id: "assessment-1",
  modality: "voice",
  status: "unavailable",
  unavailable_reason: "No inference model is configured. No score was produced.",
  created_at: "2025-01-01T12:00:00+00:00",
  consent_version: "v1",
  consented_at: "2025-01-01T12:00:00+00:00",
  duration_seconds: 5,
  files: [{ kind: "voice", name: "voice.webm", bytes: 100, validated_rows: null }],
  result: null,
};
const validationRequired: Assessment = {
  ...unavailable,
  status: "validation_required",
  unavailable_reason: "Feature validation required; no score was produced.",
};

beforeEach(() => {
  currentUser = null;
  replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("navigation and authentication state", () => {
  it("shows public navigation and sign-in actions when signed out", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("About");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
  });

  it("shows the unified private navigation when signed in", () => {
    currentUser = { id: "user-1", email: "person@example.org", name: "Alex Person" };
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Find care" })).toHaveAttribute("href", "/specialists");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("does not render private content for a signed-out visitor", async () => {
    render(<RequireAuth><p>Private assessment history</p></RequireAuth>);
    expect(screen.queryByText("Private assessment history")).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
  });

  it("clears an expired API session and dispatches the expiration state", async () => {
    localStorage.setItem("parkinson-portal-token", "expired-token");
    const expired = vi.fn();
    window.addEventListener("portal:session-expired", expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Your session has expired. Sign in again." }),
    }));
    await expect(api.me()).rejects.toThrow("Your session has expired");
    expect(localStorage.getItem("parkinson-portal-token")).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener("portal:session-expired", expired);
  });
});

describe("assessment validation and submission", () => {
  it("checks recording duration, gait format, and fusion inputs", () => {
    expect(validateVoiceDuration(2)).toContain("at least");
    expect(validateVoiceDuration(61)).toContain("or less");
    expect(validateVoiceDuration(4)).toBeNull();
    expect(validateVoiceFile(new File(["voice"], "voice.bin"))).toContain("format");
    expect(validateGaitFile(new File(["x"], "gait.exe"))).toContain("CSV");
    expect(hasValidFusionInputs("voice_gait", new File(["voice"], "voice.webm"), 5, null, "")).toBe(false);
    expect(previewGaitText("sensor_x,sensor_y\n1.2,2.4\n3.1,4.5", "gait.csv").error).toBeNull();
    expect(previewGaitText("0.000\t71.72\t174.9\n0.010\t71.72\t174.9", "gait.txt").error).toBeNull();
    expect(previewGaitText("not,a,sensor,file", "gait.csv").error).toContain("numeric");
  });

  it("validates the exact 16-feature form and waits for the API before rendering an assessment result", async () => {
    const user = userEvent.setup();
    const predict = vi.spyOn(api, "predictVoiceFeatures").mockResolvedValue({
      model: "random-forest-updrs-v1",
      target: "motor_UPDRS",
      prediction: 1,
      is_diagnostic: false,
      notice: "Research output only",
    });
    const submit = vi.spyOn(api, "submitManualAssessment");
    const modelStatus = vi.spyOn(api, "modelAvailability").mockResolvedValue({
      voice: {
        artifact_available: true,
        precomputed_features_supported: true,
        raw_audio_inference_available: false,
        reason: null,
      },
      fusion: {
        artifact_files_available: false,
        portal_inference_available: false,
        reason: "Fusion checkpoint and scaler artifacts are unavailable.",
      },
    });
    let finishRequest: ((value: Assessment) => void) | undefined;
    submit.mockReturnValue(new Promise((resolve) => { finishRequest = resolve; }));
    render(<AssessmentWizard />);
    expect(await screen.findByText(/exact 16-feature input/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Submit assessment" });
    expect(button).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Your assessment record was saved" })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/I understand this is not a diagnosis/));
    expect(button).toBeDisabled();
    for (const column of [
      "Jitter(%)", "Jitter(Abs)", "Jitter:RAP", "Jitter:PPQ5", "Jitter:DDP",
      "Shimmer", "Shimmer(dB)", "Shimmer:APQ3", "Shimmer:APQ5", "Shimmer:APQ11",
      "Shimmer:DDA", "NHR", "HNR", "RPDE", "DFA", "PPE",
    ]) await user.type(screen.getByLabelText(column), "1");
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Submitting securely…" })).toBeInTheDocument();
    expect(screen.queryByText(/Your assessment record was saved/)).not.toBeInTheDocument();
    expect(finishRequest).toBeTypeOf("function");
    await act(async () => { finishRequest?.(validationRequired); });
    expect(await screen.findByText("Your assessment record was saved")).toBeInTheDocument();
    expect(screen.getByText("Analysis unavailable")).toBeInTheDocument();
    expect(screen.getByText(/no score was produced/i)).toBeInTheDocument();
    predict.mockRestore();
    submit.mockRestore();
    modelStatus.mockRestore();
  });
});

describe("specialist search edge cases", () => {
  it("requires a manual location and does not invent search results", () => {
    expect(validateSpecialistLocation("   ")).toContain("Enter a city");
    expect(validateSpecialistLocation("X")).toContain("two characters");
    expect(validateSpecialistLocation("Portland")).toBeNull();
    expect(specialistUnavailableMessage(new Error("No provider directory is configured"))).toContain("No provider directory");
  });

  it("renders only real specialist-search results with OpenStreetMap attribution", async () => {
    currentUser = { id: "user-1", email: "person@example.org", name: "Alex Person" };
    const search = vi.spyOn(api, "specialists").mockResolvedValue({
      location: "Portland",
      attribution: "© OpenStreetMap contributors",
      providers: [{
        id: "node/123",
        name: "Community Neurology",
        address: "12 Main Street",
        latitude: 45.5,
        longitude: -122.6,
        distance_miles: 1.2,
        website: "https://example.org",
        phone: null,
        osm_url: "https://www.openstreetmap.org/node/123",
      }],
    });
    const user = userEvent.setup();
    render(<SpecialistsPage />);
    await user.type(screen.getByLabelText("City or postal code"), "Portland");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("heading", { name: "Community Neurology" })).toBeInTheDocument();
    expect(screen.getByText("12 Main Street")).toBeInTheDocument();
    expect(screen.getByText(/Data: © OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /OpenStreetMap/ })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/node/123",
    );
    expect(search).toHaveBeenCalledWith({
      location: "Portland",
      category: "neurology",
      radius: 25,
    });
    search.mockRestore();
  });
});

describe("reports and progress analytics", () => {
  it("renders an unavailable report without inventing a result", () => {
    render(<ReportView report={unavailable} />);
    expect(screen.getByRole("heading", { name: "There is no report to display" })).toBeInTheDocument();
    expect(screen.getByText(/No score, prediction, disease stage, or diagnosis/)).toBeInTheDocument();
  });

  it("explains why an empty analytics history cannot show a trend", () => {
    render(<AnalyticsView assessments={[]} />);
    expect(screen.getByRole("heading", { name: "Not enough comparable data yet" })).toBeInTheDocument();
    expect(screen.getByText(/at least two completed assessments/)).toBeInTheDocument();
  });
});
