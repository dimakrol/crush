import { PipeTransform, Injectable } from '@nestjs/common'
import { ZodSchema } from 'zod'
import { AppError } from '../errors/AppError'
import { ErrorCode } from '../errors/error-codes'

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, messages)
    }
    return result.data
  }
}
