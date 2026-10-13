//! Shared, credential-redacted object access for metadata and private previews.
use crate::{db::cache_scope::CacheConfig, providers::s3_client::create_s3_client};
use aws_sdk_s3::Client;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
pub struct ObjectConfigInput {
    pub provider: String,
    pub account_id: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: Option<String>,
    pub endpoint_scheme: Option<String>,
    pub endpoint_host: Option<String>,
    pub force_path_style: Option<bool>,
}

impl ObjectConfigInput {
    pub fn cache_config(&self) -> CacheConfig {
        CacheConfig {
            provider: self.provider.clone(),
            account_id: self.account_id.clone(),
            access_key_id: self.access_key_id.clone(),
            secret_access_key: self.secret_access_key.clone(),
            region: self.region.clone(),
            endpoint_scheme: self.endpoint_scheme.clone(),
            endpoint_host: self.endpoint_host.clone(),
            force_path_style: self.provider == "rustfs"
                || self.force_path_style.unwrap_or(self.provider != "aws"),
        }
    }

    pub fn client(&self) -> Result<Client, String> {
        if self.bucket.is_empty()
            || self.access_key_id.is_empty()
            || self.secret_access_key.is_empty()
        {
            return Err("Bucket and S3 access credentials are required".into());
        }
        let region = match self.provider.as_str() {
            "r2" if !self.account_id.is_empty() => "auto",
            "aws" => self
                .region
                .as_deref()
                .filter(|v| !v.is_empty())
                .ok_or("AWS region is required")?,
            "minio" | "rustfs" => "us-east-1",
            _ => return Err("Unsupported provider or missing R2 account ID".into()),
        };
        let endpoint = if self.provider == "r2" {
            Some(format!(
                "https://{}.r2.cloudflarestorage.com",
                self.account_id
            ))
        } else {
            self.endpoint_host
                .as_deref()
                .filter(|v| !v.is_empty())
                .map(|host| {
                    format!(
                        "{}://{}",
                        self.endpoint_scheme.as_deref().unwrap_or("https"),
                        host
                    )
                })
        };
        if matches!(self.provider.as_str(), "minio" | "rustfs") && endpoint.is_none() {
            return Err("Storage endpoint is required".into());
        }
        create_s3_client(&crate::providers::s3_client::S3ClientConfig {
            access_key_id: &self.access_key_id,
            secret_access_key: &self.secret_access_key,
            region,
            endpoint_url: endpoint.as_deref(),
            force_path_style: self.cache_config().force_path_style,
        })
        .map_err(|e| e.to_string())
    }

    pub fn identity(&self, key: &str) -> Result<String, String> {
        Ok(format!(
            "{}:{}:{}",
            self.cache_config()
                .fingerprint()
                .map_err(|e| e.to_string())?,
            self.bucket,
            key
        ))
    }
}

pub fn validate_signed_url_lifetime(seconds: u64) -> Result<(), String> {
    if !(1..=604_800).contains(&seconds) {
        return Err("Signed URL lifetime must be between 1 and 604800 seconds".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_url_lifetime_has_no_invalid_boundary() {
        for value in [1, 900, 3600, 86400, 604800] {
            assert!(validate_signed_url_lifetime(value).is_ok());
        }
        for value in [0, 604801, u64::MAX] {
            assert!(validate_signed_url_lifetime(value).is_err());
        }
    }
}
