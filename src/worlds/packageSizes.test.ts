import type { MockedFunction } from 'vitest';
import {
  getFileIdFromAssetUrl,
  getMostRecentUnityPackageForPlatform,
  getRecentFileVersion,
  bytesToMegabytes,
  getPackageSizesInMb
} from './packageSizes';
import { getSupportedPlatforms } from './helpers';

vi.mock('../vrchat/client', () => ({
  vrchat: {
    client: {},
    getFile: vi.fn()
  }
}));

import { vrchat } from '../vrchat/client';

const asMock = <T extends (...args: any[]) => any>(fn: any) =>
  fn as MockedFunction<T>;

describe('getFileIdFromAssetUrl', () => {
  it('extracts the file id from an asset url', () => {
    expect(getFileIdFromAssetUrl('https://cdn/file_abcd-1234/asset')).toBe(
      'abcd-1234'
    );
  });

  it('returns null for missing or malformed urls', () => {
    expect(getFileIdFromAssetUrl('')).toBeNull();
    expect(getFileIdFromAssetUrl('https://cdn/plain')).toBeNull();
  });
});

describe('getMostRecentUnityPackageForPlatform', () => {
  it('returns the most recent package for the platform', () => {
    const data = {
      unityPackages: [
        { platform: 'android', created_at: '2023-01-01T00:00:00Z' },
        { platform: 'android', created_at: '2024-01-01T00:00:00Z' },
        { platform: 'standalonewindows', created_at: '2024-01-01T00:00:00Z' }
      ]
    } as never;

    const pkg = getMostRecentUnityPackageForPlatform(data as never, 'android');
    expect(pkg?.created_at).toBe('2024-01-01T00:00:00Z');
  });

  it('returns null when no packages for the platform', () => {
    const data = { unityPackages: [] } as never;
    expect(
      getMostRecentUnityPackageForPlatform(data as never, 'ios')
    ).toBeNull();
  });
});

describe('getRecentFileVersion', () => {
  it('returns the latest version by created_at', () => {
    const versions = [
      { created_at: '2023-01-01T00:00:00Z', file: { sizeInBytes: 1 } },
      { created_at: '2024-01-01T00:00:00Z', file: { sizeInBytes: 2 } }
    ] as never;

    const recent = getRecentFileVersion(versions as never);
    expect(recent?.file?.sizeInBytes).toBe(2);
  });

  it('returns undefined for an empty list', () => {
    expect(getRecentFileVersion([])).toBeUndefined();
  });
});

describe('bytesToMegabytes', () => {
  it('converts bytes to megabytes', () => {
    expect(bytesToMegabytes(1048576)).toBe(1);
    expect(bytesToMegabytes(524288)).toBe(0.5);
  });
});

describe('getPackageSizesInMb', () => {
  const WORLD = {
    unityPackages: [
      {
        platform: 'standalonewindows',
        created_at: '2024-01-01T00:00:00Z',
        assetUrl: 'https://cdn/file_aaaa-1111/asset'
      },
      {
        platform: 'android',
        created_at: '2024-01-01T00:00:00Z',
        assetUrl: 'https://cdn/file_bbbb-2222/asset'
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns MB sizes aligned with supported platforms', async () => {
    asMock(vrchat.getFile).mockImplementation(async () => ({
      data: {
        versions: [
          {
            created_at: '2024-02-01T00:00:00Z',
            file: { sizeInBytes: 10485760 }
          }
        ]
      }
    }));

    const sizes = await getPackageSizesInMb(WORLD as never);

    expect(getSupportedPlatforms(WORLD.unityPackages as never)).toEqual([
      'standalonewindows',
      'android'
    ]);
    expect(sizes).toEqual([10, 10]);
    expect(vrchat.getFile).toHaveBeenCalledTimes(2);
    expect(vrchat.getFile).toHaveBeenCalledWith({
      client: vrchat.client,
      path: { fileId: 'file_aaaa-1111' }
    });
    expect(vrchat.getFile).toHaveBeenCalledWith({
      client: vrchat.client,
      path: { fileId: 'file_bbbb-2222' }
    });
  });

  it('returns null when the asset url has no file id', async () => {
    const world = {
      unityPackages: [
        {
          platform: 'android',
          created_at: '2024-01-01T00:00:00Z',
          assetUrl: 'https://cdn/plain'
        }
      ]
    };

    const sizes = await getPackageSizesInMb(world as never);

    expect(sizes).toEqual([null]);
    expect(vrchat.getFile).not.toHaveBeenCalled();
  });

  it('returns null when the file has no sized version', async () => {
    asMock(vrchat.getFile).mockResolvedValue({
      data: { versions: [] }
    });

    const sizes = await getPackageSizesInMb(WORLD as never);

    expect(sizes).toEqual([null, null]);
  });

  it('returns nulls when getFile throws', async () => {
    asMock(vrchat.getFile).mockRejectedValue(new Error('rate limited'));

    const sizes = await getPackageSizesInMb(WORLD as never);

    expect(sizes).toEqual([null, null]);
  });
});
