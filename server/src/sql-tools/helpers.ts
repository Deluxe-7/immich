import { createHash } from 'node:crypto';
import { ColumnValue } from 'src/sql-tools/decorators/column.decorator';
import { Comparer, DatabaseColumn, DatabaseOverride, IgnoreOptions, SchemaDiff } from 'src/sql-tools/types';

export const asMetadataKey = (name: string) => `sql-tools:${name}`;

export const asSnakeCase = (name: string): string => name.replaceAll(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
// match TypeORM
export const asKey = (prefix: string, tableName: string, values: string[]) =>
  (prefix + sha1(`${tableName}_${values.toSorted().join('_')}`)).slice(0, 30);

export const asOptions = <T extends { name?: string }>(options: string | T): T => {
  if (typeof options === 'string') {
    return { name: options } as T;
  }

  return options;
};

export const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

export const fromColumnValue = (columnValue?: ColumnValue) => {
  if (columnValue === undefined) {
    return;
  }

  if (typeof columnValue === 'function') {
    return columnValue() as string;
  }

  const value = columnValue;

  if (value === null) {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  return `'${String(value)}'`;
};

export const setIsEqual = (source: Set<unknown>, target: Set<unknown>) =>
  source.size === target.size && [...source].every((x) => target.has(x));

export const haveEqualColumns = (sourceColumns?: string[], targetColumns?: string[]) => {
  return setIsEqual(new Set(sourceColumns ?? []), new Set(targetColumns ?? []));
};

export const haveEqualOverrides = <T extends { override?: DatabaseOverride }>(source: T, target: T) => {
  if (!source.override || !target.override) {
    return false;
  }

  const sourceValue = source.override.value;
  const targetValue = target.override.value;

  return sourceValue.name === targetValue.name && sourceValue.sql === targetValue.sql;
};

export const compare = <T extends { name: string; synchronize: boolean }>(
  sources: T[],
  targets: T[],
  options: IgnoreOptions | undefined,
  comparer: Comparer<T>,
) => {
  options = options || {};
  const sourceMap = Object.fromEntries(sources.map((table) => [table.name, table]));
  const targetMap = Object.fromEntries(targets.map((table) => [table.name, table]));
  const items: SchemaDiff[] = [];

  const keys = new Set([...Object.keys(sourceMap), ...Object.keys(targetMap)]);
  for (const key of keys) {
    const source = sourceMap[key];
    const target = targetMap[key];

    if (isIgnored(source, target, options ?? true)) {
      continue;
    }

    if (isSynchronizeDisabled(source, target)) {
      continue;
    }

    if (source && !target) {
      items.push(...comparer.onMissing(source));
    } else if (!source && target) {
      items.push(...comparer.onExtra(target));
    } else {
      if (
        haveEqualOverrides(
          source as unknown as { override?: DatabaseOverride },
          target as unknown as { override?: DatabaseOverride },
        )
      ) {
        continue;
      }
      items.push(...comparer.onCompare(source, target));
    }
  }

  return items;
};

const isIgnored = (
  source: { synchronize?: boolean } | undefined,
  target: { synchronize?: boolean } | undefined,
  options: IgnoreOptions,
) => {
  if (typeof options === 'boolean') {
    return !options;
  }
  return (options.ignoreExtra && !source) || (options.ignoreMissing && !target);
};

const isSynchronizeDisabled = (source?: { synchronize?: boolean }, target?: { synchronize?: boolean }) => {
  return source?.synchronize === false || target?.synchronize === false;
};

export const isDefaultEqual = (source: DatabaseColumn, target: DatabaseColumn) => {
  if (source.default === target.default) {
    return true;
  }

  if (source.default === undefined || target.default === undefined) {
    return false;
  }

  if (
    withTypeCast(source.default, getColumnType(source)) === target.default ||
    source.default === withTypeCast(target.default, getColumnType(target))
  ) {
    return true;
  }

  return false;
};

export const getColumnType = (column: DatabaseColumn) => {
  let type = column.enumName || column.type;
  if (column.isArray) {
    type += `[${column.length ?? ''}]`;
  } else if (column.length !== undefined) {
    type += `(${column.length})`;
  }

  return type;
};

const withTypeCast = (value: string, type: string) => {
  if (!value.startsWith(`'`)) {
    value = `'${value}'`;
  }
  return `${value}::${type}`;
};

export const getColumnModifiers = (column: DatabaseColumn) => {
  const modifiers: string[] = [];

  if (!column.nullable) {
    modifiers.push('NOT NULL');
  }

  if (column.default) {
    modifiers.push(`DEFAULT ${column.default}`);
  }
  if (column.identity) {
    modifiers.push(`GENERATED ALWAYS AS IDENTITY`);
  }

  return modifiers.length === 0 ? '' : ' ' + modifiers.join(' ');
};

export const asColumnComment = (tableName: string, columnName: string, comment: string): string => {
  return `COMMENT ON COLUMN "${tableName}"."${columnName}" IS '${comment}';`;
};

export const asColumnList = (columns: string[]) => columns.map((column) => `"${column}"`).join(', ');

export const asForeignKeyConstraintName = (table: string, columns: string[]) => asKey('FK_', table, [...columns]);

export const asJsonString = (value: unknown): string => {
  return `'${escape(JSON.stringify(value))}'::jsonb`;
};

const escape = (value: string) => {
  return value
    .replaceAll("'", "''")
    .replaceAll(/[\\]/g, '\\\\')
    .replaceAll(/[\b]/g, String.raw`\b`)
    .replaceAll(/[\f]/g, String.raw`\f`)
    .replaceAll(/[\n]/g, String.raw`\n`)
    .replaceAll(/[\r]/g, String.raw`\r`)
    .replaceAll(/[\t]/g, String.raw`\t`);
};
