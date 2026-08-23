import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import type { ReportDocument, ReportFormat, ReportSheet } from './types'

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '-').slice(0, 80)
}

function cellValue(value: string | number | null | undefined): string | number {
  if (value == null) return ''
  return value
}

export async function exportReport(
  doc: ReportDocument,
  format: ReportFormat,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const base = sanitizeFilename(doc.title)
  if (format === 'xlsx') {
    const buffer = await exportXlsx(doc)
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${base}.xlsx`,
    }
  }
  if (format === 'csv') {
    const buffer = exportCsv(doc.sheets[0])
    return { buffer, contentType: 'text/csv; charset=utf-8', filename: `${base}.csv` }
  }
  const buffer = await exportPdf(doc)
  return { buffer, contentType: 'application/pdf', filename: `${base}.pdf` }
}

async function exportXlsx(doc: ReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'RCP'
  workbook.created = new Date(doc.generatedAt)

  for (const sheet of doc.sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31))
    ws.columns = sheet.columns.map((col) => ({
      header: col.label,
      key: col.key,
      width: col.width || Math.max(12, col.label.length + 2),
    }))
    ws.getRow(1).font = { bold: true }
    for (const row of sheet.rows) {
      const values: Record<string, string | number> = {}
      for (const col of sheet.columns) {
        values[col.key] = cellValue(row[col.key])
      }
      ws.addRow(values)
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

function exportCsv(sheet: ReportSheet | undefined): Buffer {
  if (!sheet) return Buffer.from('', 'utf-8')

  const escape = (value: string | number) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }

  const lines = [
    sheet.columns.map((c) => escape(c.label)).join(','),
    ...sheet.rows.map((row) =>
      sheet.columns.map((c) => escape(cellValue(row[c.key]))).join(','),
    ),
  ]
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf-8')
}

async function exportPdf(doc: ReportDocument): Promise<Buffer> {
  const sheet = doc.sheets[0]
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 40, size: 'A4' })
    const chunks: Buffer[] = []
    pdf.on('data', (chunk) => chunks.push(chunk as Buffer))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)

    pdf.fontSize(16).text(doc.title, { underline: true })
    pdf.moveDown(0.5)
    pdf.fontSize(10).fillColor('#444')
    pdf.text(`${doc.period.from} → ${doc.period.to}`)
    pdf.text(doc.generatedAt)
    pdf.moveDown()

    if (!sheet) {
      pdf.end()
      return
    }

    pdf.fillColor('#000').fontSize(11).text(sheet.name, { underline: true })
    pdf.moveDown(0.5)

    const colCount = Math.min(sheet.columns.length, 6)
    const tableCols = sheet.columns.slice(0, colCount)
    const colWidth = (pdf.page.width - 80) / colCount

    const drawRow = (values: string[], bold = false) => {
      const y = pdf.y
      if (y > pdf.page.height - 60) pdf.addPage()
      values.forEach((value, idx) => {
        pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(9)
          .text(value, 40 + idx * colWidth, pdf.y === y ? y : pdf.y, {
            width: colWidth - 4,
            lineBreak: false,
          })
      })
      pdf.moveDown(0.8)
    }

    drawRow(tableCols.map((c) => c.label), true)
    for (const row of sheet.rows.slice(0, 40)) {
      drawRow(
        tableCols.map((c) => String(cellValue(row[c.key]))),
      )
    }

    if (sheet.rows.length > 40) {
      pdf.moveDown().fontSize(8).fillColor('#666').text(`… ${sheet.rows.length - 40} more rows`)
    }

    pdf.end()
  })
}
