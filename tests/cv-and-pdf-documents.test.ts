import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  analyzeCvWithAi,
  extractPdfTextFromBuffer,
} from "@/lib/cv/pdf-extractor";
import { detectTextLanguage } from "@/lib/documents/language";
import { generateTailoredApplicationWithAi } from "@/lib/documents/application-generator";
import { generateCoverLetterPdfBuffer } from "@/lib/documents/cover-letter-pdf";

describe("CV PDF Parsing, Language Detection & AI Document/PDF Generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GROQ_API_KEY;
  });

  it("extracts text from a real PDF CV and parses structured candidate profile via AI & deterministic fallback", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595.28, 841.89]);
    const cvLines = [
      "Youssef Benali - Senior Full-Stack Software Engineer",
      "Casablanca, Morocco | youssef.benali@example.com | +212 6 12 34 56 78",
      "Summary: 6 years of experience building cloud SaaS applications in FinTech and E-Commerce.",
      "Technical Skills: TypeScript, React, Next.js, Node.js, PostgreSQL, Docker, AWS, Tailwind CSS",
      "Languages: French (Fluent), English (Fluent), Arabic (Native)",
      "Experience: Lead Engineer at Atlas Cloud (2022 - Present) - Built payment APIs.",
      "Education: Master en Genie Logiciel - ENSIAS Rabat (2020)",
    ];
    cvLines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: 780 - i * 24, size: 11, font });
    });
    const savedUint8 = await pdf.save();
    // Simulate `Buffer.from(await file.arrayBuffer())` standalone ArrayBuffer view
    // to ensure `extractPdfTextFromBuffer` NEVER detaches the caller's Buffer!
    const standaloneArrayBuffer = savedUint8.buffer.slice(
      savedUint8.byteOffset,
      savedUint8.byteOffset + savedUint8.byteLength
    );
    const pdfBytes = Buffer.from(standaloneArrayBuffer);
    const expectedByteLength = pdfBytes.byteLength;
    expect(expectedByteLength).toBeGreaterThan(500);

    const extracted = await extractPdfTextFromBuffer(pdfBytes);
    expect(pdfBytes.byteLength).toBe(expectedByteLength);
    expect(extracted.pageCount).toBe(1);
    expect(extracted.rawText).toContain("Youssef Benali");
    expect(extracted.rawText).toContain("TypeScript");

    // 1. Deterministic fallback when GROQ_API_KEY is absent
    const fallbackResult = await analyzeCvWithAi({
      rawText: extracted.rawText,
      routing: { primaryProvider: "groq", fallbackProvider: null },
    });
    expect(fallbackResult.method).toBe("deterministic_fallback");
    expect(fallbackResult.profile.email).toBe("youssef.benali@example.com");
    expect(fallbackResult.profile.technical_skills).toEqual(
      expect.arrayContaining(["TypeScript", "React", "Next.js", "PostgreSQL"])
    );

    // 2. Full structured AI extraction with mocked Groq response
    process.env.GROQ_API_KEY = "gsk_test_mock_key";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "llama-3.3-70b-versatile",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  full_name: "Youssef Benali",
                  professional_title: "Senior Full-Stack Software Engineer",
                  email: "youssef.benali@example.com",
                  phone: "+212 6 12 34 56 78",
                  location: "Casablanca, Morocco",
                  summary:
                    "6 years of experience building cloud SaaS applications.",
                  years_of_experience: 6,
                  technical_skills: [
                    "TypeScript",
                    "React",
                    "Next.js",
                    "PostgreSQL",
                  ],
                  soft_skills: ["Leadership"],
                  technologies: ["Docker", "AWS"],
                  sectors: ["FinTech", "E-Commerce"],
                  languages: [{ language: "French", level: "Fluent" }],
                  certifications: [],
                  education: [
                    {
                      institution: "ENSIAS Rabat",
                      degree: "Master",
                      field: "Génie Logiciel",
                      startDate: "2018",
                      endDate: "2020",
                      location: "Rabat",
                      description: "",
                    },
                  ],
                  work_experience: [
                    {
                      company: "Atlas Cloud",
                      title: "Lead Engineer",
                      location: "Casablanca",
                      startDate: "2022",
                      endDate: "Present",
                      current: true,
                      highlights: ["Built payment APIs"],
                    },
                  ],
                  projects: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 210, completion_tokens: 180 },
        }),
        { status: 200 }
      )
    );

    const aiResult = await analyzeCvWithAi({
      rawText: extracted.rawText,
      routing: { primaryProvider: "groq", fallbackProvider: null },
    });
    expect(aiResult.method).toBe("ai");
    expect(aiResult.profile.full_name).toBe("Youssef Benali");
    expect(aiResult.profile.years_of_experience).toBe(6);
  });

  it("accurately detects French vs English job postings", () => {
    const frenchJob = detectTextLanguage(
      "Ingénieur Développement Full-Stack Next.js (H/F) — Nous recherchons un développeur expérimenté au sein de notre équipe à Casablanca. Profil recherché : maîtrise de TypeScript et PostgreSQL. Envoyez votre candidature."
    );
    expect(frenchJob).toBe("fr");

    const englishJob = detectTextLanguage(
      "Senior Backend Software Engineer (Remote Europe) — We are looking for a distributed systems engineer. Responsibilities include building resilient APIs. Requirements: 5+ years experience with Node.js and PostgreSQL."
    );
    expect(englishJob).toBe("en");
  });

  it("generates grounded French/English application emails and downloadable A4 Cover Letter PDFs", async () => {
    process.env.GROQ_API_KEY = "gsk_test_mock_key";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "llama-3.3-70b-versatile",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  email_subject:
                    "Candidature — Ingénieur Full-Stack Next.js — Youssef Benali",
                  email_greeting: "Madame, Monsieur,",
                  email_intro:
                    "Je vous adresse ma candidature pour le poste d'Ingénieur Full-Stack Next.js chez SQLI Maroc à Casablanca.",
                  email_experience_summary:
                    "Fort de 6 années d'expérience vérifiée en TypeScript, React, Next.js et PostgreSQL, j'ai piloté des plateformes cloud critiques.",
                  email_motivation:
                    "Rejoindre votre centre d'excellence digital à Casablanca représente une suite logique à mon parcours.",
                  email_closing:
                    "Veuillez trouver ci-joint mon CV ainsi que ma lettre de motivation.",
                  email_signature: "Cordialement,\nYoussef Benali",
                  cover_letter_subject:
                    "Objet : Candidature au poste d'Ingénieur Full-Stack Next.js",
                  cover_letter_greeting: "Madame, Monsieur,",
                  cover_letter_paragraphs: [
                    "Actuellement Lead Engineer chez Atlas Cloud à Casablanca, je souhaite mettre mes 6 années d'expérience en TypeScript, Next.js et PostgreSQL au service de SQLI Maroc.",
                    "Au cours de mes missions en FinTech, j'ai conçu des architectures cloud sécurisées répondant aux exigences de performance et de fiabilité.",
                    "Je reste à votre entière disposition pour échanger lors d'un entretien.",
                  ],
                  cover_letter_closing:
                    "Veuillez agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
                  cover_letter_signature: "Youssef Benali",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 320, completion_tokens: 240 },
        }),
        { status: 200 }
      )
    );

    const generated = await generateTailoredApplicationWithAi({
      profile: {
        full_name: "Youssef Benali",
        professional_title: "Senior Full-Stack Software Engineer",
        email: "youssef.benali@example.com",
        phone: "+212 6 12 34 56 78",
        location: "Casablanca, Morocco",
        years_of_experience: 6,
        technical_skills: ["TypeScript", "Next.js", "PostgreSQL"],
      },
      job: {
        title: "Ingénieur Full-Stack Next.js (H/F)",
        company_name: "SQLI Maroc",
        location: "Casablanca, Maroc",
        description:
          "Nous recherchons un ingénieur maîtrisant TypeScript, Next.js et PostgreSQL pour notre centre d'excellence à Casablanca.",
        required_skills: ["TypeScript", "Next.js", "PostgreSQL"],
      },
      routing: { primaryProvider: "groq", fallbackProvider: null },
    });

    expect(generated.language).toBe("fr");
    expect(generated.email_subject).toContain("Youssef Benali");

    const pdfResult = await generateCoverLetterPdfBuffer({
      language: generated.language,
      applicantName: "Youssef Benali",
      applicantTitle: "Senior Full-Stack Software Engineer",
      applicantEmail: "youssef.benali@example.com",
      applicantPhone: "+212 6 12 34 56 78",
      applicantLocation: "Casablanca, Morocco",
      companyName: "SQLI Maroc",
      companyLocation: "Casablanca, Maroc",
      jobTitle: "Ingénieur Full-Stack Next.js (H/F)",
      subjectLine: generated.email_subject,
      bodyText: generated.cover_letter_text,
    });

    expect(pdfResult.buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdfResult.sha256).toHaveLength(64);
    expect(pdfResult.byteLength).toBeGreaterThan(500);

    const parsedCl = await extractPdfTextFromBuffer(pdfResult.buffer);
    expect(parsedCl.rawText).toContain("Youssef Benali");
    expect(parsedCl.rawText).toContain("SQLI Maroc");
  });
});
