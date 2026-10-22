import type { SupportedLanguage } from "@/types/domain";

const FRENCH_MARKERS = [
  "nous recherchons",
  "profil recherché",
  "missions",
  "expérience",
  "compétences",
  "candidature",
  "poste",
  "entreprise",
  "formation",
  "diplôme",
  "ingénieur",
  "développeur",
  "chargé",
  "responsable",
  "stage",
  "cdi",
  "cdd",
  "télétravail",
  "maîtrise",
  "vous êtes",
  "rejoignez",
  "casablanca",
  "rabat",
  "maroc",
  "langues",
  "français",
];

const ENGLISH_MARKERS = [
  "we are looking",
  "responsibilities",
  "requirements",
  "qualifications",
  "experience",
  "skills",
  "about the role",
  "what you will do",
  "who you are",
  "full-time",
  "remote",
  "bachelor",
  "master",
  "engineer",
  "developer",
  "manager",
  "apply",
  "benefits",
  "team",
  "strong knowledge",
];

export function detectTextLanguage(text: string): SupportedLanguage {
  if (!text || !text.trim()) return "en";
  const sample = text.slice(0, 6000).toLowerCase();

  let frScore = 0;
  let enScore = 0;

  for (const term of FRENCH_MARKERS) {
    if (sample.includes(term)) frScore += 2;
  }
  for (const term of ENGLISH_MARKERS) {
    if (sample.includes(term)) enScore += 2;
  }

  // French accented characters strongly signal French
  const accentMatches = sample.match(/[éèêëàâîïôûùçœ]/g);
  if (accentMatches && accentMatches.length >= 4) {
    frScore += Math.min(12, Math.floor(accentMatches.length / 2));
  }

  // Common stopwords check
  const frStops = (
    sample.match(/\b(le|la|les|des|dans|pour|avec|une|sur|aux|chez|notre|votre)\b/g) ?? []
  ).length;
  const enStops = (
    sample.match(/\b(the|and|with|for|our|your|this|from|that|will|have|are)\b/g) ?? []
  ).length;

  frScore += Math.min(10, Math.floor(frStops / 3));
  enScore += Math.min(10, Math.floor(enStops / 3));

  return frScore > enScore ? "fr" : "en";
}
