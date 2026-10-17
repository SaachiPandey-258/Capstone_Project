/** Site-wide details shown in the footer, contact and resource sections. Edit here. */
export const SITE = {
  name: "Parkinson’s Assessment & Monitoring",
  tagline: "Voice-based Parkinson’s screening research for India",
  institution: "SAKEC, Mumbai, India",
};

export type ExternalResource = { name: string; description: string; href: string };

export const INDIA_RESOURCES: ExternalResource[] = [
  {
    name: "Parkinson’s Disease and Movement Disorder Society (PDMDS)",
    description: "Indian non-profit offering support groups, therapy programmes and awareness.",
    href: "https://www.parkinsonssocietyindia.com/",
  },
  {
    name: "NIMHANS, Bengaluru",
    description: "National Institute of Mental Health and Neuro-Sciences — neurology and movement-disorder services.",
    href: "https://nimhans.ac.in/",
  },
  {
    name: "AIIMS, New Delhi",
    description: "All India Institute of Medical Sciences — Department of Neurology.",
    href: "https://www.aiims.edu/",
  },
  {
    name: "WHO fact sheet: Parkinson disease",
    description: "World Health Organization overview of symptoms, diagnosis and care.",
    href: "https://www.who.int/news-room/fact-sheets/detail/parkinson-disease",
  },
];

export const HELPLINES = [
  { label: "Emergency (India)", value: "112" },
  { label: "Tele-MANAS mental-health helpline", value: "14416" },
];
