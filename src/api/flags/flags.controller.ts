import { Controller, Get } from '@nestjs/common';
import { FlagRepository } from '../../db/flagRepository';
import { RequirePermission } from '../auth/require-permission.decorator';

interface FlagSummary {
  flag: string;
  count: number;
}

@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FlagRepository) {}

  @Get()
  @RequirePermission('tags:read')
  async list(): Promise<{ flags: FlagSummary[] }> {
    const [catalogFlags, countsByFlag] = await Promise.all([
      this.flags.getAll(),
      this.flags.countByFlag()
    ]);
    const counts = new Map(
      countsByFlag.map(({ flag, count }) => [flag, count])
    );
    const flags = Array.from(catalogFlags, (flag) => ({
      flag,
      count: counts.get(flag) ?? 0
    })).sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));
    return { flags };
  }
}
