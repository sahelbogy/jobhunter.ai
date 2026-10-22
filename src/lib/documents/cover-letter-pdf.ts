import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { SupportedLanguage } from "@/types/domain";
import { sha256Hex } from "@/lib/security/sanitize";

export interface CoverLetterPdfInput {
  language: SupportedLanguage;
  applicantName: string;
  applicantTitle?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  applicantLocation?: string;
  companyName: string;
  companyLocation?: string;
  jobTitle: string;
  subjectLine?: string;
  bodyText: string;
  date?: Date;
}

/**
 * Normalizes Unicode characters outside WinAnsiEncoding so StandardFonts.Helvetica
 * never throws encoding errors while preserving full French/European Latin-1 accents.
 */
function normalizeWinAnsi(text: string): string {
  return (text || "")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u0153/g, "oe")
    .replace(/\u0152/g, "OE")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF]/g, "");
}

function wrapLine(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function formatLetterDate(date: Date, lang: SupportedLanguage): string {
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function generateCoverLetterPdfBuffer(
  input: CoverLetterPdfInput
): Promise<{ buffer: Buffer; sha256: string; byteLength: number }> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(
    normalizeWinAnsi(`${input.applicantName} - Cover Letter - ${input.companyName}`)
  );
  pdfDoc.setAuthor(normalizeWinAnsi(input.applicantName || "Applicant"));
  pdfDoc.setCreator("AI Job Hunter");

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4 width in points
  const pageHeight = 841.89; // A4 height in points
  const marginX = 56;
  const contentWidth = pageWidth - marginX * 2;
  const bottomMargin = 58;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - 48;

  // Subtle executive top accent bar
  page.drawRectangle({
    x: 0,
    y: pageHeight - 8,
    width: pageWidth,
    height: 8,
    color: rgb(0.15, 0.39, 0.92),
  });

  // Applicant Name & Title
  const applicantName = normalizeWinAnsi(input.applicantName || "Candidate");
  page.drawText(applicantName, {
    x: marginX,
    y: cursorY,
    size: 18,
    font: fontBold,
    color: rgb(0.07, 0.09, 0.15),
  });
  cursorY -= 18;

  if (input.applicantTitle?.trim()) {
    page.drawText(normalizeWinAnsi(input.applicantTitle.trim()), {
      x: marginX,
      y: cursorY,
      size: 11,
      font: fontRegular,
      color: rgb(0.25, 0.32, 0.45),
    });
    cursorY -= 15;
  }

  const contactParts = [
    input.applicantEmail?.trim(),
    input.applicantPhone?.trim(),
    input.applicantLocation?.trim(),
  ].filter(Boolean);

  if (contactParts.length > 0) {
    const contactLine = normalizeWinAnsi(contactParts.join("  |  "));
    page.drawText(contactLine, {
      x: marginX,
      y: cursorY,
      size: 9.5,
      font: fontRegular,
      color: rgb(0.38, 0.43, 0.52),
    });
    cursorY -= 16;
  }

  // Divider line
  page.drawLine({
    start: { x: marginX, y: cursorY },
    end: { x: pageWidth - marginX, y: cursorY },
    thickness: 0.75,
    color: rgb(0.84, 0.87, 0.92),
  });
  cursorY -= 24;

  // Date & Recipient Block
  const dateStr = normalizeWinAnsi(
    formatLetterDate(input.date ?? new Date(), input.language)
  );
  page.drawText(dateStr, {
    x: marginX,
    y: cursorY,
    size: 10,
    font: fontRegular,
    color: rgb(0.35, 0.4, 0.48),
  });
  cursorY -= 22;

  const recipientHeader = normalizeWinAnsi(
    input.language === "fr"
      ? `À l'attention de l'équipe Recrutement — ${input.companyName}`
      : `Hiring Team — ${input.companyName}`
  );
  page.drawText(recipientHeader, {
    x: marginX,
    y: cursorY,
    size: 10.5,
    font: fontBold,
    color: rgb(0.1, 0.13, 0.2),
  });
  cursorY -= 14;

  if (input.companyLocation?.trim()) {
    page.drawText(normalizeWinAnsi(input.companyLocation.trim()), {
      x: marginX,
      y: cursorY,
      size: 10,
      font: fontRegular,
      color: rgb(0.35, 0.4, 0.48),
    });
    cursorY -= 18;
  } else {
    cursorY -= 8;
  }

  // Subject Line
  const defaultSubject =
    input.language === "fr"
      ? `Objet : Candidature au poste de ${input.jobTitle}`
      : `Subject: Application for ${input.jobTitle}`;
  const rawSubject = normalizeWinAnsi(input.subjectLine?.trim() || defaultSubject);
  const subjectPrefix =
    /^(objet|subject)\s*:/i.test(rawSubject)
      ? rawSubject
      : input.language === "fr"
        ? `Objet : ${rawSubject}`
        : `Subject: ${rawSubject}`;

  for (const sLine of wrapLine(subjectPrefix, fontBold, 10.5, contentWidth)) {
    page.drawText(sLine, {
      x: marginX,
      y: cursorY,
      size: 10.5,
      font: fontBold,
      color: rgb(0.12, 0.24, 0.56),
    });
    cursorY -= 15;
  }
  cursorY -= 10;

  // Body Paragraphs
  const rawParagraphs = normalizeWinAnsi(input.bodyText)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const fontSize = 10.5;
  const lineHeight = 15.5;

  for (const para of rawParagraphs) {
    const subLines = para.split("\n");
    for (const sub of subLines) {
      const wrapped = wrapLine(sub, fontRegular, fontSize, contentWidth);
      for (const line of wrapped) {
        if (cursorY < bottomMargin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          cursorY = pageHeight - 56;
        }
        page.drawText(line, {
          x: marginX,
          y: cursorY,
          size: fontSize,
          font: fontRegular,
          color: rgb(0.14, 0.17, 0.23),
        });
        cursorY -= lineHeight;
      }
    }
    cursorY -= 9;
  }

  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);
  return {
    buffer,
    sha256: sha256Hex(buffer),
    byteLength: buffer.byteLength,
  };
}
