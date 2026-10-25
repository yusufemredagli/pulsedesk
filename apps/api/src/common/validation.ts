import { BadRequestException, type Type, ValidationPipe } from '@nestjs/common';
export function validationFor(expectedType?: Type<object>): ValidationPipe {
  return new ValidationPipe({
    expectedType,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
    exceptionFactory: () => new BadRequestException('Invalid request body'),
  });
}
