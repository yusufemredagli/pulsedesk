import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';
import { PageQuery, optional } from '../../common/pagination.dto';
export class NotificationQuery extends PageQuery {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unread?: boolean;
}
