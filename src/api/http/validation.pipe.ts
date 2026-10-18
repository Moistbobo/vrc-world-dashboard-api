import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ValidationPipe,
  type ValidationError
} from '@nestjs/common';

function isBodyDto(metatype: unknown): metatype is { invalidMessage: string } {
  return (
    typeof metatype === 'function' &&
    typeof (metatype as { invalidMessage?: unknown }).invalidMessage ===
      'string'
  );
}

function firstMessage(errors: ValidationError[]): string | undefined {
  for (const error of errors) {
    const messages = error.constraints ? Object.values(error.constraints) : [];
    if (messages.length > 0) return messages[0];
    if (error.children && error.children.length > 0) {
      const nested = firstMessage(error.children);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Body validation for the migrated API. DTOs carry the exact pre-migration
 * message in a static `invalidMessage`; non-object bodies (which the old
 * `parse*Body` helpers rejected) are rejected with that same message before
 * class-validator runs.
 */
@Injectable()
export class ApiValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
      forbidUnknownValues: false,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException(firstMessage(errors) ?? 'Invalid body')
    });
  }

  async transform(
    value: unknown,
    metadata: ArgumentMetadata
  ): Promise<unknown> {
    if (isBodyDto(metadata.metatype)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new BadRequestException(metadata.metatype.invalidMessage);
      }
    }
    return super.transform(value, metadata);
  }
}
