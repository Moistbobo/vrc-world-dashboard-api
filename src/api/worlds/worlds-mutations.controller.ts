import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
  Res
} from '@nestjs/common';
import type { Response } from 'express';
import { WorldRepository } from '../../db/worldRepository';
import { FlagRepository } from '../../db/flagRepository';
import { HighPriorityRepository } from '../../db/highPriorityRepository';
import type { ApiTokenRecord } from '../../db/tokenRepository';
import { addWorld, WorldServiceError } from '../../worlds/service';
import { extractAllWorldIdsFromMessage } from '../../extraction/pipeline';
import { extractTags, validateTags } from '../../tags/extractor';
import { validateFlags } from '../../flags/taxonomy';
import { sanitizeRecord } from '../utils/sanitize';
import { CurrentToken } from '../auth/current-token.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import {
  AddWorldBodyDto,
  ExtractWorldsBodyDto,
  UpdateFlagsEditBodyDto,
  UpdateQualityBodyDto,
  UpdateTagsBodyDto,
  UpdateTagsEditBodyDto
} from './dto';

@Controller('worlds')
export class WorldsMutationsController {
  constructor(
    private readonly worlds: WorldRepository,
    private readonly flags: FlagRepository,
    private readonly highPriority: HighPriorityRepository
  ) {}

  @Post('extract')
  @HttpCode(200)
  @RequirePermission('worlds:read')
  async extract(@Body() body: ExtractWorldsBodyDto) {
    try {
      const worlds = await extractAllWorldIdsFromMessage(body.content);
      return { worlds };
    } catch {
      throw new HttpException('Failed to extract worlds from content', 502);
    }
  }

  @Post()
  @RequirePermission('worlds:write')
  async add(
    @Body() body: AddWorldBodyDto,
    @CurrentToken() token: ApiTokenRecord,
    @Res() response: Response
  ): Promise<void> {
    try {
      const result = await addWorld({
        worldId: body.worldId,
        guildId: body.guildId,
        messageId: body.messageId,
        content: body.content,
        messageTimestamp: body.messageTimestamp,
        checkDuplicate: body.checkDuplicate,
        addedByTokenId: token?.id
      });
      if (result.status === 'duplicate') {
        response.status(200).send({
          duplicate: true,
          existingMessageId: result.existingMessageId,
          world: sanitizeRecord(result.world, { includeQuality: true })
        });
        return;
      }
      response.status(201).send({
        duplicate: false,
        world: result.world
      });
    } catch (error) {
      if (error instanceof WorldServiceError) {
        throw new HttpException(error.message, error.statusCode);
      }
      throw error;
    }
  }

  @Delete(':worldId')
  @HttpCode(204)
  @RequirePermission('worlds:write')
  async remove(@Param('worldId') worldId: string): Promise<void> {
    const result = await this.worlds.deleteByWorldId(worldId);
    if (result.status === 'notFound') {
      throw new NotFoundException('World not found');
    }
  }

  @Put(':worldId/quality')
  @RequirePermission('worlds:write')
  async updateQuality(
    @Param('worldId') worldId: string,
    @Body() body: UpdateQualityBodyDto
  ) {
    const result = await this.worlds.updateQuality(worldId, body.quality);
    if (result.status === 'notFound') {
      throw new NotFoundException('World not found');
    }
    return { updated: result.updated };
  }

  @Put(':worldId/tags')
  @RequirePermission('worlds:write')
  async updateTags(
    @Param('worldId') worldId: string,
    @Body() body: UpdateTagsBodyDto,
    @CurrentToken() token: ApiTokenRecord
  ) {
    const tags = extractTags(body.tagSource ?? body.sourceContent ?? '');
    const result = await this.worlds.updateTags(
      worldId,
      tags,
      body.sourceContent,
      token?.id
    );
    if (result.status === 'notFound') {
      throw new NotFoundException('World not found');
    }
    return { updated: result.updated, tags };
  }

  @Put(':worldId/tags/edit')
  @RequirePermission('tags:write')
  async updateTagsEdit(
    @Param('worldId') worldId: string,
    @Body() body: UpdateTagsEditBodyDto,
    @CurrentToken() token: ApiTokenRecord
  ) {
    const { valid, invalid } = validateTags(body.tags);
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid tags: ${invalid.join(', ')}`);
    }

    const result = await this.worlds.updateTagsOnly(worldId, valid, token?.id);
    if (result.status === 'notFound') {
      throw new NotFoundException('World not found');
    }
    return { updated: result.updated, tags: valid };
  }

  @Put(':worldId/flags/edit')
  @RequirePermission('tags:write')
  async updateFlagsEdit(
    @Param('worldId') worldId: string,
    @Body() body: UpdateFlagsEditBodyDto,
    @CurrentToken() token: ApiTokenRecord
  ) {
    const { valid, invalid } = validateFlags(body.flags);
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid flags: ${invalid.join(', ')}`);
    }

    const result = await this.flags.replaceWorldFlags(
      worldId,
      valid,
      token?.id
    );
    if (result.status === 'notFound') {
      throw new NotFoundException('World not found');
    }
    return { updated: result.updated, flags: valid };
  }

  @Put(':worldId/high-priority')
  @RequirePermission('worlds:write')
  async addHighPriority(
    @Param('worldId') worldId: string,
    @CurrentToken() token: ApiTokenRecord
  ) {
    const result = await this.highPriority.add(worldId, token?.id);
    if (result.status === 'notFound') {
      throw new NotFoundException('World not found');
    }
    return { added: result.added };
  }

  @Delete(':worldId/high-priority')
  @RequirePermission('worlds:write')
  async removeHighPriority(@Param('worldId') worldId: string) {
    const result = await this.highPriority.remove(worldId);
    if (result.status === 'notFound') {
      throw new NotFoundException('World not found');
    }
    return { removed: result.removed };
  }
}
