//! Metadata-only, conditional self-copy. Bodies never pass through the app.
use crate::object_access::ObjectConfigInput;
use aws_sdk_s3::{
    error::ProvideErrorMetadata,
    operation::head_object::HeadObjectOutput,
    primitives::{DateTime, DateTimeFormat},
    types::{MetadataDirective, TaggingDirective},
    Client,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use tauri::Manager;

pub const METADATA_COPY_LIMIT: u64 = 5 * 1024 * 1024 * 1024;
const HEADERS: [&str; 6] = [
    "Content-Type",
    "Cache-Control",
    "Content-Disposition",
    "Content-Encoding",
    "Content-Language",
    "Expires",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ObjectMetadata {
    pub headers: BTreeMap<String, Option<String>>,
    pub custom_metadata: BTreeMap<String, String>,
    pub size: u64,
    pub etag: String,
    pub last_modified: Option<String>,
    pub storage_class: String,
    pub missing_metadata: i32,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetadataChanges {
    #[serde(default)]
    pub headers: BTreeMap<String, Option<String>>,
    #[serde(default)]
    pub custom_metadata: BTreeMap<String, Option<String>>,
}

fn date(value: &DateTime) -> Option<String> {
    value.fmt(DateTimeFormat::DateTime).ok()
}

fn snapshot(head: &HeadObjectOutput) -> ObjectMetadata {
    let values = [
        head.content_type(),
        head.cache_control(),
        head.content_disposition(),
        head.content_encoding(),
        head.content_language(),
    ];
    let mut headers: BTreeMap<String, Option<String>> = HEADERS[..5]
        .iter()
        .zip(values)
        .map(|(name, value)| ((*name).into(), value.map(str::to_string)))
        .collect();
    headers.insert("Expires".into(), head.expires_string().map(str::to_string));
    ObjectMetadata {
        headers,
        custom_metadata: head
            .metadata()
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), decode_value(v)))
            .collect(),
        size: head.content_length().unwrap_or(0).max(0) as u64,
        etag: head.e_tag().unwrap_or_default().into(),
        last_modified: head.last_modified().and_then(date),
        storage_class: head
            .storage_class()
            .map_or("STANDARD", |v| v.as_str())
            .into(),
        missing_metadata: head.missing_meta().unwrap_or(0),
    }
}

fn decode_value(value: &str) -> String {
    if let Some(encoded) = value
        .strip_prefix("=?UTF-8?B?")
        .or_else(|| value.strip_prefix("=?utf-8?B?"))
        .and_then(|v| v.strip_suffix("?="))
    {
        if let Ok(bytes) = STANDARD.decode(encoded) {
            if let Ok(decoded) = String::from_utf8(bytes) {
                return decoded;
            }
        }
    }
    value.into()
}
fn encode_value(value: &str) -> String {
    if value.is_ascii() {
        value.into()
    } else {
        format!("=?UTF-8?B?{}?=", STANDARD.encode(value.as_bytes()))
    }
}

fn apply_changes(
    current: &ObjectMetadata,
    changes: &MetadataChanges,
    provider: &str,
) -> Result<ObjectMetadata, String> {
    if current.size > METADATA_COPY_LIMIT {
        return Err("Metadata editing is limited to objects up to 5 GiB".into());
    }
    if current.missing_metadata > 0 {
        return Err("Some metadata is omitted by the S3 API; replacement would lose it".into());
    }
    if current.etag.is_empty() {
        return Err("Cannot safely update metadata without an ETag".into());
    }
    let mut desired = current.clone();
    for (key, value) in &changes.headers {
        if !HEADERS.contains(&key.as_str()) {
            return Err(format!("Unsupported metadata header: {key}"));
        }
        if let Some(value) = value {
            if !value.is_ascii() || value.bytes().any(|v| v < 32 || v == 127) {
                return Err("HTTP metadata headers must contain printable ASCII characters".into());
            }
        }
        let value = if key == "Expires" {
            value
                .as_deref()
                .map(|value| {
                    DateTime::from_str(value, DateTimeFormat::HttpDate)
                        .or_else(|_| DateTime::from_str(value, DateTimeFormat::DateTime))
                        .map_err(|_| {
                            "Expires must be an HTTP date or ISO 8601 timestamp".to_string()
                        })?
                        .fmt(DateTimeFormat::HttpDate)
                        .map_err(|_| "Invalid Expires date".to_string())
                })
                .transpose()?
        } else {
            value.clone()
        };
        let value = if key == "Content-Type" && value.is_none() {
            Some("application/octet-stream".into())
        } else {
            value
        };
        desired.headers.insert(key.clone(), value);
    }
    for (key, value) in &changes.custom_metadata {
        if key.is_empty()
            || key.starts_with("x-amz-meta-")
            || !key.bytes().all(|v| {
                v.is_ascii_lowercase() || v.is_ascii_digit() || b"!#$%&'*+-.^_`|~".contains(&v)
            })
        {
            return Err(
                "Custom metadata keys must be lowercase HTTP tokens without x-amz-meta-".into(),
            );
        }
        if let Some(value) = value {
            if value.chars().any(char::is_control) {
                return Err("Custom metadata cannot contain control characters".into());
            }
            desired.custom_metadata.insert(key.clone(), value.clone());
        } else {
            desired.custom_metadata.remove(key);
        }
    }
    let custom_bytes: usize = desired
        .custom_metadata
        .iter()
        .map(|(k, v)| k.len() + v.len())
        .sum();
    let total_bytes = custom_bytes
        + desired
            .headers
            .iter()
            .map(|(k, v)| k.len() + v.as_ref().map_or(0, String::len))
            .sum::<usize>();
    if (provider != "r2" && custom_bytes > 2048) || total_bytes > 8192 {
        return Err("Metadata exceeds the provider's size limit".into());
    }
    Ok(desired)
}

async fn read(client: &Client, bucket: &str, key: &str) -> Result<HeadObjectOutput, String> {
    let head = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| crate::providers::s3_client::describe_s3_error(&e))?;
    if head.content_length().is_none_or(|size| size < 0) {
        return Err("Cannot safely inspect the object's size".into());
    }
    Ok(head)
}

#[tauri::command]
pub async fn get_object_metadata(
    config: ObjectConfigInput,
    key: String,
) -> Result<ObjectMetadata, String> {
    Ok(snapshot(
        &read(&config.client()?, &config.bucket, &key).await?,
    ))
}

/// Preserve explicit grants rather than silently resetting an object's ACL.
/// Endpoints without readable ACLs cannot safely use this generic fallback.
async fn acl_grants(
    client: &Client,
    bucket: &str,
    key: &str,
) -> Result<HashMap<String, String>, String> {
    let acl = client
        .get_object_acl()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|_| {
            "Cannot preserve object access settings: GetObjectAcl is unavailable or denied"
                .to_string()
        })?;
    let mut grants: HashMap<String, Vec<String>> = HashMap::new();
    for grant in acl.grants() {
        let grantee = grant
            .grantee()
            .ok_or("Object ACL contains an unsupported grant")?;
        let value = if let Some(id) = grantee.id() {
            format!("id=\"{id}\"")
        } else if let Some(uri) = grantee.uri() {
            format!("uri=\"{uri}\"")
        } else {
            return Err("Cannot preserve this ACL grantee safely".into());
        };
        let permission = grant
            .permission()
            .ok_or("Object ACL contains an unsupported permission")?
            .as_str();
        if !["FULL_CONTROL", "READ", "READ_ACP", "WRITE_ACP"].contains(&permission) {
            return Err("Cannot preserve this ACL permission safely".into());
        }
        grants.entry(permission.into()).or_default().push(value);
    }
    if grants.is_empty() {
        return Err("Cannot preserve an empty or unsupported object ACL".into());
    }
    Ok(grants.into_iter().map(|(k, v)| (k, v.join(","))).collect())
}

pub async fn update(
    client: &Client,
    config: &ObjectConfigInput,
    key: &str,
    baseline: &ObjectMetadata,
    changes: &MetadataChanges,
) -> Result<ObjectMetadata, String> {
    let head = read(client, &config.bucket, key).await?;
    let current = snapshot(&head);
    if &current != baseline {
        return Err("conflict: Object or metadata changed. Reload before saving.".into());
    }
    let desired = apply_changes(&current, changes, &config.provider)?;
    if desired == current {
        return Ok(current);
    }
    if head.sse_customer_algorithm().is_some()
        || head.object_lock_mode().is_some()
        || head.object_lock_legal_hold_status().is_some()
    {
        return Err(
            "Metadata updates for customer-encrypted or object-locked files are not supported"
                .into(),
        );
    }
    let expires = desired
        .headers
        .get("Expires")
        .and_then(|v| v.as_deref())
        .map(|v| DateTime::from_str(v, DateTimeFormat::HttpDate))
        .transpose()
        .map_err(|_| "Cannot preserve the Expires header")?;
    let custom = desired
        .custom_metadata
        .iter()
        .map(|(k, v)| (k.clone(), encode_value(v)))
        .collect();
    let mut request = client
        .copy_object()
        .bucket(&config.bucket)
        .key(key)
        .copy_source(format!(
            "{}/{}",
            urlencoding::encode(&config.bucket),
            urlencoding::encode(key)
        ))
        .copy_source_if_match(&current.etag)
        .metadata_directive(MetadataDirective::Replace)
        .set_metadata(Some(custom))
        .set_content_type(desired.headers["Content-Type"].clone())
        .set_cache_control(desired.headers["Cache-Control"].clone())
        .set_content_disposition(desired.headers["Content-Disposition"].clone())
        .set_content_encoding(desired.headers["Content-Encoding"].clone())
        .set_content_language(desired.headers["Content-Language"].clone())
        .set_expires(expires)
        .set_storage_class(head.storage_class().cloned());
    if config.provider != "r2" {
        let mut grants = acl_grants(client, &config.bucket, key).await?;
        request = request
            .tagging_directive(TaggingDirective::Copy)
            .set_server_side_encryption(head.server_side_encryption().cloned())
            .set_ssekms_key_id(head.ssekms_key_id().map(str::to_string))
            .set_bucket_key_enabled(head.bucket_key_enabled())
            .set_website_redirect_location(head.website_redirect_location().map(str::to_string))
            .set_grant_full_control(grants.remove("FULL_CONTROL"))
            .set_grant_read(grants.remove("READ"))
            .set_grant_read_acp(grants.remove("READ_ACP"))
            .set_grant_write_acp(grants.remove("WRITE_ACP"));
    }
    let result = if config.provider == "r2" {
        let etag = current.etag.clone();
        request
            .customize()
            .mutate_request(move |request| {
                request
                    .headers_mut()
                    .insert("cf-copy-destination-if-match", etag.clone());
            })
            .send()
            .await
    } else {
        request.send().await
    };
    let uncertainty = match result {
        Ok(_) => false,
        Err(e)
            if e.as_service_error().is_some_and(|e| {
                matches!(
                    e.code(),
                    Some("PreconditionFailed" | "ConditionalRequestConflict")
                )
            }) =>
        {
            return Err("conflict: Object changed during saving. Reload before saving.".into())
        }
        Err(e) => {
            let status = e.raw_response().map(|r| r.status().as_u16());
            if status.is_some_and(|v| (400..500).contains(&v)) {
                return Err(crate::providers::s3_client::describe_s3_error(&e));
            }
            true
        }
    };
    let refreshed = read(client, &config.bucket, key).await.map(|head| snapshot(&head))
        .map_err(|_| "outcome_unknown: Save was dispatched but could not be verified. Reload metadata before retrying.".to_string())?;
    if refreshed.size != current.size
        || refreshed.headers != desired.headers
        || refreshed.custom_metadata != desired.custom_metadata
        || refreshed.storage_class != current.storage_class
        || refreshed.missing_metadata > 0
    {
        return Err(if uncertainty {
            "outcome_unknown: Save result is uncertain. Reload metadata before retrying."
        } else {
            "verification_failed: Saved metadata does not match. Reload metadata before retrying."
        }
        .into());
    }
    Ok(refreshed)
}

#[tauri::command]
pub async fn update_object_metadata(
    config: ObjectConfigInput,
    key: String,
    baseline: ObjectMetadata,
    changes: MetadataChanges,
    app: tauri::AppHandle,
) -> Result<ObjectMetadata, String> {
    let scope = crate::db::cache_scope::capture_write_scope([config.cache_config()]).await;
    let result = update(&config.client()?, &config, &key, &baseline, &changes).await;
    if result.is_ok()
        || result.as_ref().is_err_and(|error| {
            error.starts_with("outcome_unknown:") || error.starts_with("verification_failed:")
        })
    {
        if let Ok(identity) = config.identity(&key) {
            app.state::<crate::preview::PreviewManager>()
                .invalidate(&identity);
        }
    }
    let metadata = result?;
    let cache = crate::commands::upload_cache::update_cache_after_upload(
        &app,
        &config.bucket,
        &config.account_id,
        &key,
        metadata.size as i64,
        metadata.last_modified.as_deref().unwrap_or_default(),
    );
    crate::commands::upload_cache::update_cache_after_write(scope, cache).await;
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn original() -> ObjectMetadata {
        snapshot(
            &HeadObjectOutput::builder()
                .content_length(12)
                .e_tag("\"original\"")
                .content_type("text/plain")
                .cache_control("max-age=60")
                .metadata("keep", "yes")
                .build(),
        )
    }
    #[test]
    fn patch_preserves_fields_and_supports_removals_and_unicode() {
        let changes = MetadataChanges {
            headers: BTreeMap::from([("Content-Type".into(), Some("application/json".into()))]),
            custom_metadata: BTreeMap::from([
                ("keep".into(), None),
                ("label".into(), Some("中文".into())),
            ]),
        };
        let result = apply_changes(&original(), &changes, "r2").unwrap();
        assert_eq!(
            result.headers["Cache-Control"].as_deref(),
            Some("max-age=60")
        );
        assert_eq!(result.custom_metadata.get("keep"), None);
        assert_eq!(decode_value(&encode_value("中文")), "中文");
    }
    #[test]
    fn unsafe_updates_are_rejected() {
        let mut object = original();
        object.size = METADATA_COPY_LIMIT;
        assert!(apply_changes(&object, &MetadataChanges::default(), "r2").is_ok());
        object.size += 1;
        assert!(apply_changes(&object, &MetadataChanges::default(), "r2").is_err());
        object.size = 12;
        object.missing_metadata = 1;
        assert!(apply_changes(&object, &MetadataChanges::default(), "r2").is_err());
        for (key, value) in [("bad key", "x"), ("Uppercase", "x"), ("ok", "x\r\ny")] {
            let changes = MetadataChanges {
                custom_metadata: BTreeMap::from([(key.into(), Some(value.into()))]),
                ..Default::default()
            };
            assert!(apply_changes(&original(), &changes, "r2").is_err());
        }
    }

    async fn fixture(
        provider: &str,
        copy_status: u16,
    ) -> (
        crate::test_s3::Fixture,
        ObjectConfigInput,
        std::sync::Arc<std::sync::Mutex<BTreeMap<String, String>>>,
    ) {
        let state = std::sync::Arc::new(std::sync::Mutex::new(BTreeMap::<String, String>::from([
            ("content-type".into(), "text/plain".into()),
            ("cache-control".into(), "max-age=60".into()),
            ("x-amz-meta-keep".into(), "yes".into()),
        ])));
        let stored = state.clone();
        let fixture = crate::test_s3::serve(move |request| {
            let stored = stored.clone();
            async move {
                if request.method == "HEAD" {
                    let mut response = crate::test_s3::Response::empty(200).header("content-length", 12).header("etag", "\"original\"").header("last-modified", "Mon, 12 Oct 2026 00:00:00 GMT");
                    for (name, value) in stored.lock().unwrap().iter() { response = response.header(name, value); }
                    return response;
                }
                if request.path.ends_with("?acl") {
                    return crate::test_s3::Response::xml(200, "<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:type=\"CanonicalUser\"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant><Grant><Grantee xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:type=\"Group\"><URI>http://acs.amazonaws.com/groups/global/AllUsers</URI></Grantee><Permission>READ</Permission></Grant></AccessControlList></AccessControlPolicy>");
                }
                if request.method == "PUT" {
                    if copy_status == 403 { return crate::test_s3::Response::xml(403, "<Error><Code>AccessDenied</Code></Error>"); }
                    if copy_status == 412 { return crate::test_s3::Response::xml(412, "<Error><Code>PreconditionFailed</Code></Error>"); }
                    let mut state = stored.lock().unwrap();
                    state.clear();
                    for (name, value) in request.headers {
                        if name.starts_with("x-amz-meta-") || ["content-type", "cache-control", "content-disposition", "content-encoding", "content-language", "expires"].contains(&name.as_str()) { state.insert(name, value); }
                    }
                    if copy_status == 500 { return crate::test_s3::Response::xml(500, "<Error><Code>InternalError</Code></Error>"); }
                    return crate::test_s3::Response::xml(200, "<CopyObjectResult><LastModified>2026-10-13T00:00:00Z</LastModified><ETag>\"copied\"</ETag></CopyObjectResult>");
                }
                crate::test_s3::Response { status: 200, headers: vec![], body: b"hello world!".to_vec() }
            }
        }).await;
        let config = ObjectConfigInput {
            provider: provider.into(),
            account_id: "fixture".into(),
            bucket: "bucket".into(),
            access_key_id: "fixture".into(),
            secret_access_key: "fixture-secret".into(),
            region: Some("us-east-1".into()),
            endpoint_scheme: Some("http".into()),
            endpoint_host: Some(fixture.endpoint.trim_start_matches("http://").into()),
            force_path_style: Some(true),
        };
        (fixture, config, state)
    }

    #[tokio::test]
    async fn real_sdk_self_copy_preserves_body_and_headers_across_providers() {
        use sha2::{Digest, Sha256};
        for provider in ["r2", "aws", "minio", "rustfs"] {
            let (fixture, config, _) = fixture(provider, 200).await;
            let key = "folder/中文 +#.txt";
            let before = fixture
                .client
                .get_object()
                .bucket("bucket")
                .key(key)
                .send()
                .await
                .unwrap()
                .body
                .collect()
                .await
                .unwrap()
                .into_bytes();
            let baseline = snapshot(&read(&fixture.client, "bucket", key).await.unwrap());
            let changes = MetadataChanges {
                headers: BTreeMap::from([("Content-Type".into(), Some("application/json".into()))]),
                custom_metadata: BTreeMap::from([
                    ("keep".into(), None),
                    ("label".into(), Some("中文".into())),
                ]),
            };
            let updated = update(&fixture.client, &config, key, &baseline, &changes)
                .await
                .unwrap();
            assert_eq!(
                updated.headers["Content-Type"].as_deref(),
                Some("application/json")
            );
            assert_eq!(
                updated.headers["Cache-Control"].as_deref(),
                Some("max-age=60")
            );
            assert_eq!(updated.custom_metadata["label"], "中文");
            let after = fixture
                .client
                .get_object()
                .bucket("bucket")
                .key(key)
                .send()
                .await
                .unwrap()
                .body
                .collect()
                .await
                .unwrap()
                .into_bytes();
            assert_eq!(Sha256::digest(before), Sha256::digest(after));
            let requests = fixture.requests.lock().unwrap();
            let copy = requests.iter().find(|r| r.method == "PUT").unwrap();
            assert_eq!(copy.headers["x-amz-metadata-directive"], "REPLACE");
            assert_eq!(copy.headers["x-amz-copy-source-if-match"], "\"original\"");
            assert_eq!(
                copy.headers["x-amz-copy-source"],
                format!("bucket/{}", urlencoding::encode(key))
            );
            assert!(copy.body.is_empty());
            if provider == "r2" {
                assert_eq!(copy.headers["cf-copy-destination-if-match"], "\"original\"");
            } else {
                assert_eq!(copy.headers["x-amz-tagging-directive"], "COPY");
                assert!(copy.headers["x-amz-grant-read"].contains("AllUsers"));
            }
        }
    }

    #[tokio::test]
    async fn stale_snapshots_and_denied_copies_never_report_success() {
        let changes = MetadataChanges {
            headers: BTreeMap::from([("Content-Type".into(), Some("application/json".into()))]),
            ..Default::default()
        };
        let (fixture, config, state) = fixture("r2", 200).await;
        let baseline = snapshot(&read(&fixture.client, "bucket", "file").await.unwrap());
        state
            .lock()
            .unwrap()
            .insert("cache-control".into(), "changed".into());
        assert!(
            update(&fixture.client, &config, "file", &baseline, &changes)
                .await
                .unwrap_err()
                .starts_with("conflict:")
        );
        assert!(!fixture
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.method == "PUT"));
        drop(fixture);
        for status in [403, 412] {
            let (fixture, config, _) = self::fixture("r2", status).await;
            let baseline = snapshot(&read(&fixture.client, "bucket", "file").await.unwrap());
            assert!(
                update(&fixture.client, &config, "file", &baseline, &changes)
                    .await
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn uncertain_response_is_reconciled_without_replaying_copy() {
        let (fixture, config, _) = fixture("r2", 500).await;
        let baseline = snapshot(&read(&fixture.client, "bucket", "file").await.unwrap());
        let changes = MetadataChanges {
            headers: BTreeMap::from([("Content-Type".into(), Some("application/json".into()))]),
            ..Default::default()
        };
        assert!(
            update(&fixture.client, &config, "file", &baseline, &changes)
                .await
                .is_ok()
        );
        assert_eq!(
            fixture
                .requests
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.method == "PUT")
                .count(),
            1
        );
    }
}
