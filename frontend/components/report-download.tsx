"use client";

import {
  Circle,
  Document,
  Page,
  Path,
  PDFDownloadLink,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import { FileDown } from "lucide-react";
import type { Assessment } from "@/lib/types";
import {
  assessmentRows,
  featureRows,
  gaitRows,
  tierLabel,
  formatDateTime,
  LIMITATIONS,
  participantRows,
  reportFindings,
  reportNumber,
  SEVERITY_NOTE,
  type Findings,
} from "@/lib/report";

const NAVY = "#173967";
const MUTED = "#5d6d86";
const LINE = "#d9e1ec";
const BANDS = [
  { from: 0, to: 32, color: "#3f9b74" },
  { from: 32, to: 58, color: "#d79a2b" },
  { from: 58, to: 108, color: "#c2493f" },
];

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 9.5, color: "#1b2b44" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: NAVY },
  brand: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  ids: { fontSize: 8, color: MUTED, textAlign: "right", lineHeight: 1.5 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: NAVY, textAlign: "center", marginTop: 16, marginBottom: 14, letterSpacing: 0.5 },
  section: { marginBottom: 13 },
  heading: { fontSize: 10, fontFamily: "Helvetica-Bold", color: NAVY, paddingBottom: 4, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: LINE, textTransform: "uppercase", letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", flexDirection: "row", paddingVertical: 3.5, paddingRight: 10 },
  label: { width: "40%", color: MUTED },
  value: { flex: 1, fontFamily: "Helvetica-Bold" },
  findings: { flexDirection: "row", gap: 12 },
  box: { flex: 1, padding: 12, borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  boxLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  verdict: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 6 },
  verdictSub: { fontSize: 9, color: MUTED, marginTop: 3 },
  bar: { height: 7, backgroundColor: "#e6ecf4", borderRadius: 4, marginTop: 14, position: "relative" },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4 },
  barMark: { position: "absolute", top: -3, width: 1.5, height: 13, backgroundColor: "#1b2b44" },
  barLegend: { flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: MUTED, marginTop: 5 },
  score: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: -4 },
  scoreSub: { fontSize: 8.5, color: MUTED, textAlign: "center", marginTop: 2 },
  interpretation: { marginTop: 9, lineHeight: 1.3 },
  table: { borderWidth: 1, borderColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE },
  th: { flex: 1, padding: 4, fontFamily: "Helvetica-Bold", backgroundColor: "#f1f5fa", fontSize: 8.5 },
  td: { flex: 1, padding: 4, fontSize: 8.5 },
  note: { lineHeight: 1.5, color: "#33445e", marginBottom: 4 },
  foot: { position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 },
});

// Built-in PDF fonts use WinAnsi encoding, which lacks ≤ and ≥.
const pdfText = (text: string) => text.replace(/≤/g, "<=").replace(/≥/g, ">=");

function arcPath(from: number, to: number, max: number, cx: number, cy: number, r: number) {
  const point = (value: number) => {
    const angle = Math.PI * (1 - value / max);
    return `${(cx + r * Math.cos(angle)).toFixed(2)} ${(cy - r * Math.sin(angle)).toFixed(2)}`;
  };
  return `M ${point(from)} A ${r} ${r} 0 0 1 ${point(to)}`;
}

function PdfGauge({ findings }: { findings: Findings }) {
  const cx = 90, cy = 82, r = 62;
  const value = Math.max(0, Math.min(findings.max, findings.score));
  const angle = Math.PI * (1 - value / findings.max);
  const tipX = cx + (r - 8) * Math.cos(angle), tipY = cy - (r - 8) * Math.sin(angle);
  const baseX = 3.5 * Math.sin(angle), baseY = 3.5 * Math.cos(angle);
  const muted = findings.tier !== "detected";
  return (
    <Svg width={180} height={92} viewBox="0 0 180 92" style={{ alignSelf: "center", marginTop: 6 }}>
      {BANDS.map((band) => (
        <Path key={band.from} d={arcPath(band.from + 0.6, band.to - 0.6, findings.max, cx, cy, r)}
          stroke={muted ? "#c3ccd8" : band.color} strokeWidth={13} fill="none" />
      ))}
      <Path d={`M ${cx - baseX} ${cy - baseY} L ${tipX} ${tipY} L ${cx + baseX} ${cy + baseY} Z`} fill="#1b2b44" />
      <Circle cx={cx} cy={cy} r={6} fill="#1b2b44" />
    </Svg>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return <View style={styles.grid}>{rows.map(([label, value]) => (
    <View style={styles.cell} key={label}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>
  ))}</View>;
}

function AssessmentPdf({ report, findings }: { report: Assessment; findings: Findings }) {
  const features = featureRows(report);
  const half = Math.ceil(features.length / 2);
  const gait = gaitRows(report);
  const gaitHalf = Math.ceil(gait.length / 2);
  let sectionNo = 3;
  const verdictColor = findings.tier ? { detected: "#b23b32", inconclusive: "#a46f00", not_detected: "#2f7d5b" }[findings.tier] : MUTED;
  const severityApplies = findings.tier === "detected";
  return (
    <Document title={`Voice Assessment Report ${reportNumber(report)}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <View><Text style={styles.brand}>Parkinson&apos;s Assessment &amp; Monitoring</Text><Text style={styles.brandSub}>Research voice analysis</Text></View>
          <View><Text style={styles.ids}>Report no. {reportNumber(report)}</Text><Text style={styles.ids}>Issued {formatDateTime(report.created_at)}</Text></View>
        </View>
        <Text style={styles.title}>VOICE ASSESSMENT REPORT</Text>

        <View style={styles.section}><Text style={styles.heading}>1. Participant information</Text><Rows rows={participantRows(report)} /></View>
        <View style={styles.section}><Text style={styles.heading}>2. Assessment details</Text><Rows rows={assessmentRows(report)} /></View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.heading}>3. Findings</Text>
          <View style={styles.findings}>
            <View style={styles.box}>
              <Text style={styles.boxLabel}>{findings.combined ? "Combined voice + gait screening" : "Parkinson's voice screening"}</Text>
              <Text style={[styles.verdict, { color: verdictColor }]}>{findings.verdict}</Text>
              <Text style={styles.verdictSub}>{findings.headline}</Text>
              {findings.probability !== null && <>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { left: 0, width: `${findings.low * 100}%`, backgroundColor: "#cfe8da" }]} />
                  <View style={[styles.barFill, { left: `${findings.low * 100}%`, width: `${(findings.high - findings.low) * 100}%`, backgroundColor: "#f4e3b5" }]} />
                  <View style={[styles.barFill, { left: `${findings.high * 100}%`, right: 0, backgroundColor: "#f2cfca" }]} />
                  <View style={[styles.barMark, { left: `${findings.probability * 100}%`, width: 3, backgroundColor: "#1b2b44" }]} />
                </View>
                <View style={styles.barLegend}><Text>Model probability {(findings.probability * 100).toFixed(0)}%</Text><Text>Cut-offs {(findings.low * 100).toFixed(0)}% / {(findings.high * 100).toFixed(0)}%</Text></View>
              </>}
              {findings.parts.map((part) => (
                <Text key={part.label} style={[styles.verdictSub, { marginTop: 4 }]}>{part.label} model: {Math.round(part.probability * 100)}% · {tierLabel(part.tier)}</Text>
              ))}
              {findings.reliability && <Text style={[styles.verdictSub, { marginTop: 8 }]}>{findings.reliability}</Text>}
              {findings.gaitNote && <Text style={[styles.verdictSub, { marginTop: 6 }]}>{findings.gaitNote}</Text>}
            </View>
            <View style={styles.box}>
              <Text style={styles.boxLabel}>Estimated motor UPDRS (Part III)</Text>
              <PdfGauge findings={findings} />
              <Text style={styles.score}>{findings.score.toFixed(1)}{findings.mae ? ` +/- ${findings.mae.toFixed(0)}` : ""} / {findings.max}</Text>
              <Text style={styles.scoreSub}>{severityApplies ? `${findings.band} motor severity (indicative)` : "Severity not applicable"} · Mild 0-32 · Moderate 33-58 · Severe 59-108</Text>
            </View>
          </View>
          <Text style={styles.interpretation}>Interpretation. {findings.interpretation}</Text>
        </View>

        {features.length > 0 && <View style={styles.section} wrap={false}>
          <Text style={styles.heading}>{++sectionNo}. Acoustic measurements</Text>
          <View style={styles.table}>
            <View style={styles.tr}><Text style={styles.th}>Feature</Text><Text style={styles.th}>Value</Text><Text style={styles.th}>Feature</Text><Text style={styles.th}>Value</Text></View>
            {Array.from({ length: half }, (_, row) => (
              <View style={styles.tr} key={row}>
                <Text style={styles.td}>{features[row][0]}</Text><Text style={styles.td}>{features[row][1]}</Text>
                <Text style={styles.td}>{features[row + half]?.[0] ?? ""}</Text><Text style={styles.td}>{features[row + half]?.[1] ?? ""}</Text>
              </View>
            ))}
          </View>
        </View>}

        {gait.length > 0 && <View style={styles.section} wrap={false}>
          <Text style={styles.heading}>{++sectionNo}. Gait measurements</Text>
          <View style={styles.table}>
            <View style={styles.tr}><Text style={styles.th}>Measure</Text><Text style={styles.th}>Value</Text><Text style={styles.th}>Measure</Text><Text style={styles.th}>Value</Text></View>
            {Array.from({ length: gaitHalf }, (_, row) => (
              <View style={styles.tr} key={row}>
                <Text style={styles.td}>{gait[row][0]}</Text><Text style={styles.td}>{gait[row][1]}</Text>
                <Text style={styles.td}>{gait[row + gaitHalf]?.[0] ?? ""}</Text><Text style={styles.td}>{gait[row + gaitHalf]?.[1] ?? ""}</Text>
              </View>
            ))}
          </View>
        </View>}

        <View style={styles.section} wrap={false}>
          <Text style={styles.heading}>{++sectionNo}. Notes and limitations</Text>
          <Text style={styles.note}>{pdfText(SEVERITY_NOTE)}</Text>
          <Text style={styles.note}>{pdfText(LIMITATIONS)}</Text>
        </View>

        <View style={styles.foot} fixed>
          <Text>Record ID {report.id}</Text>
          <Text render={({ pageNumber, totalPages }) => `Research output only - not a diagnosis · Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function ReportDownload({ report }: { report: Assessment }) {
  const findings = report.status === "completed" ? reportFindings(report) : null;
  if (!findings) return null;
  return (
    <PDFDownloadLink
      className="button"
      document={<AssessmentPdf report={report} findings={findings} />}
      fileName={`voice-assessment-${reportNumber(report)}.pdf`}
    >
      {({ loading }) => <><FileDown size={17} />{loading ? "Preparing PDF…" : "Download PDF report"}</>}
    </PDFDownloadLink>
  );
}
