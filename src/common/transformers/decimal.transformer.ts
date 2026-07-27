import { ValueTransformer } from 'typeorm';

/** Postgres `numeric` columns come back as strings; keep them numbers in JS. */
export class ColumnNumericTransformer implements ValueTransformer {
  to(value: number | null): number | null {
    return value;
  }

  from(value: string | null): number | null {
    return value === null ? null : parseFloat(value);
  }
}
