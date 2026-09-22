// ============================================================
// NZOKO TRANSPORT — Génération de rapports multi-formats
// PDF (pdf-lib) · Word .docx (docx) · Excel .xlsx (exceljs)
// Le CSV reste généré à plat dans /api/reports (déjà en place).
// ============================================================

export type ExportFormat = "pdf" | "docx" | "xlsx";

export interface ReportExportRow {
  label: string;
  bookings: number;
  revenue: number;
  expenses: number;
}

export interface ReportExportInput {
  type: string;
  typeLabel: string;
  rowHeaderLabel: string;
  periodLabel: string;
  from: string;
  to: string;
  totalBookings: number;
  totalRevenue: number;
  totalExpenses: number;
  netResult: number;
  rows: ReportExportRow[];
}

export interface ReportExportResult {
  body: Uint8Array;
  contentType: string;
  filename: string;
}

// Couleurs de la marque (thème vert/orange NZOKO)
const BRAND = { r: 0x16 / 255, g: 0x7f / 255, b: 0x43 / 255 }; // vert #167F43
const DARK = { r: 0x1f / 255, g: 0x29 / 255, b: 0x37 / 255 };
const ORANGE = { r: 0xf9 / 255, g: 0x73 / 255, b: 0x16 / 255 };

/** Montant lisible : séparateur de milliers espace simple (sûr pour WinAnsi/PDF). */
function money(amount: number): string {
  const neg = amount < 0;
  const s = Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${s} FCFA`;
}

/** Supprime les glyphes absents de WinAnsi (PDF police standard). */
function pdfSafe(text: string): string {
  return text
    .replace(/\u2192/g, "->")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\u202F|\u2009/g, " ")
    .replace(/\u00AB|\u00BB/g, '"')
    .replace(/[^\x20-\xFF]/g, "")
    .replace(/[\x81\x8D\x8F\x90\x9D]/g, "");
}

function pdfFilename(input: ReportExportInput): string {
  const from = input.from.slice(0, 10);
  const to = input.to.slice(0, 10);
  return `nzoko-rapport-${input.type}-${from}_${to}`;
}

export function reportFilename(input: ReportExportInput, format: ExportFormat): string {
  return `${pdfFilename(input)}.${format}`;
}

// ------------------------------------------------------------
// PDF — pdf-lib (A4, en-tête de marque, KPIs + tableau, pagination)
// ------------------------------------------------------------
export async function generateReportPdf(input: ReportExportInput): Promise<ReportExportResult> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdf = await PDFDocument.create();
  pdf.setTitle(`NZOKO Transport - Rapport ${input.typeLabel}`);
  pdf.setAuthor("NZOKO Transport");
  pdf.setSubject(input.periodLabel);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const M = 44; // marge
  const brand = rgb(BRAND.r, BRAND.g, BRAND.b);
  const dark = rgb(DARK.r, DARK.g, DARK.b);
  const orange = rgb(ORANGE.r, ORANGE.g, ORANGE.b);
  const gray = rgb(0.55, 0.55, 0.55);
  const lightGray = rgb(0.93, 0.95, 0.94);
  const white = rgb(1, 1, 1);

  const columns = {
    label: { x: M + 8, width: 245 },
    bookings: { x: M + 262, width: 70, align: "right" as const },
    revenue: { x: M + 338, width: 100, align: "right" as const },
    expenses: { x: M + 438, width: 80, align: "right" as const },
  };

  const drawCell = (
    page: ReturnType<typeof pdf.addPage>,
    text: string,
    x: number,
    width: number,
    y: number,
    size: number,
    f: typeof font,
    color: ReturnType<typeof rgb>,
    align: "left" | "right"
  ) => {
    const clean = pdfSafe(text);
    const w = f.widthOfTextAtSize(clean, size);
    const tx = align === "right" ? x + width - w : x;
    page.drawText(clean, { x: tx, y, size, font: f, color });
  };

  let pageIndex = 0;
  let cursorY = 0;

  const newPage = () => {
    const page = pdf.addPage(A4);
    pageIndex += 1;

    // Bandeau de marque
    page.drawRectangle({ x: 0, y: A4[1] - 64, width: A4[0], height: 64, color: brand });
    page.drawText("NZOKO TRANSPORT", { x: M, y: A4[1] - 33, size: 17, font: bold, color: white });
    page.drawText("Voyagez simplement. Voyagez en confiance.", {
      x: M,
      y: A4[1] - 50,
      size: 8,
      font,
      color: rgb(0.9, 0.96, 0.92),
    });

    // Titre du rapport
    page.drawText(pdfSafe(`Rapport ${input.typeLabel}`), {
      x: M,
      y: A4[1] - 100,
      size: 14,
      font: bold,
      color: dark,
    });
    page.drawText(pdfSafe(`${input.periodLabel}  ·  du ${input.from.slice(0, 10)} au ${input.to.slice(0, 10)}`), {
      x: M,
      y: A4[1] - 116,
      size: 9.5,
      font,
      color: gray,
    });

    // Bloc KPIs
    const kpiY = A4[1] - 158;
    const kpiW = (A4[0] - M * 2 - 18) / 4;
    const kpis = [
      { label: "Revenus", value: money(input.totalRevenue), color: brand },
      { label: "Dépenses", value: money(input.totalExpenses), color: orange },
      {
        label: "Résultat net",
        value: money(input.netResult),
        color: input.netResult >= 0 ? brand : rgb(0.85, 0.2, 0.2),
      },
      { label: "Réservations", value: String(input.totalBookings), color: dark },
    ];
    kpis.forEach((kpi, i) => {
      const x = M + i * (kpiW + 6);
      page.drawRectangle({
        x,
        y: kpiY,
        width: kpiW,
        height: 48,
        color: lightGray,
      });
      drawCell(page, kpi.label, x + 8, kpiW - 16, kpiY + 30, 8, font, gray, "left");
      drawCell(page, kpi.value, x + 8, kpiW - 16, kpiY + 12, 10.5, bold, kpi.color, "left");
    });

    // En-tête du tableau
    const headY = kpiY - 34;
    page.drawRectangle({ x: M, y: headY - 6, width: A4[0] - M * 2, height: 22, color: dark });
    drawCell(page, pdfSafe(input.rowHeaderLabel), columns.label.x, columns.label.width, headY, 9, bold, white, "left");
    drawCell(page, "Réserv.", columns.bookings.x, columns.bookings.width, headY, 9, bold, white, "right");
    drawCell(page, "Revenus", columns.revenue.x, columns.revenue.width, headY, 9, bold, white, "right");
    drawCell(page, "Dépenses", columns.expenses.x, columns.expenses.width, headY, 9, bold, white, "right");

    cursorY = headY - 30;
    return page;
  };

  newPage();

  // Lignes de données
  input.rows.forEach((row, i) => {
    if (cursorY < 90) {
      newPage(); // pagination automatique
    }
    const p = pdf.getPage(pageIndex - 1)!;
    if (i % 2 === 1) {
      p.drawRectangle({
        x: M,
        y: cursorY - 5,
        width: A4[0] - M * 2,
        height: 20,
        color: rgb(0.97, 0.98, 0.97),
      });
    }
    drawCell(p, row.label, columns.label.x, columns.label.width, cursorY, 9.5, font, dark, "left");
    drawCell(p, String(row.bookings), columns.bookings.x, columns.bookings.width, cursorY, 9.5, font, dark, "right");
    drawCell(p, money(row.revenue), columns.revenue.x, columns.revenue.width, cursorY, 9.5, font, dark, "right");
    drawCell(p, money(row.expenses), columns.expenses.x, columns.expenses.width, cursorY, 9.5, font, dark, "right");
    cursorY -= 22;
  });

  // Ligne des totaux sur la dernière page active
  const activePage = pdf.getPage(pageIndex - 1)!;
  cursorY -= 4;
  activePage.drawLine({
    start: { x: M, y: cursorY + 12 },
    end: { x: A4[0] - M, y: cursorY + 12 },
    thickness: 1,
    color: brand,
  });
  drawCell(activePage, "TOTAL", columns.label.x, columns.label.width, cursorY, 9.5, bold, dark, "left");
  drawCell(
    activePage,
    String(input.totalBookings),
    columns.bookings.x,
    columns.bookings.width,
    cursorY,
    9.5,
    bold,
    dark,
    "right"
  );
  drawCell(activePage, money(input.totalRevenue), columns.revenue.x, columns.revenue.width, cursorY, 9.5, bold, brand, "right");
  drawCell(activePage, money(input.totalExpenses), columns.expenses.x, columns.expenses.width, cursorY, 9.5, bold, orange, "right");

  // Pied de page sur chaque page
  const pages = pdf.getPages();
  const generated = new Date();
  const stamp = pdfSafe(
    `Généré le ${generated.toISOString().slice(0, 10)} à ${generated.toISOString().slice(11, 16)} UTC+1 (Congo) — NZOKO Transport`
  );
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: M, y: 52 },
      end: { x: A4[0] - M, y: 52 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
    p.drawText(stamp, { x: M, y: 38, size: 7.5, font, color: gray });
    p.drawText(`Page ${i + 1} / ${pages.length}`, {
      x: A4[0] - M - 60,
      y: 38,
      size: 7.5,
      font,
      color: gray,
    });
  });

  const body = await pdf.save();
  return { body, contentType: "application/pdf", filename: `${pdfFilename(input)}.pdf` };
}

// ------------------------------------------------------------
// Word .docx — bibliothèque docx
// ------------------------------------------------------------
export async function generateReportDocx(input: ReportExportInput): Promise<ReportExportResult> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = await import("docx");

  const headerCells = [input.rowHeaderLabel, "Réservations", "Revenus", "Dépenses"];

  const cell = (text: string, opts: { bold?: boolean; right?: boolean; shade?: string } = {}) =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: opts.bold ?? false, size: 19, color: "1F2937" })],
        }),
      ],
      width: { size: 25, type: WidthType.PERCENTAGE },
      ...(opts.shade ? { shading: { fill: opts.shade } } : {}),
    });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerCells.map(
          (h) =>
            new TableCell({
              children: [
                new Paragraph({
                  alignment: h === headerCells[0] ? AlignmentType.LEFT : AlignmentType.RIGHT,
                  children: [new TextRun({ text: h, bold: true, size: 19, color: "FFFFFF" })],
                }),
              ],
              shading: { fill: "167F43" },
            })
        ),
      }),
      ...input.rows.map(
        (r) =>
          new TableRow({
            children: [
              cell(r.label),
              cell(String(r.bookings), { right: true }),
              cell(money(r.revenue), { right: true }),
              cell(money(r.expenses), { right: true }),
            ],
          })
      ),
      new TableRow({
        children: [
          cell("TOTAL", { bold: true, shade: "EAF2ED" }),
          cell(String(input.totalBookings), { bold: true, right: true, shade: "EAF2ED" }),
          cell(money(input.totalRevenue), { bold: true, right: true, shade: "EAF2ED" }),
          cell(money(input.totalExpenses), { bold: true, right: true, shade: "EAF2ED" }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "NZOKO Transport",
    title: `Rapport ${input.typeLabel}`,
    description: input.periodLabel,
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: "NZOKO TRANSPORT", bold: true, color: "167F43", size: 40 })],
          }),
          new Paragraph({
            children: [new TextRun({ text: `Rapport ${input.typeLabel}`, bold: true, size: 28 })],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `${input.periodLabel} - du ${input.from.slice(0, 10)} au ${input.to.slice(0, 10)}`,
                color: "6B7280",
                size: 20,
              }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: "" })] }),
          new Paragraph({
            children: [
              new TextRun({ text: "Revenus : ", bold: true }),
              new TextRun({ text: money(input.totalRevenue), color: "167F43" }),
              new TextRun({ text: "    Dépenses : ", bold: true }),
              new TextRun({ text: money(input.totalExpenses), color: "F97316" }),
              new TextRun({ text: "    Résultat net : ", bold: true }),
              new TextRun({
                text: money(input.netResult),
                color: input.netResult >= 0 ? "167F43" : "B91C1C",
              }),
              new TextRun({ text: `    Réservations : ${input.totalBookings}` }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: "" })] }),
          table,
          new Paragraph({ children: [new TextRun({ text: "" })] }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Généré le ${new Date().toISOString().slice(0, 10)} — NZOKO Transport — document généré automatiquement.`,
                color: "9CA3AF",
                size: 16,
                italics: true,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    body: new Uint8Array(buffer),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    filename: `${pdfFilename(input)}.docx`,
  };
}

// ------------------------------------------------------------
// Excel .xlsx — exceljs
// ------------------------------------------------------------
export async function generateReportXlsx(input: ReportExportInput): Promise<ReportExportResult> {
  const ExcelJS = (await import("exceljs")).default;

  const wb = new ExcelJS.Workbook();
  wb.creator = "NZOKO Transport";
  wb.created = new Date();

  // Volet figé sous l'en-tête du tableau (ligne 5)
  const ws = wb.addWorksheet("Rapport", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 5 }],
  });

  // Largeurs de colonnes
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 18;

  // Bandeau de titre (lignes 1-4), construit séquentiellement (pas de spliceRows)
  ws.addRow([`NZOKO TRANSPORT — Rapport ${input.typeLabel}`]);
  ws.mergeCells("A1:D1");
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF167F43" } };

  ws.addRow([`${input.periodLabel} — du ${input.from.slice(0, 10)} au ${input.to.slice(0, 10)}`]);
  ws.mergeCells("A2:D2");
  ws.getCell("A2").font = { color: { argb: "FF6B7280" }, size: 11 };

  ws.addRow(["Revenus / Dépenses / Résultat net (FCFA)"]);
  ws.mergeCells("A3:D3");
  ws.getCell("A3").font = { color: { argb: "FF6B7280" }, size: 10, italic: true };

  ws.addRow([`Résultat net : ${money(input.netResult)} — Réservations : ${input.totalBookings}`]);
  ws.mergeCells("A4:D4");
  ws.getCell("A4").font = { color: { argb: "FF6B7280" }, size: 10 };

  // En-tête du tableau (ligne 5)
  const headerRow = ws.addRow([input.rowHeaderLabel, "Réservations", "Revenus", "Dépenses"]);
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF167F43" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  headerRow.height = 22;

  // Lignes de données
  for (const r of input.rows) {
    const row = ws.addRow([r.label, r.bookings, r.revenue, r.expenses]);
    row.getCell(3).numFmt = '#,##0" FCFA"';
    row.getCell(4).numFmt = '#,##0" FCFA"';
    row.getCell(2).alignment = { horizontal: "center" };
  }

  // Ligne des totaux
  const total = ws.addRow(["TOTAL", input.totalBookings, input.totalRevenue, input.totalExpenses]);
  total.font = { bold: true };
  total.getCell(3).numFmt = '#,##0" FCFA"';
  total.getCell(4).numFmt = '#,##0" FCFA"';
  total.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2ED" } };
  });

  const buffer = await wb.xlsx.writeBuffer();
  return {
    body: new Uint8Array(buffer as ArrayBuffer),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: `${pdfFilename(input)}.xlsx`,
  };
}

export async function generateReport(
  format: ExportFormat,
  input: ReportExportInput
): Promise<ReportExportResult> {
  switch (format) {
    case "pdf":
      return generateReportPdf(input);
    case "docx":
      return generateReportDocx(input);
    case "xlsx":
      return generateReportXlsx(input);
  }
}
