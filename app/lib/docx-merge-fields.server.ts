import JSZip from "jszip";

export type TextRun = {
  content: string;
  start: number;
  end: number;
  openTag: string;
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Display variants used in Word MERGEFIELD templates. */
function mergeFieldNeedles(fieldName: string): string[] {
  const trimmed = fieldName.trim();
  return [
    `\u00ab${trimmed}\u00bb`,
    `&lt;${trimmed}&gt;`,
    `<${trimmed}>`,
    // Some templates have a stray space inside the brackets, e.g. "< CF_Chiamato>"
    `&lt; ${trimmed}&gt;`,
    `< ${trimmed}>`,
  ];
}

/** Parse all `<w:t>` text runs from a Word XML fragment. */
export function parseTextRuns(xml: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(<w:t(?:[^>]*)>)([\s\S]*?)(<\/w:t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    runs.push({
      openTag: m[1],
      content: m[2],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return runs;
}

function replaceOneOccurrence(
  xml: string,
  runs: TextRun[],
  needle: string,
  escapedValue: string,
): string {
  const virtualText = runs.map((r) => r.content).join("");
  const idx = virtualText.indexOf(needle);
  if (idx === -1) return xml;

  const vEnd = idx + needle.length;

  let charPos = 0;
  let startRun = -1;
  let endRun = -1;
  for (let i = 0; i < runs.length; i++) {
    const rEnd = charPos + runs[i].content.length;
    if (startRun === -1 && rEnd > idx) startRun = i;
    if (charPos < vEnd) endRun = i;
    charPos = rEnd;
  }
  if (startRun === -1 || endRun === -1) return xml;

  const first = runs[startRun];
  const last = runs[endRun];

  if (startRun === endRun) {
    const newContent = first.content.replace(needle, escapedValue);
    return xml.slice(0, first.start) + `${first.openTag}${newContent}</w:t>` + xml.slice(first.end);
  }

  const openChar = needle[0];
  const closeChar = needle[needle.length - 1];
  const openIdx = first.content.indexOf(openChar);
  const beforeOpen = openIdx >= 0 ? first.content.slice(0, openIdx) : first.content;
  const firstNew = `${first.openTag}${beforeOpen}${escapedValue}</w:t>`;

  let between = xml.slice(first.end, last.start);
  between = between.replace(/(<w:t(?:[^>]*)>)[\s\S]*?(<\/w:t>)/g, "$1$2");

  const closeIdx = last.content.lastIndexOf(closeChar);
  const afterClose = closeIdx >= 0 ? last.content.slice(closeIdx + 1) : last.content;
  const lastNew = `${last.openTag}${afterClose}</w:t>`;

  return xml.slice(0, first.start) + firstNew + between + lastNew + xml.slice(last.end);
}

/** Replace all placeholder occurrences for one field, including when split across `<w:t>` runs. */
export function replaceAllOccurrences(xml: string, fieldName: string, value: string): string {
  const escaped = xmlEscape(value);
  const needles = mergeFieldNeedles(fieldName);

  let iterations = 0;
  while (iterations++ < 500) {
    if (!xml.includes(fieldName)) break;

    const runs = parseTextRuns(xml);
    const virtualText = runs.map((r) => r.content).join("");
    const needle = needles.find((n) => virtualText.includes(n));
    if (!needle) break;

    const next = replaceOneOccurrence(xml, runs, needle, escaped);
    if (next === xml) break;
    xml = next;
  }

  return xml;
}

/**
 * Remove Word field machinery (fldChar / instrText) so LibreOffice/Gotenberg
 * cannot re-evaluate empty MERGEFIELDs and wipe the filled display text.
 * Only drops runs that contain field markers; keeps runs with the filled values.
 */
export function flattenWordFields(xml: string): string {
  return xml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (run) => {
    if (/<w:fldChar\b/.test(run) || /<w:instrText\b/.test(run)) return "";
    return run;
  });
}

/**
 * Strip leftover punctuation from empty address MERGEFIELD layouts, e.g.
 * `«Indirizzo1» «Numero_civico» «Riga_2» , «Comune» ( «Provincia» )`
 * → `, ()` when all values are blank.
 */
export function cleanupEmptyAddressArtifacts(xml: string): string {
  // Match comma + empty parentheses with flexible whitespace.
  const artifactRe = /,\s*\(\s*\)/g;
  let iterations = 0;
  while (iterations++ < 50) {
    const runs = parseTextRuns(xml);
    const virtualText = runs.map((r) => r.content).join("");
    artifactRe.lastIndex = 0;
    const m = artifactRe.exec(virtualText);
    if (!m) break;
    const needle = m[0];
    const next = replaceOneOccurrence(xml, runs, needle, "");
    if (next === xml) break;
    xml = next;
  }
  return xml;
}

/**
 * Fill Word MERGEFIELD placeholders in a DOCX buffer, then unlink fields to
 * plain text so PDF conversion keeps the values.
 * Supports «field», &lt;field&gt;, and <field> display text.
 */
export async function fillWordMergeFields(
  docxBuffer: Buffer,
  data: Record<string, string>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);

  const xmlEntries = Object.keys(zip.files).filter(
    (name) => name.startsWith("word/") && name.endsWith(".xml"),
  );

  for (const entry of xmlEntries) {
    const xmlFile = zip.file(entry);
    if (!xmlFile) continue;
    let xml = await xmlFile.async("string");

    // Longer names first so e.g. PEC_Avvocato is not partially matched via PEC.
    const entries = Object.entries(data).sort((a, b) => b[0].length - a[0].length);
    for (const [fieldName, value] of entries) {
      xml = replaceAllOccurrences(xml, fieldName, value ?? "");
    }
    xml = flattenWordFields(xml);
    xml = cleanupEmptyAddressArtifacts(xml);

    zip.file(entry, xml);
  }

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}
