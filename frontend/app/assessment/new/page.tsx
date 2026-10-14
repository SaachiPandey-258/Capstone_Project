import { RequireAuth } from "@/components/require-auth";
import { PageHeading } from "@/components/ui";
import { AssessmentWizard } from "@/components/assessment-wizard";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";

export default function NewAssessmentPage() {
  return <RequireAuth><main className="private-page content-width">
    <PageHeading eyebrow="New assessment" title="Start an assessment">Choose voice-only or voice + gait. Review your inputs and consent before submitting.</PageHeading>
    <AssessmentWizard />
    <MedicalDisclaimer />
  </main></RequireAuth>;
}
