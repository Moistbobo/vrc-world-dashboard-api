import { Router } from 'express';
import { getWorldRepository } from '../../db/worldRepository';
import { getHighPriorityRepository } from '../../db/highPriorityRepository';
import { addWorld, WorldServiceError } from '../../worlds/service';
import { extractAllWorldIdsFromMessage } from '../../extraction/pipeline';
import { extractTags, validateTags } from '../../tags/extractor';
import { sanitizeRecord } from '../utils/sanitize';
import {
  parseAddWorldBody,
  parseExtractWorldsBody,
  parseGuildIdBody,
  parseUpdateQualityBody,
  parseUpdateTagsBody,
  parseUpdateTagsEditBody
} from '../utils/validation';
import { requirePermission, type TokenRequest } from '../middleware/auth';

const router = Router();

// POST /api/worlds/extract — resolve world IDs from message content
// (direct links, Twitter/X links, plain-text world names)
router.post(
  '/api/worlds/extract',
  requirePermission('worlds:read'),
  async (request, response) => {
    const body = parseExtractWorldsBody(request.body);
    if (!body) {
      return response
        .status(400)
        .send({ error: 'Invalid body. Expected { content }' });
    }

    try {
      const worlds = await extractAllWorldIdsFromMessage(body.content);
      response.send({ worlds });
    } catch {
      response
        .status(502)
        .send({ error: 'Failed to extract worlds from content' });
    }
  }
);

// POST /api/worlds
router.post(
  '/api/worlds',
  requirePermission('worlds:write'),
  async (request, response) => {
    const body = parseAddWorldBody(request.body);
    if (!body) {
      return response.status(400).send({
        error: 'Invalid body. Expected { worldId, guildId, messageId, content }'
      });
    }

    try {
      const result = await addWorld(body);
      if (result.status === 'duplicate') {
        return response.status(200).send({
          duplicate: true,
          existingMessageId: result.existingMessageId,
          world: sanitizeRecord(result.world, { includeQuality: true })
        });
      }
      return response.status(201).send({
        duplicate: false,
        world: result.world
      });
    } catch (error) {
      if (error instanceof WorldServiceError) {
        return response.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  }
);

// DELETE /api/worlds/:worldId
router.delete(
  '/api/worlds/:worldId',
  requirePermission('worlds:write'),
  (request, response) => {
    const { worldId } = request.params as { worldId: string };
    const body = parseGuildIdBody(request.body);
    if (!body) {
      return response
        .status(400)
        .send({ error: 'Invalid body. Expected { guildId }' });
    }

    const deleted = getWorldRepository().deleteByWorldAndGuild(
      worldId,
      body.guildId
    );
    if (!deleted) {
      return response.status(404).send({ error: 'World not found' });
    }
    response.status(204).end();
  }
);

// PUT /api/worlds/:worldId/quality
router.put(
  '/api/worlds/:worldId/quality',
  requirePermission('worlds:write'),
  (request, response) => {
    const { worldId } = request.params as { worldId: string };
    const body = parseUpdateQualityBody(request.body);
    if (!body) {
      return response
        .status(400)
        .send({ error: 'Invalid body. Expected { guildId, quality }' });
    }

    const repo = getWorldRepository();
    const exists = repo.getByWorldAndGuild(worldId, body.guildId);
    if (!exists) {
      return response.status(404).send({ error: 'World not found' });
    }

    const updated = repo.updateQuality(worldId, body.guildId, body.quality);
    response.send({ updated });
  }
);

// PUT /api/worlds/:worldId/tags
router.put(
  '/api/worlds/:worldId/tags',
  requirePermission('worlds:write'),
  (request, response) => {
    const { worldId } = request.params as { worldId: string };
    const body = parseUpdateTagsBody(request.body);
    if (!body) {
      return response.status(400).send({
        error: 'Invalid body. Expected { guildId, sourceContent }'
      });
    }

    const repo = getWorldRepository();
    const exists = repo.getByWorldAndGuild(worldId, body.guildId);
    if (!exists) {
      return response.status(404).send({ error: 'World not found' });
    }

    const tags = extractTags(body.tagSource ?? body.sourceContent ?? '');
    const updated = repo.updateTags(
      worldId,
      body.guildId,
      tags,
      body.sourceContent
    );
    response.send({ updated, tags });
  }
);

// PUT /api/worlds/:worldId/tags/edit
router.put(
  '/api/worlds/:worldId/tags/edit',
  requirePermission('tags:write'),
  (request, response) => {
    const { worldId } = request.params as { worldId: string };
    const body = parseUpdateTagsEditBody(request.body);
    if (!body) {
      return response.status(400).send({
        error: 'Invalid body. Expected { guildId, tags }'
      });
    }

    const repo = getWorldRepository();
    const exists = repo.getByWorldAndGuild(worldId, body.guildId);
    if (!exists) {
      return response.status(404).send({ error: 'World not found' });
    }

    const { valid, invalid } = validateTags(body.tags);
    if (invalid.length > 0) {
      return response.status(400).send({
        error: `Invalid tags: ${invalid.join(', ')}`
      });
    }

    const updated = repo.updateTagsOnly(worldId, body.guildId, valid);
    response.send({ updated, tags: valid });
  }
);

// PUT /api/worlds/:worldId/high-priority
router.put(
  '/api/worlds/:worldId/high-priority',
  requirePermission('worlds:write'),
  (request: TokenRequest, response) => {
    const { worldId } = request.params as { worldId: string };
    const body = parseGuildIdBody(request.body);
    if (!body) {
      return response
        .status(400)
        .send({ error: 'Invalid body. Expected { guildId }' });
    }

    const repo = getWorldRepository();
    const exists = repo.getByWorldAndGuild(worldId, body.guildId);
    if (!exists) {
      return response.status(404).send({ error: 'World not found' });
    }

    const { added } = getHighPriorityRepository().add(
      worldId,
      body.guildId,
      request.token?.id
    );
    response.send({ added });
  }
);

// DELETE /api/worlds/:worldId/high-priority
router.delete(
  '/api/worlds/:worldId/high-priority',
  requirePermission('worlds:write'),
  (request, response) => {
    const { worldId } = request.params as { worldId: string };
    const body = parseGuildIdBody(request.body);
    if (!body) {
      return response
        .status(400)
        .send({ error: 'Invalid body. Expected { guildId }' });
    }

    const repo = getWorldRepository();
    const exists = repo.getByWorldAndGuild(worldId, body.guildId);
    if (!exists) {
      return response.status(404).send({ error: 'World not found' });
    }

    const { removed } = getHighPriorityRepository().remove(
      worldId,
      body.guildId
    );
    response.send({ removed });
  }
);

export default router;
