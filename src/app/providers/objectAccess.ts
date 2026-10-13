import { invoke } from '@tauri-apps/api/core';
import type { MetadataChanges, ObjectMetadata, StorageConfig } from './types';
export function toObjectConfig(config: StorageConfig) {
  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey)
    throw new Error('Bucket and S3 access credentials are required');
  return {
    provider: config.provider,
    account_id: config.accountId,
    bucket: config.bucket,
    access_key_id: config.accessKeyId,
    secret_access_key: config.secretAccessKey,
    region: config.provider === 'aws' ? config.region : null,
    endpoint_scheme: config.provider !== 'r2' ? config.endpointScheme : null,
    endpoint_host: config.provider !== 'r2' ? config.endpointHost : null,
    force_path_style:
      config.provider === 'rustfs' || config.provider === 'r2' ? true : config.forcePathStyle,
  };
}
export const objectMetadataOperations = {
  getObjectMetadata: (config: StorageConfig, key: string) =>
    invoke<ObjectMetadata>('get_object_metadata', { config: toObjectConfig(config), key }),
  updateObjectMetadata: (
    config: StorageConfig,
    key: string,
    baseline: ObjectMetadata,
    changes: MetadataChanges
  ) =>
    invoke<ObjectMetadata>('update_object_metadata', {
      config: toObjectConfig(config),
      key,
      baseline,
      changes,
    }),
};
