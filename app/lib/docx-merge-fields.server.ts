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

/** Display variants used in Word MERGEFIELD / placeholder templates (no open-ended `#CAMPO`). */
function mergeFieldNeedles(fieldName: string): string[] {
  const trimmed = fieldName.trim();
  return [
    // Verbali: only closed `#CAMPO#` (open `#CAMPO` matched inside longer names / broke ORE)
    `#${trimmed}#`,
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

/**
 * Find `needle` in virtual text only when it is not a substring of a longer
 * `#OTHER_FIELD#` token (e.g. `#MEDIATORE#` inside `#TITOLO_MEDIATORE#`).
 */
function indexOfSafeHashNeedle(virtualText: string, needle: string): number {
  if (!needle.startsWith("#") || !needle.endsWith("#") || needle.length < 3) {
    return virtualText.indexOf(needle);
  }
  let from = 0;
  while (from < virtualText.length) {
    const idx = virtualText.indexOf(needle, from);
    if (idx === -1) return -1;
    const before = idx > 0 ? virtualText[idx - 1] : "";
    const after = virtualText[idx + needle.length] ?? "";
    // Inside a longer #...# token if alnum/_ continues on either side before the fences
    const insideLonger =
      (before >= "A" && before <= "Z") ||
      (before >= "a" && before <= "z") ||
      (before >= "0" && before <= "9") ||
      before === "_" ||
      (after >= "A" && after <= "Z") ||
      (after >= "a" && after <= "z") ||
      (after >= "0" && after <= "9") ||
      after === "_";
    if (!insideLonger) return idx;
    from = idx + 1;
  }
  return -1;
}

function replaceOneOccurrenceAt(
  xml: string,
  runs: TextRun[],
  idx: number,
  needleLen: number,
  escapedValue: string,
): string {
  const vEnd = idx + needleLen;

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
    const localIdx = idx - runs.slice(0, startRun).reduce((n, r) => n + r.content.length, 0);
    const newContent =
      first.content.slice(0, localIdx) + escapedValue + first.content.slice(localIdx + needleLen);
    return xml.slice(0, first.start) + `${first.openTag}${newContent}</w:t>` + xml.slice(first.end);
  }

  // Multi-run: drop the whole needle span, put value at the start run.
  let startOffset = idx;
  for (let i = 0; i < startRun; i++) startOffset -= runs[i].content.length;
  let endOffset = vEnd;
  for (let i = 0; i < endRun; i++) endOffset -= runs[i].content.length;

  const beforeOpen = first.content.slice(0, Math.max(0, startOffset));
  const afterClose = last.content.slice(Math.max(0, endOffset));
  const firstNew = `${first.openTag}${beforeOpen}${escapedValue}</w:t>`;
  let between = xml.slice(first.end, last.start);
  between = between.replace(/(<w:t(?:[^>]*)>)[\s\S]*?(<\/w:t>)/g, "$1$2");
  const lastNew = `${last.openTag}${afterClose}</w:t>`;
  return xml.slice(0, first.start) + firstNew + between + lastNew + xml.slice(last.end);
}

/** Replace all placeholder occurrences for one field, including when split across `<w:t>` runs. */
export function replaceAllOccurrences(xml: string, fieldName: string, value: string): string {
  const escaped = xmlEscape(value);
  const needles = mergeFieldNeedles(fieldName);

  let iterations = 0;
  while (iterations++ < 500) {
    const runs = parseTextRuns(xml);
    const virtualText = runs.map((r) => r.content).join("");

    let foundNeedle: string | null = null;
    let foundIdx = -1;
    for (const needle of needles) {
      const idx = needle.startsWith("#")
        ? indexOfSafeHashNeedle(virtualText, needle)
        : virtualText.indexOf(needle);
      if (idx !== -1) {
        foundNeedle = needle;
        foundIdx = idx;
        break;
      }
    }
    if (!foundNeedle || foundIdx < 0) break;

    const next = replaceOneOccurrenceAt(xml, runs, foundIdx, foundNeedle.length, escaped);
    if (next === xml) break;
    xml = next;
  }

  return xml;
}

/**
 * Single-pass replace of every `#NAME#` token using `data` (avoids substring clashes
 * like `#MEDIATORE#` vs `#TITOLO_MEDIATORE#`).
 */
export function replaceHashPlaceholders(
  xml: string,
  data: Record<string, string>,
): string {
  let iterations = 0;
  while (iterations++ < 500) {
    const runs = parseTextRuns(xml);
    const virtualText = runs.map((r) => r.content).join("");
    const re = /#([A-Za-z_][A-Za-z0-9_]*)#/g;
    const match = re.exec(virtualText);
    if (!match) break;

    const full = match[0];
    const name = match[1];
    const value = lookupMergeValue(data, name);
    // Always consume the token (even if unknown → empty) so leftovers don't linger.
    const next = replaceOneOccurrenceAt(
      xml,
      runs,
      match.index,
      full.length,
      xmlEscape(value),
    );
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

/** True if `#NAME#` already appears in a `<w:t>` outside [excludeStart, excludeEnd). */
function hashPlaceholderExistsOutside(
  xml: string,
  placeholder: string,
  excludeStart: number,
  excludeEnd: number,
): boolean {
  const re = /(<w:t(?:[^>]*)>)([\s\S]*?)(<\/w:t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (end > excludeStart && start < excludeEnd) continue;
    if (m[2].includes(placeholder)) return true;
  }
  return false;
}

/**
 * Index of the last `<w:r>` / `<w:r ...>` run open tag before `beforeIdx`.
 * Must NOT match `<w:rPr`, `<w:rFonts`, `<w:rStyle`, etc. (that corrupted DOCX).
 */
function lastWrRunOpenIndex(xml: string, beforeIdx: number): number {
  const re = /<w:r(?:\s[^>]*)?>/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m.index >= beforeIdx) break;
    last = m.index;
  }
  return last;
}

/**
 * Replace the result text of Word complex MERGEFIELD fields (begin/separate/end).
 * Templates from "stampa unione" keep sample values as display text, not «campo».
 *
 * If the doc already has a plain `#NAME#` next to an empty leftover MERGEFIELD
 * (common after partial conversion), the field is dropped instead of injecting a
 * second `#NAME#` (which caused `11:0011:00` / name doubling).
 */
export function replaceMergeFieldResults(
  xml: string,
  _data: Record<string, string>,
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

    const runStart = lastWrRunOpenIndex(xml, beginIdx);
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

    // Normalize to `#NAME#` so a later single hash-pass fills once.
    const fieldName = mergeMatch[1];
    const placeholder = `#${fieldName}#`;
    const alreadyHasPlain = hashPlaceholderExistsOutside(
      xml,
      placeholder,
      runStart,
      fieldEnd,
    );

    // Leftover empty MERGEFIELD beside an existing `#NAME#` → drop the field.
    if (alreadyHasPlain) {
      searchFrom = fieldEnd;
      continue;
    }

    const escaped = xmlEscape(placeholder);
    const resultRun = `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    const endPosInBlock = fieldBlock.indexOf('w:fldCharType="end"');
    const endRunStart = lastWrRunOpenIndex(fieldBlock, endPosInBlock);

    if (separateInThisField === -1) {
      // begin → instr → end (no result yet): inject `#NAME#` before end.
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
      const nextAttrs = /\bxml:space\s*=/.test(attrs) ? attrs : `${attrs} xml:space="preserve"`;
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
 * Supports real MERGEFIELD result runs, `#CAMPO#`, «field», &lt;field&gt;, and <field>.
 *
 * Order matters: fill MERGEFIELD → flatten field chrome → replace `#CAMPO#` tokens.
 * That avoids doubling when a field result still contained `#CAMPO#`.
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
    xml = flattenWordFields(xml);
    // Hash tokens in a single safe pass (no substring clashes / no open `#CAMPO`).
    xml = replaceHashPlaceholders(xml, data);
    // Legacy «campo» / <campo> (convocazioni, ecc.)
    const entries = Object.entries(data).sort((a, b) => b[0].length - a[0].length);
    for (const [fieldName, value] of entries) {
      xml = replaceAllOccurrences(xml, fieldName, value ?? "");
    }
    xml = cleanupEmptyAddressArtifacts(xml);
    xml = cleanupDoubleSpaces(xml);

    zip.file(entry, xml);
  }

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

/** Collapse accidental double spaces left by empty placeholders (e.g. PG senza nome). */
function cleanupDoubleSpaces(xml: string): string {
  let iterations = 0;
  while (iterations++ < 50) {
    const runs = parseTextRuns(xml);
    const virtualText = runs.map((r) => r.content).join("");
    const idx = virtualText.search(/  +/);
    if (idx === -1) break;
    const match = virtualText.slice(idx).match(/^  +/);
    if (!match) break;
    const next = replaceOneOccurrenceAt(xml, runs, idx, match[0].length, " ");
    if (next === xml) break;
    xml = next;
  }
  return xml;
}
