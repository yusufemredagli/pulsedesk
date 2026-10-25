import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
export const optional = (_object: unknown, value: unknown): boolean =>
  value !== undefined;
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const integer = ({ value }: { value: unknown }): unknown =>
  typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
export class PageQuery {
  @Transform(integer) @IsInt() @Min(1) @Max(10000) page: number = 1;
  @Transform(integer) @IsInt() @Min(1) @Max(100) limit: number = 20;
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  search?: string;
}
export function pagination(query: PageQuery, total: number) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}
export function searchText(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
