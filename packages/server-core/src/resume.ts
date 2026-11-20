import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export class ResumeError extends Error { constructor(public code: 'UNSUPPORTED_FILE' | 'UNPROCESSABLE', message: string) { super(message); } }

/** Verifies the file signature (never trusts the extension alone) and returns plain text. */
export async function extractResumeText(buf: Buffer, originalName: string): Promise<string> {
  const head = buf.subarray(0, 5).toString('latin1');
  let text = '';
  try {
    if (head.startsWith('%PDF')) {
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try { text = (await parser.getText()).text; } finally { await parser.destroy().catch(() => {}); }
    } else if (buf.subarray(0, 2).toString('latin1') === 'PK') {
      if (!/\.docx$/i.test(originalName)) throw new ResumeError('UNSUPPORTED_FILE', 'ZIP-like file that is not a .docx. Please upload a PDF or DOCX resume.');
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (/\.txt$/i.test(originalName) && !buf.includes(0)) {
      text = buf.toString('utf8');
    } else if (buf.subarray(0, 4).toString('hex') === 'd0cf11e0') {
      throw new ResumeError('UNSUPPORTED_FILE', 'Legacy .doc files are not supported. Save as DOCX or PDF.');
    } else {
      throw new ResumeError('UNSUPPORTED_FILE', 'Unsupported file. Upload a PDF or DOCX with selectable text.');
    }
  } catch (e) {
    if (e instanceof ResumeError) throw e;
    throw new ResumeError('UNPROCESSABLE', 'The file could not be read. It may be corrupt. Try exporting it again.');
  }
  text = text.replace(/\u0000/g, '').trim();
  if (text.length < 20) throw new ResumeError('UNPROCESSABLE', 'No selectable text was found. Scanned documents are not supported yet (OCR is a future extension).');
  return text;
}
