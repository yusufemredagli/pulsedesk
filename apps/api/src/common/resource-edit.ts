import { ConflictException } from '@nestjs/common';
import { IsISO8601, ValidateIf } from 'class-validator';
import { optional } from './pagination.dto';
export class ResourceVersionDto {
  @ValidateIf(optional) @IsISO8601({ strict: true }) expectedUpdatedAt?: string;
}
export function nextUpdatedAt(current: Date, expected?: string): Date {
  if (
    expected !== undefined &&
    new Date(expected).getTime() !== current.getTime()
  )
    throw new ConflictException();
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}
