import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface
} from 'class-validator';

// Every constraint carries the exact pre-migration message so class-validator
// failures render byte-for-byte like the old `parse*Body` helpers (decision d004).
export const ADD_WORLD_MESSAGE =
  'Invalid body. Expected { worldId, guildId, messageId, content }';
export const EXTRACT_MESSAGE = 'Invalid body. Expected { content }';
export const QUALITY_MESSAGE = 'Invalid body. Expected { quality }';
export const TAGS_MESSAGE = 'Invalid body. Expected { sourceContent }';
export const TAGS_EDIT_MESSAGE = 'Invalid body. Expected { tags }';
export const FLAGS_EDIT_MESSAGE = 'Invalid body. Expected { flags }';

const WORLD_ID_REGEX = /^wrld_[a-f0-9-]{36}$/;
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

@ValidatorConstraint({ name: 'isNullableString' })
class IsNullableString implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return value === null || typeof value === 'string';
  }
}

export class AddWorldBodyDto {
  static readonly invalidMessage = ADD_WORLD_MESSAGE;

  @Matches(WORLD_ID_REGEX, { message: ADD_WORLD_MESSAGE })
  worldId!: string;

  @IsString({ message: ADD_WORLD_MESSAGE })
  @Matches(/\S/, { message: ADD_WORLD_MESSAGE })
  guildId!: string;

  @Matches(SNOWFLAKE_REGEX, { message: ADD_WORLD_MESSAGE })
  messageId!: string;

  @IsString({ message: ADD_WORLD_MESSAGE })
  content!: string;

  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: ADD_WORLD_MESSAGE }
  )
  messageTimestamp?: number;

  @IsOptional()
  @IsBoolean({ message: ADD_WORLD_MESSAGE })
  checkDuplicate?: boolean;
}

export class ExtractWorldsBodyDto {
  static readonly invalidMessage = EXTRACT_MESSAGE;

  @IsString({ message: EXTRACT_MESSAGE })
  @Matches(/\S/, { message: EXTRACT_MESSAGE })
  content!: string;
}

export class UpdateQualityBodyDto {
  static readonly invalidMessage = QUALITY_MESSAGE;

  @IsIn(['good', 'bad', null], { message: QUALITY_MESSAGE })
  quality!: 'good' | 'bad' | null;

  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: QUALITY_MESSAGE }
  )
  messageTimestamp?: number;
}

export class UpdateTagsBodyDto {
  static readonly invalidMessage = TAGS_MESSAGE;

  @IsDefined({ message: TAGS_MESSAGE })
  @Validate(IsNullableString, { message: TAGS_MESSAGE })
  sourceContent!: string | null;

  @IsOptional()
  @IsString({ message: TAGS_MESSAGE })
  tagSource?: string;

  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: TAGS_MESSAGE }
  )
  messageTimestamp?: number;
}

export class UpdateTagsEditBodyDto {
  static readonly invalidMessage = TAGS_EDIT_MESSAGE;

  @IsArray({ message: TAGS_EDIT_MESSAGE })
  @IsString({ each: true, message: TAGS_EDIT_MESSAGE })
  tags!: string[];
}

export class UpdateFlagsEditBodyDto {
  static readonly invalidMessage = FLAGS_EDIT_MESSAGE;

  @IsArray({ message: FLAGS_EDIT_MESSAGE })
  @IsString({ each: true, message: FLAGS_EDIT_MESSAGE })
  flags!: string[];
}
