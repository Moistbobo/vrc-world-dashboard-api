import { FileVersion, UnityPackage, World } from 'vrchat';
import { getSupportedPlatforms } from './helpers';
import { vrchat } from '../vrchat/client';

export function getFileIdFromAssetUrl(assetUrl: string): string | null {
  if (!assetUrl) return null;
  const match = assetUrl.match(/file_([a-f0-9-]+)/);
  return match?.[1] ?? null;
}

export function getMostRecentUnityPackageForPlatform(
  data: World,
  platform: string
): UnityPackage | null {
  const filteredPackages = (data.unityPackages ?? []).filter(
    (pkg) => pkg.platform === platform
  );

  if (filteredPackages.length === 0) {
    return null;
  }

  filteredPackages.sort(
    (a, b) =>
      new Date(b.created_at ?? 0).getTime() -
      new Date(a.created_at ?? 0).getTime()
  );

  return filteredPackages[0];
}

export function getRecentFileVersion(
  versions: Array<FileVersion>
): FileVersion | undefined {
  if (versions.length === 0) return undefined;
  const sortedVersions = versions.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return sortedVersions[0];
}

export function bytesToMegabytes(bytes: number): number {
  return bytes / 1048576; // 1 MB = 1048576 bytes
}

/**
 * Computes the download size in MB for each supported platform, aligned
 * 1:1 with the order of `getSupportedPlatforms`. A platform whose file
 * size cannot be determined yields `null`.
 */
export async function getPackageSizesInMb(
  data: World
): Promise<(number | null)[]> {
  const platforms = getSupportedPlatforms(data.unityPackages ?? []);

  const sizes = await Promise.all(
    platforms.map(async (platform) => {
      try {
        const recentPackage = getMostRecentUnityPackageForPlatform(
          data,
          platform
        );
        if (!recentPackage) return null;

        const fileId = getFileIdFromAssetUrl(recentPackage.assetUrl ?? '');
        if (!fileId) return null;

        const { data: file } = await vrchat.getFile({
          client: vrchat.client,
          path: { fileId: `file_${fileId}` }
        });

        if (!file) return null;

        const mostRecentVersion = getRecentFileVersion(file.versions);
        if (!mostRecentVersion?.file?.sizeInBytes) return null;

        return bytesToMegabytes(mostRecentVersion.file.sizeInBytes);
      } catch {
        return null;
      }
    })
  );

  return sizes;
}
