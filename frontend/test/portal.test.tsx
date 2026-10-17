import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/site-header";
import HomePage from "@/app/page";
import { RequireAuth } from "@/components/require-auth";
import { AssessmentWizard } from "@/components/assessment-wizard";
import { ProgressView } from "@/components/progress-view";
import { ReportView } from "@/components/report-view";
import { AssessmentList } from "@/components/assessment-list";
import SpecialistsPage from "@/app/specialists/page";
import { parseVoiceFeatureDataset, previewGaitText, validateGaitFile, validateVoiceDuration, validateVoiceFile, hasValidFusionInputs } from "@/lib/assessment";
import { specialistUnavailableMessage, validateSpecialistLocation } from "@/lib/specialists";
import type { Assessment, User } from "@/lib/types";
import { api } from "@/lib/api";

let currentUser: User | null = null;
const replace = vi.fn();
const push = vi.fn();
let originalGeolocationDescriptor: PropertyDescriptor | undefined;
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
vi.mock("@/components/care-map", () => ({ default: () => <div data-testid="care-map" /> }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace, push }),
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
  push.mockReset();
});

afterEach(() => {
  cleanup();
  if (originalGeolocationDescriptor) {
    Object.defineProperty(navigator, "geolocation", originalGeolocationDescriptor);
    originalGeolocationDescriptor = undefined;
  } else {
    Reflect.deleteProperty(navigator, "geolocation");
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("navigation and authentication state", () => {
  it("shows public navigation and sign-in actions when signed out", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("About");
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/signin");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
  });

  it("makes the Parkinson’s assessment purpose and sign-in path clear on the homepage", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /Parkinson’s assessment, in context/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /already have an account\? sign in/i })[0]).toHaveAttribute("href", "/signin");
  });

  it("provides an accessible toggle for the compact navigation", async () => {
    render(<SiteHeader />);
    const toggle = screen.getByRole("button", { name: "Open navigation menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(toggle);
    expect(screen.getByRole("button", { name: "Close navigation menu" })).toHaveAttribute("aria-expanded", "true");
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
    expect(validateVoiceDuration(Number.NaN)).toContain("valid");
    expect(validateVoiceFile(new File(["voice"], "voice.mp3"))).toBeNull();
    expect(validateVoiceFile(new File(["voice"], "voice.bin"))).toContain("format");
    expect(validateGaitFile(new File(["x"], "gait.exe"))).toContain("CSV");
    expect(hasValidFusionInputs("voice_gait", new File(["voice"], "voice.webm"), 5, null, "")).toBe(false);
    const gaitRows = Array.from({ length: 200 }, (_, index) => Array.from({ length: 19 }, (_, column) => `${index + column}`).join(",")).join("\n");
    expect(previewGaitText(`time,left,right\n${gaitRows}`, "gait.csv").error).toBeNull();
    expect(previewGaitText(gaitRows.replaceAll(",", "\t"), "gait.txt").error).toBeNull();
    expect(previewGaitText("not,a,sensor,file", "gait.csv").error).toContain("numeric");
  });

  it("loads all 16 fields from the repository Parkinson's dataset format", () => {
    const dataset = [
      "name,MDVP:Fo(Hz),MDVP:Fhi(Hz),MDVP:Flo(Hz),MDVP:Jitter(%),MDVP:Jitter(Abs),MDVP:RAP,MDVP:PPQ,Jitter:DDP,MDVP:Shimmer,MDVP:Shimmer(dB),Shimmer:APQ3,Shimmer:APQ5,MDVP:APQ,Shimmer:DDA,NHR,HNR,status,RPDE,DFA,spread1,spread2,D2,PPE",
      "phon_R01_S01_1,119.992,157.302,74.997,0.00784,0.00007,0.00370,0.00554,0.01109,0.04374,0.42600,0.02182,0.03130,0.02971,0.06545,0.02211,21.033,1,0.414783,0.815285,-4.813031,0.266482,2.301442,0.284654",
    ].join("\n");
    const [row] = parseVoiceFeatureDataset(dataset, "parkinsons.data");
    expect(row.label).toBe("phon_R01_S01_1");
    expect(row.values).toEqual([
      "0.00784", "0.00007", "0.00370", "0.00554", "0.01109", "0.04374",
      "0.42600", "0.02182", "0.03130", "0.02971", "0.06545", "0.02211",
      "21.033", "0.414783", "0.815285", "0.284654",
    ]);
    expect(() => parseVoiceFeatureDataset("name,value\nsample,1", "wrong.csv")).toThrow(/missing a column/);
  });

  it("accepts every row of the bundled parkinsons.data file", async () => {
    const dataset = await readFile(resolve(process.cwd(), "../data/parkinsons.data"), "utf8");
    const rows = parseVoiceFeatureDataset(dataset, "parkinsons.data");
    expect(rows).toHaveLength(195);
    expect(rows[0].label).toBe("phon_R01_S01_1");
    expect(rows.every((row) => row.values.length === 16 && row.values.every((value) => Number.isFinite(Number(value))))).toBe(true);
  });

  it("fills the manual feature form from an uploaded repository data file", async () => {
    const modelStatus = vi.spyOn(api, "modelAvailability").mockResolvedValue({
      voice: { artifact_available: false, precomputed_features_supported: true, raw_audio_inference_available: false, reason: null },
      fusion: { artifact_files_available: false, portal_inference_available: false, reason: "Unavailable" },
    });
    const dataset = [
      "name,MDVP:Jitter(%),MDVP:Jitter(Abs),MDVP:RAP,MDVP:PPQ,Jitter:DDP,MDVP:Shimmer,MDVP:Shimmer(dB),Shimmer:APQ3,Shimmer:APQ5,MDVP:APQ,Shimmer:DDA,NHR,HNR,RPDE,DFA,PPE",
      "sample-1,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6",
    ].join("\n");
    const user = userEvent.setup();
    render(<AssessmentWizard />);
    await user.click(screen.getByRole("tab", { name: /Feature values/ }));
    await user.upload(screen.getByLabelText("Upload vocal feature dataset"), new File([dataset], "parkinsons.data", { type: "text/csv" }));
    expect(await screen.findByText("parkinsons.data · 1 records loaded")).toBeInTheDocument();
    expect(screen.getByLabelText("Jitter(%)")).toHaveValue(0.1);
    expect(screen.getByLabelText("Jitter:PPQ5")).toHaveValue(0.4);
    expect(screen.getByLabelText("Shimmer:APQ11")).toHaveValue(1);
    expect(screen.getByLabelText("PPE")).toHaveValue(1.6);
    modelStatus.mockRestore();
  });

  it("requests microphone access only after consent and explains unsupported browsers", async () => {
    const user = userEvent.setup();
    render(<AssessmentWizard />);
    const recordButton = screen.getByRole("button", { name: "Start recording" });
    expect(recordButton).toBeDisabled();
    await user.click(screen.getByLabelText(/I understand this is not a diagnosis/));
    expect(recordButton).toBeEnabled();
    await user.click(recordButton);
    expect(await screen.findByText(/Microphone recording is not supported/)).toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: /Feature values/ }));
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Full name"), "Asha Rao");
    for (const column of [
      "Jitter(%)", "Jitter(Abs)", "Jitter:RAP", "Jitter:PPQ5", "Jitter:DDP",
      "Shimmer", "Shimmer(dB)", "Shimmer:APQ3", "Shimmer:APQ5", "Shimmer:APQ11",
      "Shimmer:DDA", "NHR", "HNR", "RPDE", "DFA", "PPE",
    ]) await user.type(screen.getByLabelText(column), "1");
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    const submitted = submit.mock.calls[0][0] as FormData;
    expect(submitted.get("patient_name")).toBe("Asha Rao");
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

describe("assessment history and submission journey", () => {
  it("deletes an assessment only after inline confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AssessmentList assessments={[unavailable]} onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: /Delete assessment from/ }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete permanently?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("assessment-1");
  });

  it("explains gait and loads a sample walking recording for voice + gait", async () => {
    const sample = Array.from({ length: 220 }, (_, row) => [row / 100, ...Array(18).fill(10)].join("\t")).join("\n");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([sample], { type: "text/plain" }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AssessmentWizard />);
    expect(screen.getByText("What is gait, and why does it matter?")).toBeInTheDocument();
    expect(screen.getByText("Complete assessment")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Voice and gait assessment"));
    await user.click(screen.getByRole("button", { name: /Sample walk: person with Parkinson’s/ }));
    expect(fetchMock).toHaveBeenCalledWith("/samples/sample-walk-parkinsons-GaPt03.txt");
    expect(await screen.findByText(/Using sample: sample-walk-parkinsons-GaPt03.txt/)).toBeInTheDocument();
  });

  it("opens the report directly after a completed submission", async () => {
    vi.spyOn(api, "modelAvailability").mockResolvedValue({
      voice: { artifact_available: true, precomputed_features_supported: true, raw_audio_inference_available: true, reason: null },
      fusion: { artifact_files_available: false, portal_inference_available: false, reason: "Unavailable" },
    });
    vi.spyOn(api, "predictVoiceFeatures").mockResolvedValue({});
    vi.spyOn(api, "submitManualAssessment").mockResolvedValue({
      ...unavailable,
      id: "done-1",
      status: "completed",
      result: { prediction: 20, screening_tier: "not_detected", pd_probability: 0.2 },
    });
    const user = userEvent.setup();
    render(<AssessmentWizard />);
    await user.click(screen.getByLabelText(/I understand this is not a diagnosis/));
    await user.type(screen.getByLabelText("Full name"), "Asha Rao");
    await user.click(screen.getByRole("tab", { name: /Feature values/ }));
    for (const column of ["Jitter(%)", "Jitter(Abs)", "Jitter:RAP", "Jitter:PPQ5", "Jitter:DDP", "Shimmer", "Shimmer(dB)", "Shimmer:APQ3", "Shimmer:APQ5", "Shimmer:APQ11", "Shimmer:DDA", "NHR", "HNR", "RPDE", "DFA", "PPE"]) {
      await user.type(screen.getByLabelText(column), "1");
    }
    await user.click(screen.getByRole("button", { name: "Submit assessment" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reports/done-1?submitted=1"));
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
        listing_type: "Doctor / specialist",
        address: "12 Main Street",
        latitude: 45.5,
        longitude: -122.6,
        distance_km: 1.2,
        website: "https://example.org",
        phone: null,
        osm_url: "https://www.openstreetmap.org/node/123",
      }],
    });
    const user = userEvent.setup();
    render(<SpecialistsPage />);
    await user.type(screen.getByLabelText("City, area or PIN code"), "Pune");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("heading", { name: "Community Neurology" })).toBeInTheDocument();
    expect(screen.getByText(/12 Main Street/)).toBeInTheDocument();
    expect(screen.getByText("1.2 km")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "25 km" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "250 km" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "500 km" })).toBeInTheDocument();
    expect(screen.getByText(/Data: © OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^OpenStreetMap/ })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/node/123",
    );
    expect(await screen.findByTestId("care-map")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith({
      location: "Pune",
      category: "parkinsons-care",
      radius: 25,
    });
    search.mockRestore();
  });

  it("uses browser coordinates for nearby clinic search only after the user requests location", async () => {
    currentUser = { id: "user-1", email: "person@example.org", name: "Alex Person" };
    const search = vi.spyOn(api, "specialists").mockResolvedValue({
      location: "Current location",
      attribution: "© OpenStreetMap contributors",
      providers: [],
    });
    originalGeolocationDescriptor = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success({
          coords: { latitude: 45.5, longitude: -122.6 } as GeolocationCoordinates,
          timestamp: Date.now(),
        } as GeolocationPosition),
      },
    });
    const user = userEvent.setup();
    render(<SpecialistsPage />);
    await user.click(screen.getByRole("button", { name: /Use my location/ }));
    expect(await screen.findByText(/Your coordinates are sent only when you choose Search/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(search).toHaveBeenCalledWith({
      location: "Current location",
      category: "parkinsons-care",
      radius: 25,
      latitude: 45.5,
      longitude: -122.6,
    }));
    search.mockRestore();
  });
});

describe("reports and progress analytics", () => {
  it("renders an unavailable report without inventing a result", () => {
    render(<ReportView report={unavailable} />);
    expect(screen.getByRole("heading", { name: "There is no report to display" })).toBeInTheDocument();
    expect(screen.getByText(/No score, prediction, disease stage, or diagnosis/)).toBeInTheDocument();
  });

  it("renders a formal report with patient details, screening verdict, and severity gauge", () => {
    const completed: Assessment = {
      ...unavailable,
      status: "completed",
      unavailable_reason: "",
      patient: { full_name: "Asha Rao", age: 64, sex: "female", location: "Mumbai, India" },
      result: {
        model: "random-forest-updrs-v1",
        prediction: 41.2,
        updrs_scale_max: 108,
        severity_band: "Moderate",
        screening_model: "logistic-pd-screen-v2",
        pd_probability: 0.82,
        pd_threshold: 0.5,
        pd_detected: true,
        is_diagnostic: false,
      },
    };
    render(<ReportView report={completed} />);
    expect(screen.getByRole("heading", { name: "Voice Assessment Report" })).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Mumbai, India")).toBeInTheDocument();
    expect(screen.getByText("Detected", { selector: ".detection-verdict" })).toBeInTheDocument();
    expect(screen.getByText("Moderate motor severity (indicative)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Estimated motor UPDRS 41.2 of 108" })).toBeInTheDocument();
  });

  it("reports a borderline screen as inconclusive without a severity band", () => {
    const borderline: Assessment = {
      ...unavailable,
      status: "completed",
      unavailable_reason: "",
      result: {
        model: "ridge-log-updrs-v2",
        prediction: 21.4,
        prediction_mae: 7,
        severity_band: "Mild",
        screening_model: "logistic-pd-screen-v3",
        pd_probability: 0.52,
        screening_tier: "inconclusive",
        pd_detected: null,
        pd_low_threshold: 0.35,
        pd_high_threshold: 0.7,
        screening_error_rates: { pd_inconclusive: 0.49, healthy_inconclusive: 0.42 },
      },
    };
    render(<ReportView report={borderline} />);
    expect(screen.getByText("Inconclusive", { selector: ".detection-verdict" })).toBeInTheDocument();
    expect(screen.getByText("Severity not applicable")).toBeInTheDocument();
    expect(screen.getByText(/49% of people with Parkinson’s and 42% of healthy speakers/)).toBeInTheDocument();
    expect(screen.getByText(/± 7/)).toBeInTheDocument();
  });

  it("shows one combined verdict for voice + gait with both contributing models", () => {
    const combined: Assessment = {
      ...unavailable,
      modality: "voice_gait",
      status: "completed",
      unavailable_reason: "",
      patient: { full_name: "Asha Rao", age: 64, sex: "female", location: "Pune, India" },
      result: {
        model: "dual-branch-fusion-updrs-v1",
        prediction: 24.0,
        screening_basis: "voice_gait",
        screening_model: "late-fusion-mean-v1",
        pd_probability: 0.7,
        screening_tier: "detected",
        pd_low_threshold: 0.53,
        pd_high_threshold: 0.65,
        voice_screening: { model: "rf-spectral-pd-screen-v4", probability: 0.5, tier: "inconclusive", low_threshold: 0.44, high_threshold: 0.61 },
        gait_screening: { model: "svm-gait-pd-screen-v1", probability: 0.9, tier: "detected", low_threshold: 0.51, high_threshold: 0.8 },
        gait_features: { "Stride time (s)": 1.07, "Swing time CV (%)": 5.4 },
      },
    };
    render(<ReportView report={combined} />);
    expect(screen.getByText("Combined voice + gait screening")).toBeInTheDocument();
    expect(screen.getByText("Detected", { selector: ".detection-verdict" })).toBeInTheDocument();
    expect(screen.getByText("50% · Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("90% · Detected")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Gait measurements/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Participant information/ })).toBeInTheDocument();
    expect(screen.queryByText(/patient/i)).not.toBeInTheDocument();
  });

  it("explains why an empty progress history cannot show a trend", () => {
    render(<ProgressView assessments={[]} />);
    expect(screen.getByRole("heading", { name: "Not enough comparable data yet" })).toBeInTheDocument();
    expect(screen.getByText(/at least two completed assessments/)).toBeInTheDocument();
  });
});
