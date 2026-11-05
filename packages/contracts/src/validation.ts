import { applyDecorators } from '@nestjs/common'
import { IsOptional, IsString, MaxLength } from 'class-validator'

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** Daily audits hang off a date instead of a content item. */
export const AUDIT_ID = /^AUDIT-\d{4}-\d{2}-\d{2}$/

export const OptionalText = (max = 5000) => applyDecorators(IsOptional(), IsString(), MaxLength(max))
export const RequiredText = (max = 5000) => applyDecorators(IsString(), MaxLength(max))
