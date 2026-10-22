// make-sample-papers.mjs — sinh 3 paper PDF tổng hợp vào samples/ (plan v4 mục 3.1, 5.1).
// Dữ liệu hoàn toàn bịa, không dùng nội dung thật. Không phụ thuộc thư viện ngoài.
// Dùng: node scripts/make-sample-papers.mjs

import { mkdirSync, writeFileSync } from 'node:fs';

const PAPERS = [
  { id: 'p1', title: 'Low-Resource ASR for Vietnamese Dialects', pages: 220 },
  { id: 'p2', title: 'Federated Learning on Hospital Imaging', pages: 260 },
  { id: 'p3', title: 'Quantum-Safe Voting Protocol', pages: 180 },
];

const esc = (s) => s.replace(/([\\()])/g, '\\$1');

function page(title, n) {
  const lines = [`${title} — synthetic draft, page ${n}`, ''];
  for (let i = 0; i < 38; i++) {
    lines.push(`[${n}.${i}] Synthetic text for the Papersec demo: this manuscript is generated `);
    lines.push(`    data and carries no real research result, measurement or citation.`);
  }
  const body = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 13 : 9} Tf 54 ${760 - i * 9} Td (${esc(l)}) Tj ET`)
    .join('\n');
  return `${body}\n`;
}

function buildPdf(title, pageCount) {
  const objs = []; // objs[i] = nội dung object i+1
  const kids = [];
  for (let n = 1; n <= pageCount; n++) {
    const stream = page(title, n);
    const contentId = 3 + (n - 1) * 2 + 1;
    const pageId = contentId + 1;
    objs[contentId - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    objs[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    kids.push(`${pageId} 0 R`);
  }
  objs[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[1] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(' ')}] >>`;
  objs[2] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let out = `%PDF-1.4\n`;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets[i] = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

mkdirSync('samples', { recursive: true });
for (const { id, title, pages } of PAPERS) {
  const buf = buildPdf(title, pages);
  writeFileSync(`samples/${id}.pdf`, buf);
  console.log(`samples/${id}.pdf  ${(buf.length / 1e6).toFixed(2)} MB  ${pages} trang  "${title}"`);
}
