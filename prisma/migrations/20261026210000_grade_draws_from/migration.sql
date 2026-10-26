-- Additive column. Does not rename grades and does not rewrite counts,
-- miscounts, or starting-inventory rows. Re-running the UPDATE is safe:
-- a link that is already set (including a later admin clear, once this
-- migration has been recorded) is not touched here. Prisma runs this file once.
ALTER TABLE "TreeGrade" ADD COLUMN "drawsFromGradeId" TEXT;

-- Point "Scale free" at the "#1" pile only when each name matches exactly one
-- grade and the link is still empty. Names are left as they are.
UPDATE "TreeGrade"
SET "drawsFromGradeId" = (
  SELECT "id" FROM "TreeGrade" WHERE "name" = '#1'
)
WHERE "name" = 'Scale free'
  AND "drawsFromGradeId" IS NULL
  AND (SELECT COUNT(*) FROM "TreeGrade" WHERE "name" = 'Scale free') = 1
  AND (SELECT COUNT(*) FROM "TreeGrade" WHERE "name" = '#1') = 1;
