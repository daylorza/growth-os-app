import { Controller, Get, Injectable, Module } from '@nestjs/common'
import { buildOpenApi } from '@growth-os/contracts'

/** Serves the contract spec generated from @growth-os/contracts (the same document committed as openapi.json). */
@Injectable()
export class OpenApiService {
  private readonly doc = buildOpenApi()

  get() {
    return this.doc
  }
}

@Controller('api/openapi.json')
export class OpenApiController {
  constructor(private readonly openapi: OpenApiService) {}

  @Get()
  get() {
    return this.openapi.get()
  }
}

@Module({ controllers: [OpenApiController], providers: [OpenApiService] })
export class OpenApiModule {}
