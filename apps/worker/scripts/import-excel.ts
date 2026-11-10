// npm run import-excel -- ../../ZeroPressure_Retention.xlsm > import.sql   (counts go to stderr)
import ExcelJS from "exceljs";
import { buildImportSql, type ImportInput } from "../src/importSql";

type Cell = ImportInput["training"][number][number];

function rows(ws: ExcelJS.Worksheet | undefined, width: number): Cell[][] {
  if (!ws) throw new Error("Tabellenblatt fehlt.");
  const out: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    out.push(Array.from({ length: width }, (_, i) => {
      let v = row.getCell(i + 1).value as unknown; // formula cells: cached result
      if (v && typeof v === "object" && !(v instanceof Date) && "result" in v) v = (v as { result: unknown }).result;
      return v instanceof Date || typeof v === "number" || typeof v === "string" ? v : null;
    }));
  });
  return out;
}

const path = process.argv[2];
if (!path) {
  console.error("usage: import-excel <workbook.xlsm>");
  process.exit(1);
}
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const r = buildImportSql({ training: rows(wb.getWorksheet("Trainingseinheiten"), 11), probe: rows(wb.getWorksheet("Probetrainings"), 8) });
process.stdout.write(r.sql);
console.error(`days=${r.days} skipped=${r.skipped} trials=${r.trials} members=${r.members}`);
