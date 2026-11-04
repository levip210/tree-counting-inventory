/** Missing or unknown values stay on: the farm must list this size or grade. */
export function requireFarmOn(value: unknown): boolean {
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return true;
}

/**
 * Yard Receiving blocks a size+grade cell only when both still require the farm
 * to have that pair on starting inventory. Either Off skips the check.
 */
export function yardCellNeedsFarmList(sizeRequireFarm: unknown, gradeRequireFarm: unknown): boolean {
  return requireFarmOn(sizeRequireFarm) && requireFarmOn(gradeRequireFarm);
}
