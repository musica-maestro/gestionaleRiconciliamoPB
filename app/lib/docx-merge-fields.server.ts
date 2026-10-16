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

/** Display variants used in Word MERGEFIELD / placeholder templates. */
function mergeFieldNeedles(fieldName: string): string[] {
  const trimmed = fieldName.trim();
  return [
    // Verbali: `#CAMPO#` (e `#CAMPO`) — easy to find with Ctrl+F on "#"
    `#${trimmed}#`,
    `#${trimmed}`,
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

function lookupMergeValue(data: Record<string, string>, fieldName: string): string {
  if (Object.prototype.hasOwnProperty.call(data, fieldName)) {
    return data[fieldName] ?? "";
  }
  const lower = fieldName.toLowerCase();
  const key = Object.keys(data).find((k) => k.toLowerCase() === lower);
  return key ? (data[key] ?? "") : "";
}

/**
 * Replace the result text of Word complex MERGEFIELD fields (begin/separate/end).
 * Templates from "stampa unione" keep sample values as display text, not «campo».
 */
export function replaceMergeFieldResults(
  xml: string,
  data: Record<string, string>,
): string {
  const beginMarker = 'w:fldCharType="begin"';
  const pieces: string[] = [];
  let searchFrom = 0;

  while (true) {
    const beginIdx = xml.indexOf(beginMarker, searchFrom);
    if (beginIdx === -1) {
      pieces.push(xml.slice(searchFrom));
      break;
    }

    const runStart = xml.lastIndexOf("<w:r", beginIdx);
    if (runStart < searchFrom) {
      pieces.push(xml.slice(searchFrom, beginIdx + beginMarker.length));
      searchFrom = beginIdx + beginMarker.length;
      continue;
    }

    const separateIdx = xml.indexOf('w:fldCharType="separate"', beginIdx);
    const endIdx = xml.indexOf('w:fldCharType="end"', beginIdx);
    if (endIdx === -1) {
      pieces.push(xml.slice(searchFrom, beginIdx + beginMarker.length));
      searchFrom = beginIdx + beginMarker.length;
      continue;
    }
    // Ignore a "separate" that belongs to a later field.
    const separateInThisField =
      separateIdx !== -1 && separateIdx < endIdx ? separateIdx : -1;

    const endRunEnd = xml.indexOf("</w:r>", endIdx);
    if (endRunEnd === -1) {
      pieces.push(xml.slice(searchFrom, beginIdx + beginMarker.length));
      searchFrom = beginIdx + beginMarker.length;
      continue;
    }
    const fieldEnd = endRunEnd + "</w:r>".length;
    const fieldBlock = xml.slice(runStart, fieldEnd);

    const instr = [...fieldBlock.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g)]
      .map((m) => m[1])
      .join("")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    const mergeMatch = instr.match(/MERGEFIELD\s+([^\s\\]+)/i);

    pieces.push(xml.slice(searchFrom, runStart));

    if (!mergeMatch) {
      pieces.push(fieldBlock);
      searchFrom = fieldEnd;
      continue;
    }

    const value = lookupMergeValue(data, mergeMatch[1]);
    const escaped = xmlEscape(value);
    const resultRun = `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    const endRunStart = fieldBlock.lastIndexOf(
      "<w:r",
      fieldBlock.indexOf('w:fldCharType="end"'),
    );

    if (separateInThisField === -1) {
      // begin → instr → end (no result yet): inject display text before end.
      if (endRunStart < 0) {
        pieces.push(fieldBlock);
      } else {
        pieces.push(fieldBlock.slice(0, endRunStart) + resultRun + fieldBlock.slice(endRunStart));
      }
      searchFrom = fieldEnd;
      continue;
    }

    const sepClose = fieldBlock.indexOf(
      "</w:r>",
      fieldBlock.indexOf('w:fldCharType="separate"'),
    );
    const sepRunEnd = sepClose + "</w:r>".length;
    if (sepClose === -1 || endRunStart < sepRunEnd) {
      pieces.push(fieldBlock);
      searchFrom = fieldEnd;
      continue;
    }

    const before = fieldBlock.slice(0, sepRunEnd);
    const middle = fieldBlock.slice(sepRunEnd, endRunStart);
    const after = fieldBlock.slice(endRunStart);

    let replaced = false;
    const newMiddle = middle.replace(/<w:t([^>]*)>[\s\S]*?<\/w:t>/g, (_full, attrs: string) => {
      if (replaced) {
        return `<w:t${attrs}></w:t>`;
      }
      replaced = true;
      const needsSpace =
        !/\bxml:space\s*=/.test(attrs) &&
        (value.startsWith(" ") || value.endsWith(" ") || value.includes("  "));
      const nextAttrs = needsSpace ? `${attrs} xml:space="preserve"` : attrs;
      return `<w:t${nextAttrs}>${escaped}</w:t>`;
    });

    pieces.push(replaced ? before + newMiddle + after : before + resultRun + after);
    searchFrom = fieldEnd;
  }

  return pieces.join("");
}

/**
 * Fill Word MERGEFIELD placeholders in a DOCX buffer, then unlink fields to
 * plain text so PDF conversion keeps the values.
 * Supports real MERGEFIELD result runs, plus «field», &lt;field&gt;, and <field> display text.
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

    xml = replaceMergeFieldResults(xml, data);

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
