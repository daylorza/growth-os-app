import type { ValidationPipeOptions } from '@nestjs/common'

/** Unknown fields are rejected, not silently stored. */
export const VALIDATION: ValidationPipeOptions = { whitelist: true, forbidNonWhitelisted: true, transform: true }
