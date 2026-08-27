import { vi } from 'vitest';

vi.mock('./src/vrchat/client', () => ({
  fetchWorldData: vi.fn(),
  searchWorldsByName: vi.fn(),
  isCurrentUser: vi.fn(),
  ensureAuthenticated: vi.fn(),
  vrchat: {
    client: {}
  }
}));
