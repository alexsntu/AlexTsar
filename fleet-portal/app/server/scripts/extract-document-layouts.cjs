// Read styles only. No client values or formulas are included in source code.
const ExcelJS = require('exceljs');
const path = require('node:path');
const fs = require('node:fs');
const dir = process.argv[2];
if (!dir) { console.error('Usage: npm run layouts:extract -- <reference-directory> [output.ts]'); process.exit(1); }
const JSZip = require('jszip');
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
async function xmlLayout(file,index){const zip=await JSZip.loadAsync(fs.readFileSync(dir+'/'+file));const xml=await zip.file(`xl/worksheets/sheet${index+1}.xml`).async('string');const stylesXml=await zip.file("xl/styles.xml").async("string");return {normalFont:stylesXml.match(/<font>.*?<\/font>/s)[0],pageAttributes:Object.fromEntries(Object.entries(attrs(xml.match(/<pageSetup\b[^>]*>/)[0])).filter(([k])=>k!=="r:id")),bestFitColumns:[...xml.matchAll(/<col\b[^>]*>/g)].map(m=>attrs(m[0])).filter(a=>a.bestFit==="1").flatMap(a=>Array.from({length:Number(a.max)-Number(a.min)+1},(_,i)=>Number(a.min)+i)),sheetFormat:attrs(xml.match(/<sheetFormatPr\b[^>]*>/)[0]),rowAttributes:Object.fromEntries([...xml.matchAll(/<row\b[^>]*>/g)].map(m=>{const a=attrs(m[0]);const r=a.r;return [r,Object.fromEntries(Object.entries(a).filter(([k])=>['ht','customHeight','hidden','thickTop','thickBot','x14ac:dyDescent'].includes(k)))]}))}}
(async()=>{
 const specs=[['day','Акт за Июль.xlsx',0,15,23,42,21],['final','Акт об оказании услуг №22 Июль.xlsx',0,12,14,29,11],['registry','Реестр Июль.xlsx',0,14,37,43,11],['invoice','Счёт за Июль.xlsx',1,21,23,42,11]];
 const styles=[];const ids=new Map();const id=s=>{const key=JSON.stringify(s);if(!ids.has(key)){ids.set(key,styles.length);styles.push(s)}return ids.get(key)};const layouts={};
 for(const [kind,file,index,start,end,last,colCount] of specs){
  const w=await new ExcelJS.Workbook().xlsx.readFile(dir+'/'+file);const s=w.worksheets[index];const native=await xmlLayout(file,index);
  if (kind === 'invoice' && s.name !== '39 коп') throw new Error('Invoice reference must be sheet "39 коп"; check the specs sheet index.');
  const rows=[];for(let r=1;r<=last;r++){const row=s.getRow(r);rows.push({height:row.height??s.properties.defaultRowHeight,hidden:row.hidden,attributes:native.rowAttributes[r]??{},styles:Array.from({length:colCount},(_,c)=>id(row.getCell(c+1).style))})}
  const columns=Array.from({length:colCount},(_,i)=>{const c=s.getColumn(i+1);return {width:c.width,hidden:c.hidden,style:id(c.style)}});
  layouts[kind]={dataStart:start,dataEnd:end,properties:s.properties,columns,rows,merges:s.model.merges,pageSetup:s.pageSetup,views:s.views,normalFont:native.normalFont,sheetFormat:native.sheetFormat,pageAttributes:native.pageAttributes,bestFitColumns:native.bestFitColumns};
  console.log('Extracted layout:', kind);
 }
 const dayVariants=[]; const dayBook=await new ExcelJS.Workbook().xlsx.readFile(dir+"/Акт за Июль.xlsx");
 for(const [index,s] of dayBook.worksheets.entries()){
 const native=await xmlLayout('Акт за Июль.xlsx',index);
 const end=s.model.rows.find(r=>r.cells.some(c=>c.value==="ИТОГО:")).number-2;
 const rows=[];for(let r=1;r<=s.rowCount;r++){const row=s.getRow(r);rows.push({height:row.height??s.properties.defaultRowHeight,hidden:row.hidden,attributes:native.rowAttributes[r]??{},styles:Array.from({length:21},(_,c)=>id(row.getCell(c+1).style))})}
 dayVariants.push({dataEnd:end,rows,merges:s.model.merges,pageSetup:s.pageSetup,pageAttributes:native.pageAttributes});
 }
 const dest = process.argv[3] || path.join(__dirname, '../src/modules/documents/referenceLayouts.ts');
 fs.writeFileSync(dest,'// Formatting extracted from the supplied July reference workbooks.\n// Contains no cell values, formulas, personal details, or external paths.\nimport type { LayoutCatalog } from "./layout.js";\n\nexport const referenceLayouts = '+compactCatalog({styles,layouts,dayVariants})+' as unknown as LayoutCatalog;\n');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

function compactCatalog({ styles, layouts, dayVariants }) {
 const compact = JSON.stringify;
 return '{\n  styles: [\n' + styles.map(s => '    ' + compact(s)).join(',\n')
  + '\n  ],\n  layouts: {\n' + Object.entries(layouts).map(([key, value]) => '    ' + key + ': ' + compact(value)).join(',\n')
  + '\n  },\n  dayVariants: [\n' + dayVariants.map(v => '    ' + compact(v)).join(',\n')
  + '\n  ]\n}';
}
