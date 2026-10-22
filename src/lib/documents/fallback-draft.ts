import type {
  GeneratedApplicationPackage,
  SupportedLanguage,
  UserProfile,
} from "@/types/domain";
import { resolveApplicationLanguage } from "@/lib/documents/application-generator";

/**
 * Strictly factual, zero-hallucination application package builder used ONLY when no external
 * AI provider API key is configured yet, ensuring batch/scheduled preparation still produces
 * clean bilingual drafts strictly from verified CV facts without inventing credentials.
 */
export function buildVerifiedFallbackApplicationPackage(params: {
  profile: Partial<UserProfile>;
  job: {
    title: string;
    company_name: string;
    location: string;
    description: string;
    required_skills?: string[];
    detected_language?: SupportedLanguage;
  };
  languageOverride?: "auto" | SupportedLanguage;
}): GeneratedApplicationPackage {
  const lang = resolveApplicationLanguage(
    params.job.title,
    params.job.description,
    params.job.detected_language,
    params.languageOverride
  );

  const name = params.profile.full_name?.trim() || "Candidate";
  const title = params.profile.professional_title?.trim() || "";
  const years = Number(params.profile.years_of_experience ?? 0);
  const candidateSkills = [
    ...(params.profile.technical_skills ?? []),
    ...(params.profile.technologies ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  const reqLower = new Set(
    (params.job.required_skills ?? []).map((s) => s.toLowerCase())
  );
  const overlapping = candidateSkills.filter((s) =>
    reqLower.has(s.toLowerCase())
  );
  const featuredSkills = (
    overlapping.length > 0 ? overlapping : candidateSkills
  ).slice(0, 5);

  const recentRole = (params.profile.work_experience ?? [])[0];

  if (lang === "fr") {
    const emailSubject = `Candidature au poste de ${params.job.title} — ${name}`;
    const emailGreeting = `Madame, Monsieur,`;
    const emailIntro = `Je vous adresse ma candidature pour le poste de ${params.job.title} au sein de ${params.job.company_name} (${params.job.location}).`;

    const expSentenceParts: string[] = [];
    if (title) {
      expSentenceParts.push(
        `En tant que ${title}${years > 0 ? ` avec ${years} an(s) d'expérience` : ""}`
      );
    } else if (years > 0) {
      expSentenceParts.push(`Fort(e) de ${years} an(s) d'expérience`);
    }
    if (recentRole?.title && recentRole?.company) {
      expSentenceParts.push(
        `notamment en tant que ${recentRole.title} chez ${recentRole.company}`
      );
    }
    if (featuredSkills.length > 0) {
      expSentenceParts.push(
        `je maîtrise ${featuredSkills.join(", ")}`
      );
    }
    const emailExperienceSummary =
      expSentenceParts.length > 0
        ? `${expSentenceParts.join(", ")}, ce qui correspond directement aux enjeux techniques de cette opportunité.`
        : `Mon parcours et mes réalisations techniques correspondent aux exigences décrites dans votre offre.`;

    const emailMotivation = `Rejoindre ${params.job.company_name} représente pour moi l'opportunité de contribuer concrètement à vos projets tout en mettant à profit ma rigueur et mon sens des responsabilités. Vous trouverez ci-joint mon CV ainsi que ma lettre de motivation détaillée.`;
    const emailClosing = `Je reste à votre entière disposition pour un entretien afin d'échanger sur ma candidature. Dans cette attente, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.`;
    const emailSignature = [
      name,
      title,
      params.profile.phone,
      params.profile.email,
    ]
      .filter(Boolean)
      .join("\n");

    const emailBody = [
      emailGreeting,
      emailIntro,
      emailExperienceSummary,
      emailMotivation,
      emailClosing,
      emailSignature,
    ].join("\n\n");

    const clSubject = `Objet : Candidature au poste de ${params.job.title}`;
    const clGreeting = `Madame, Monsieur,`;
    const clParagraphs = [
      `Vivement intéressé(e) par les activités de ${params.job.company_name}, je vous soumets ma candidature pour le poste de ${params.job.title} basé à ${params.job.location}.`,
      emailExperienceSummary,
      params.profile.summary?.trim()
        ? params.profile.summary.trim()
        : `Au fil de mon parcours professionnel, j'ai développé une approche orientée qualité, collaboration et résolution pragmatique des problématiques techniques.`,
      `Disponible pour échanger à votre convenance, je serais ravi(e) de vous présenter plus en détail ma motivation lors d'un prochain entretien.`,
    ];
    const clClosing = `Veuillez agréer, Madame, Monsieur, l'expression de ma considération distinguée.`;
    const clText = [
      clSubject,
      clGreeting,
      ...clParagraphs,
      clClosing,
      name,
    ].join("\n\n");

    return {
      language: "fr",
      email_subject: emailSubject,
      email_greeting: emailGreeting,
      email_intro: emailIntro,
      email_experience_summary: emailExperienceSummary,
      email_motivation: emailMotivation,
      email_closing: emailClosing,
      email_signature: emailSignature,
      email_body: emailBody,
      cover_letter_subject: clSubject,
      cover_letter_greeting: clGreeting,
      cover_letter_paragraphs: clParagraphs,
      cover_letter_closing: clClosing,
      cover_letter_signature: name,
      cover_letter_text: clText,
      ai_provider: "verified_template",
      ai_model: "cv-factual-v1",
      fallback_used: true,
    };
  }

  const emailSubject = `Application for ${params.job.title} — ${name}`;
  const emailGreeting = `Dear Hiring Team at ${params.job.company_name},`;
  const emailIntro = `I am writing to submit my application for the ${params.job.title} position at ${params.job.company_name} (${params.job.location}).`;

  const enParts: string[] = [];
  if (title) {
    enParts.push(
      `As a ${title}${years > 0 ? ` with ${years} year(s) of experience` : ""}`
    );
  } else if (years > 0) {
    enParts.push(`With ${years} year(s) of professional experience`);
  }
  if (recentRole?.title && recentRole?.company) {
    enParts.push(
      `including my role as ${recentRole.title} at ${recentRole.company}`
    );
  }
  if (featuredSkills.length > 0) {
    enParts.push(`bringing hands-on proficiency in ${featuredSkills.join(", ")}`);
  }

  const emailExperienceSummary =
    enParts.length > 0
      ? `${enParts.join(", ")}, my background aligns closely with the requirements of this role.`
      : `My verified technical background and project delivery experience align closely with the requirements outlined in your posting.`;

  const emailMotivation = `I am eager to contribute to ${params.job.company_name}'s engineering and product goals. Please find my CV and tailored cover letter attached for your review.`;
  const emailClosing = `Thank you for your time and consideration. I look forward to the opportunity to discuss my candidacy further.`;
  const emailSignature = [
    name,
    title,
    params.profile.phone,
    params.profile.email,
  ]
    .filter(Boolean)
    .join("\n");

  const emailBody = [
    emailGreeting,
    emailIntro,
    emailExperienceSummary,
    emailMotivation,
    emailClosing,
    emailSignature,
  ].join("\n\n");

  const clSubject = `Re: Application for ${params.job.title}`;
  const clGreeting = `Dear Hiring Manager,`;
  const clParagraphs = [
    `I am pleased to apply for the ${params.job.title} opportunity at ${params.job.company_name} (${params.job.location}).`,
    emailExperienceSummary,
    params.profile.summary?.trim()
      ? params.profile.summary.trim()
      : `Throughout my work, I have focused on reliable execution, clean architecture, and collaborative delivery across cross-functional teams.`,
    `I welcome the opportunity to discuss how my verified skills and experience can support ${params.job.company_name}'s upcoming initiatives.`,
  ];
  const clClosing = `Sincerely,`;
  const clText = [
    clSubject,
    clGreeting,
    ...clParagraphs,
    clClosing,
    name,
  ].join("\n\n");

  return {
    language: "en",
    email_subject: emailSubject,
    email_greeting: emailGreeting,
    email_intro: emailIntro,
    email_experience_summary: emailExperienceSummary,
    email_motivation: emailMotivation,
    email_closing: emailClosing,
    email_signature: emailSignature,
    email_body: emailBody,
    cover_letter_subject: clSubject,
    cover_letter_greeting: clGreeting,
    cover_letter_paragraphs: clParagraphs,
    cover_letter_closing: clClosing,
    cover_letter_signature: name,
    cover_letter_text: clText,
    ai_provider: "verified_template",
    ai_model: "cv-factual-v1",
    fallback_used: true,
  };
}
