import { Controller, Get } from '@nestjs/common';
import { WorldRepository } from '../../db/worldRepository';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly worlds: WorldRepository) {}

  @Public()
  @Get()
  async getHealth(): Promise<{
    status: string;
    worldCount: number;
    dbVersion: number;
  }> {
    const count = await this.worlds.count();
    return { status: 'ok', worldCount: count, dbVersion: 1 };
  }
}
