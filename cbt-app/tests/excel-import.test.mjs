import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readExcelTable, rowsToRecords } from "../src/utils/excelImport.js";

const mainNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkgNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const xml = (name, attrs, children) => `<${name} ${attrs}>${children}</${name}>`;
const cell = (ref, value, type = "inlineStr") =>
  type === "inlineStr"
    ? `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
    : `<c r="${ref}" t="${type}"><v>${value}</v></c>`;
async function makeFile(sheet, sharedStrings = null) {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", xml("workbook",
    `xmlns="${mainNs}" xmlns:r="${relNs}"`,
    '<sheets><sheet name="Students" sheetId="1" r:id="rId1"/></sheets>'));
  zip.file("xl/_rels/workbook.xml.rels", xml("Relationships", `xmlns="${pkgNs}"`,
    '<Relationship Id="rId1" Type="' + relNs + '/worksheet" Target="worksheets/sheet1.xml"/>'));
  zip.file("xl/worksheets/sheet1.xml", xml("worksheet", `xmlns="${mainNs}"`, `<sheetData>${sheet}</sheetData>`));
  if (sharedStrings) zip.file("xl/sharedStrings.xml", xml("sst", `xmlns="${mainNs}"`,
    sharedStrings.map((x) => `<si><t>${x}</t></si>`).join("")));
  return Object.assign(new Blob([await zip.generateAsync({type:"uint8array"})]), {name:"demo.xlsx"});
}
test("native Excel student import supports shared strings, missing cells and preserves text admission codes", async () => {
  const headers=["displayName","username","admissionNumber","className","subjects","password","email"];
  const headerCells=headers.map((v,i)=>cell(String.fromCharCode(65+i)+"1",v)).join("");
  const dataCells=[
    cell("A2",0,"s"),cell("B2","student001"),cell("C2","00125"),cell("D2","JSS1 A"),
    cell("E2","Math|English"),cell("F2","securePass123"),
  ].join("");
  const file=await makeFile(`<row r="1">${headerCells}</row><row r="2">${dataCells}</row>`, ["Test Student"]);
  const rows=await readExcelTable(file,200);
  assert.equal(rows.length,1);
  assert.equal(rows[0].displayName,"Test Student");
  assert.equal(rows[0].admissionNumber,"00125");
  assert.equal(rows[0].email,"");
  assert.equal(rows[0].__rowNumber,2);
});
test("native Excel questions, case-insensitive headers, and blank spacer rows", async()=>{
  const sheet=`<row r="1">${cell("A1","Question")}${cell("B1","Option A")}${cell("C1","Option B")}${cell("D1","Option C")}${cell("E1","Option D")}${cell("F1","Answer")}${cell("G1","Marks")}</row>
  <row r="3">${cell("A3","2 + 2?")}${cell("B3","4")}${cell("C3","5")}${cell("D3","6")}${cell("E3","7")}${cell("F3","A")}${cell("G3","2","n")}</row>`;
  const rows=await readExcelTable(await makeFile(sheet));
  assert.equal(rows[0].question,"2 + 2?");
  assert.equal(rows[0].optionA,"4");
  assert.equal(rows[0].marks,"2");
  assert.equal(rows[0].__rowNumber,3);
});
test("bad Excel headers, formulas and too many rows are rejected before upload",async()=>{
  assert.throws(() => rowsToRecords([
    {row:1,cells:["username","username"]},{row:2,cells:["a","b"]}
  ]),/Duplicate/);
  const sheet=`<row r="1">${cell("A1","username")}</row><row r="2"><c r="A2"><f>HYPERLINK("bad")</f><v>1</v></c></row>`;
  await assert.rejects(readExcelTable(await makeFile(sheet)),/formulas/);
  assert.throws(()=>rowsToRecords([
    {row:1,cells:["username"]},{row:2,cells:["u1"]},{row:3,cells:["u2"]}
  ],1),/at most 1/);
});
