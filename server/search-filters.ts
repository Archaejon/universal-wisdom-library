// Shared SQL fragments for search. Both the local passage index and the
// streamed-text index join the same catalogue tables, so filters behave the
// same way in either engine.

export type SearchAlias = { f: string; p: string; w: string; t: string; s: string; e: string; so: string; li: string };

export function filterSql(params: URLSearchParams, alias: SearchAlias) {
  const clauses: string[] = [];
  const args: any[] = [];
  const add = (sql: string, val: any) => {
    clauses.push(sql);
    args.push(val);
  };
  if (params.get("tradition")) add(`${alias.t}.slug = ?`, params.get("tradition"));
  if (params.get("work")) add(`${alias.w}.slug = ?`, params.get("work"));
  if (params.get("school")) add(`${alias.s}.slug = ?`, params.get("school"));
  if (params.get("language")) add(`${alias.e}.language_code = ?`, params.get("language"));
  if (params.get("source")) add(`${alias.so}.slug = ?`, params.get("source"));
  if (params.get("license")) add(`${alias.li}.code = ?`, params.get("license"));
  const era = params.get("era");
  const ranges: Record<string, [number, number]> = { ancient: [-5000, 499], medieval: [500, 1499], modern: [1500, 2100] };
  if (era && ranges[era]) {
    add(`${alias.w}.date_start <= ?`, ranges[era][1]);
    add(`COALESCE(${alias.w}.date_end, ${alias.w}.date_start) >= ?`, ranges[era][0]);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", args };
}

export function baseJoins(alias: SearchAlias) {
  return `
    JOIN passages ${alias.p} ON ${alias.p}.id = ${alias.f}.passage_id
    JOIN works ${alias.w} ON ${alias.w}.id = ${alias.p}.work_id
    JOIN traditions ${alias.t} ON ${alias.t}.id = ${alias.w}.tradition_id
    LEFT JOIN schools ${alias.s} ON ${alias.s}.id = ${alias.w}.school_id
    JOIN editions ${alias.e} ON ${alias.e}.id = ${alias.f}.edition_id
    LEFT JOIN sources ${alias.so} ON ${alias.so}.id = ${alias.e}.source_id
    LEFT JOIN licenses ${alias.li} ON ${alias.li}.id = ${alias.e}.license_id`;
}
