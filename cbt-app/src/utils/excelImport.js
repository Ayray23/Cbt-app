// Reads native .xlsx workbooks locally; uploaded files never leave the browser.
// Uses the already-installed ZIP/XML libraries required by the DOCX importer.
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

const MAX_XML_BYTES = 8_000_000;
function nodes(root, name) {
  return Array.from(root.getElementsByTagNameNS("*", name));
}
function first(root, name) {
  return nodes(root, name)[0] || null;
}
function parseXml(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported XML declaration in workbook.");
  const document = new DOMParser({
    errorHandler: { warning: () => {}, error: (message) => { throw new Error(message); },
      fatalError: (message) => { throw new Error(message); } },
  }).parseFromString(xml, "application/xml");
  if (!document?.documentElement) throw new Error("Invalid Excel XML.");
  return document;
}
async function xmlFile(zip, path, required = true) {
  const entry = zip.file(path);
  if (!entry) {
    if (!required) return null;
    throw new Error("Invalid workbook: missing " + path);
  }
  if (entry._data?.uncompressedSize > MAX_XML_BYTES)
    throw new Error("Workbook has an oversized worksheet or string table.");
  const xml = await entry.async("string");
  if (xml.length > MAX_XML_BYTES)
    throw new Error("Workbook XML exceeds the size limit.");
  return parseXml(xml);
}
function colIndex(ref) {
  const match = /^([A-Z]+)[0-9]+$/i.exec(ref);
  if (!match) throw new Error("Invalid Excel cell reference.");
  return [...match[1].toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}
function cellText(cell, strings) {
  if (nodes(cell, "f").length)
    throw new Error("Excel formulas are not accepted. Paste their VALUES and import again.");
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return nodes(cell, "t").map((n) => n.textContent).join("");
  const value = first(cell, "v")?.textContent ?? "";
  if (type === "s") {
    const i = Number(value);
    if (!Number.isSafeInteger(i) || i >= strings.length) throw new Error("Invalid shared string reference.");
    return strings[i];
  }
  if (type === "e") throw new Error("Spreadsheet contains an Excel error cell.");
  return value;
}
function canonicalHeader(label) {
  const key = String(label || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const aliases = {
    fullname:"displayName", studentname:"displayName", name:"displayName",
    displayname:"displayName", username:"username", admissionno:"admissionNumber",
    admissionnumber:"admissionNumber", classname:"className", class:"className",
    subjects:"subjects", subject:"subjects", password:"password", email:"email",
    question:"question", questiontext:"question",
    a:"optionA", b:"optionB", c:"optionC", d:"optionD",
    optiona:"optionA", optionb:"optionB", optionc:"optionC", optiond:"optionD",
    correctanswer:"correctAnswer", answer:"correctAnswer", marks:"marks", score:"marks",
  };
  return aliases[key] || label.trim();
}
export function rowsToRecords(rows, maximum = 300) {
  const data = rows.filter((r) => r.cells.some((cell) => String(cell).trim()));
  if (data.length < 2) throw new Error("The Excel sheet needs a header and at least one data row.");
  const headers = data[0].cells.map((cell) => canonicalHeader(String(cell || "")));
  if (headers.some((name) => !name)) throw new Error("Excel column headings cannot be blank.");
  if (new Set(headers).size !== headers.length) throw new Error("Duplicate Excel column headings.");
  if (data.length - 1 > maximum) throw new Error(`Import at most ${maximum} rows per file.`);
  return data.slice(1).map(({ row, cells }) => {
    if (cells.length > headers.length && cells.slice(headers.length).some((x) => String(x).trim()))
      throw new Error(`Row ${row} has values outside the declared columns.`);
    return { ...Object.fromEntries(headers.map((key, i) => [key, String(cells[i] ?? "").trim()])), __rowNumber: row };
  });
}
export async function readExcelTable(file, maximum = 300) {
  if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > 2_000_000)
    throw new Error("Choose an .xlsx Excel workbook under 2 MB (not legacy .xls).");
  let zip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
  catch { throw new Error("The Excel workbook is damaged or not a valid .xlsx file."); }
  const workbook = await xmlFile(zip, "xl/workbook.xml");
  const relationships = await xmlFile(zip, "xl/_rels/workbook.xml.rels");
  const sheet = first(workbook, "sheet");
  if (!sheet) throw new Error("Excel workbook has no worksheets.");
  const relationId = sheet.getAttribute("r:id");
  const relationship = nodes(relationships, "Relationship")
    .find((rel) => rel.getAttribute("Id") === relationId);
  if (!relationship || !/\/worksheet$/.test(relationship.getAttribute("Type") || ""))
    throw new Error("Cannot locate the first worksheet.");
  const target = relationship.getAttribute("Target") || "";
  const sheetPath = target.startsWith("/xl/") ? target.slice(1) : "xl/" + target.replace(/^xl\//, "");
  if (sheetPath.includes("..") || !sheetPath.startsWith("xl/worksheets/"))
    throw new Error("Unsupported worksheet location.");
  const data = await xmlFile(zip, sheetPath);
  const shared = await xmlFile(zip, "xl/sharedStrings.xml", false);
  const strings = shared
    ? nodes(shared, "si").map((item) => nodes(item, "t").map((x) => x.textContent).join(""))
    : [];
  const rows = nodes(data, "row").map((rowNode, index) => {
    const number = Number(rowNode.getAttribute("r")) || index + 1;
    const values = [];
    for (const cell of nodes(rowNode, "c")) {
      const column = colIndex(cell.getAttribute("r") || "");
      if (column > 30) throw new Error("Excel sheet has too many columns (maximum 31).");
      values[column] = cellText(cell, strings);
    }
    return { row: number, cells: Array.from({length: values.length}, (_, i) => values[i] ?? "") };
  });
  return rowsToRecords(rows, maximum);
}
