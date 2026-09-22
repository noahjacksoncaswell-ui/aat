/**
 * Revision Directive v4.1 Section 8.1 - one-off data migration.
 *
 * The document category list was fully replaced (Range Safety Package, FTS
 * Documentation, LRR/FRR packages, Environmental/Permitting, Weather Waiver
 * Request, Post-Flight/Anomaly Report, Standard Operating Procedure, and
 * Checklist were all consolidated out of the list; Landowner Authorization
 * and Cert. of Waiver or Authorization picked up the "[PC]" suffix).
 * `Document.category` is a plain string column, not a database enum, so no
 * schema migration is required - but any existing row tagged with a
 * category no longer in the allowed list would otherwise be stuck showing
 * an unrecognized value in the category selector. This script re-maps
 * every such row to "Other" as a safe default.
 *
 * Run once against a database that has documents predating this revision:
 *   npx tsx scripts/remapDocumentCategories.ts
 *
 * Affected documents are logged to stdout so an Admin can manually
 * re-categorize them afterward if a more specific category applies.
 */
import { prisma } from "../src/lib/prisma";
import { DOCUMENT_CATEGORIES } from "./documentCategories";

async function main() {
  const stale = await prisma.document.findMany({
    where: { category: { notIn: DOCUMENT_CATEGORIES } },
    select: { id: true, title: true, category: true },
  });

  if (stale.length === 0) {
    console.log("No documents found with a category outside the current list. Nothing to do.");
    return;
  }

  console.log(`Re-mapping ${stale.length} document(s) to "Other":`);
  for (const doc of stale) {
    console.log(`  - ${doc.id}  "${doc.title}"  (was: "${doc.category}")`);
  }

  await prisma.document.updateMany({
    where: { id: { in: stale.map((d) => d.id) } },
    data: { category: "Other" },
  });

  console.log("Done. Review the documents listed above - an Admin may want to re-categorize some of them manually.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
