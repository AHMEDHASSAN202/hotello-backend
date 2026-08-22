import { EntityManager, IsNull } from 'typeorm';
import { DEFAULT_REQUEST_CATALOG } from './default-request-catalog';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';

export interface RequestCatalogSeedResult {
  createdCategories: number;
  updatedCategories: number;
  createdItems: number;
  updatedItems: number;
}

/**
 * Epic 15, Story 15.1 AC1 — idempotent platform catalog seed. Upserts the
 * shared (hotelId IS NULL) rows by key: creation on first run, field
 * refresh on later runs — THE propagation path for platform translation
 * fixes (recorded spec-note-1 decision). Never touches custom hotel items
 * or per-hotel settings, so hotel curation survives every re-seed.
 *
 * Platform-global (not per hotel): a new hotel needs zero rows to see the
 * full catalog, so — deliberately — there is nothing to hook into
 * onboarding. Runs from `npm run seed`.
 */
export async function seedRequestCatalog(
  manager: EntityManager,
): Promise<RequestCatalogSeedResult> {
  const categoriesRepo = manager.getRepository(RequestCategory);
  const itemsRepo = manager.getRepository(RequestItem);
  const result: RequestCatalogSeedResult = {
    createdCategories: 0,
    updatedCategories: 0,
    createdItems: 0,
    updatedItems: 0,
  };

  for (const [categoryIndex, def] of DEFAULT_REQUEST_CATALOG.entries()) {
    let category = await categoriesRepo.findOne({ where: { key: def.key } });
    const categoryFields = {
      icon: def.icon,
      names: def.names,
      sortOrder: categoryIndex,
    };
    if (!category) {
      category = await categoriesRepo.save(
        categoriesRepo.create({ key: def.key, ...categoryFields }),
      );
      result.createdCategories += 1;
    } else if (differs(category, categoryFields)) {
      Object.assign(category, categoryFields);
      category = await categoriesRepo.save(category);
      result.updatedCategories += 1;
    }

    for (const [itemIndex, itemDef] of def.items.entries()) {
      const existing = await itemsRepo.findOne({
        where: { categoryId: category.id, key: itemDef.key, hotelId: IsNull() },
      });
      const itemFields = {
        icon: itemDef.icon,
        names: itemDef.names,
        descriptions: itemDef.descriptions,
        optionType: itemDef.optionType ?? null,
        optionMin: itemDef.optionMin ?? null,
        optionMax: itemDef.optionMax ?? null,
        defaultSlaMinutes: itemDef.defaultSlaMinutes,
        sortOrder: itemIndex,
      };
      if (!existing) {
        await itemsRepo.save(
          itemsRepo.create({
            categoryId: category.id,
            hotelId: null,
            key: itemDef.key,
            isActive: true,
            ...itemFields,
          }),
        );
        result.createdItems += 1;
      } else if (differs(existing, itemFields)) {
        Object.assign(existing, itemFields);
        await itemsRepo.save(existing);
        result.updatedItems += 1;
      }
    }
  }
  return result;
}

/**
 * Shallow-compare candidate fields against the stored row. JSONB values come
 * back from Postgres with re-ordered keys, so the comparison stringifies
 * with sorted keys — otherwise every seed run would report drift.
 */
function differs(row: object, fields: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(fields).some(
    ([key, value]) => stableStringify(record[key]) !== stableStringify(value),
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
