//! Read-only loopback streaming for private object previews. No presigning.
use crate::object_access::ObjectConfigInput;
use aws_sdk_s3::{error::ProvideErrorMetadata, Client};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::StreamExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{OnceCell, Semaphore},
};
use tokio_util::{io::ReaderStream, sync::CancellationToken};

#[derive(Default)]
pub struct PreviewManager {
    service: OnceCell<Arc<PreviewService>>,
}

struct Session {
    identity: String,
    client: Client,
    bucket: String,
    key: String,
    references: usize,
    cancelled: CancellationToken,
}
struct PreviewService {
    port: u16,
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    stopped: CancellationToken,
    permits: Arc<Semaphore>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSession {
    pub session_id: String,
    pub url: String,
}

impl PreviewManager {
    async fn service(&self) -> Result<&Arc<PreviewService>, String> {
        self.service
            .get_or_try_init(|| async {
                let listener = TcpListener::bind("127.0.0.1:0")
                    .await
                    .map_err(|_| "Could not start private preview service")?;
                let port = listener
                    .local_addr()
                    .map_err(|_| "Could not read preview port")?
                    .port();
                let service = Arc::new(PreviewService {
                    port,
                    sessions: Mutex::new(HashMap::new()),
                    stopped: CancellationToken::new(),
                    permits: Arc::new(Semaphore::new(8)),
                });
                let router = Router::new()
                    .route("/preview/{id}/{filename}", get(serve_preview))
                    .with_state(service.clone());
                let stopped = service.stopped.clone();
                tokio::spawn(async move {
                    let _ = axum::serve(listener, router)
                        .with_graceful_shutdown(stopped.cancelled_owned())
                        .await;
                });
                Ok(service)
            })
            .await
    }

    pub async fn create(
        &self,
        config: ObjectConfigInput,
        key: String,
    ) -> Result<PreviewSession, String> {
        let identity = config.identity(&key)?;
        let client = config.client()?;
        let service = self.service().await?;
        let mut sessions = service
            .sessions
            .lock()
            .map_err(|_| "Preview registry unavailable")?;
        let existing = sessions.iter().find_map(|(id, session)| {
            let mut session = session.lock().ok()?;
            if session.identity == identity && !session.cancelled.is_cancelled() {
                session.references += 1;
                Some(id.clone())
            } else {
                None
            }
        });
        let id = existing.unwrap_or_else(|| {
            let id = uuid::Uuid::new_v4().to_string();
            sessions.insert(
                id.clone(),
                Arc::new(Mutex::new(Session {
                    identity,
                    client,
                    bucket: config.bucket,
                    key: key.clone(),
                    references: 1,
                    cancelled: service.stopped.child_token(),
                })),
            );
            id
        });
        // Retain the extension so the existing thumbnail decoder recognizes media.
        let filename = key
            .rsplit('/')
            .next()
            .filter(|v| !v.is_empty())
            .unwrap_or("object");
        Ok(PreviewSession {
            url: format!(
                "http://127.0.0.1:{}/preview/{}/{}",
                service.port,
                id,
                urlencoding::encode(filename)
            ),
            session_id: id,
        })
    }

    pub fn release(&self, id: &str) {
        let Some(service) = self.service.get() else {
            return;
        };
        let Ok(mut sessions) = service.sessions.lock() else {
            return;
        };
        let remove = sessions.get(id).is_some_and(|entry| {
            let Ok(mut session) = entry.lock() else {
                return true;
            };
            session.references = session.references.saturating_sub(1);
            if session.references == 0 {
                session.cancelled.cancel();
                true
            } else {
                false
            }
        });
        if remove {
            sessions.remove(id);
        }
    }

    pub fn invalidate(&self, identity: &str) {
        if let Some(service) = self.service.get() {
            if let Ok(mut sessions) = service.sessions.lock() {
                sessions.retain(|_, entry| {
                    entry.lock().is_ok_and(|session| {
                        if session.identity == identity {
                            session.cancelled.cancel();
                            false
                        } else {
                            true
                        }
                    })
                });
            }
        }
    }

    pub fn shutdown(&self) {
        if let Some(service) = self.service.get() {
            service.stopped.cancel();
            if let Ok(mut sessions) = service.sessions.lock() {
                sessions.clear();
            }
        }
    }
}

#[tauri::command]
pub async fn create_preview_session(
    config: ObjectConfigInput,
    key: String,
    manager: tauri::State<'_, PreviewManager>,
) -> Result<PreviewSession, String> {
    manager.create(config, key).await
}
#[tauri::command]
pub fn release_preview_session(session_id: String, manager: tauri::State<'_, PreviewManager>) {
    manager.release(&session_id);
}

fn response(status: StatusCode, body: Body) -> Response {
    Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(body)
        .expect("static response headers")
}

/// Single ranges, including suffix and open-ended ranges. SDK reads retain the
/// original object ETag, so seeking cannot mix different object generations.
fn parse_range(value: &str, size: u64) -> Result<(u64, u64), ()> {
    let (start, end) = value
        .strip_prefix("bytes=")
        .ok_or(())?
        .split_once('-')
        .ok_or(())?;
    if size == 0 || end.contains(',') {
        return Err(());
    }
    if start.is_empty() {
        let count = end.parse::<u64>().map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        Ok((size.saturating_sub(count), size - 1))
    } else {
        let start = start.parse::<u64>().map_err(|_| ())?;
        let end = if end.is_empty() {
            size - 1
        } else {
            end.parse::<u64>().map_err(|_| ())?.min(size - 1)
        };
        if start >= size || start > end {
            return Err(());
        }
        Ok((start, end))
    }
}

async fn serve_preview(
    State(service): State<Arc<PreviewService>>,
    Path((id, _filename)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let expected_host = format!("127.0.0.1:{}", service.port);
    if headers.get("host").and_then(|v| v.to_str().ok()) != Some(expected_host.as_str()) {
        return response(StatusCode::FORBIDDEN, Body::empty());
    }
    let entry = service
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&id).cloned());
    let Some(entry) = entry else {
        return response(StatusCode::NOT_FOUND, Body::empty());
    };
    let snapshot = entry.lock().ok().map(|s| {
        (
            s.client.clone(),
            s.bucket.clone(),
            s.key.clone(),
            s.cancelled.clone(),
        )
    });
    let Some((client, bucket, key, cancelled)) = snapshot else {
        return response(StatusCode::SERVICE_UNAVAILABLE, Body::empty());
    };
    let permit = tokio::select! {
        _ = cancelled.cancelled() => return response(StatusCode::NOT_FOUND, Body::empty()),
        result = service.permits.clone().acquire_owned() => match result { Ok(permit) => permit, Err(_) => return response(StatusCode::SERVICE_UNAVAILABLE, Body::empty()) },
    };
    let head = tokio::select! {
        _ = cancelled.cancelled() => return response(StatusCode::NOT_FOUND, Body::empty()),
        result = client.head_object().bucket(&bucket).key(&key).send() => match result {
            Ok(head) => head,
            Err(e) => return response(s3_status(e.as_service_error().and_then(|e| e.code()), e.raw_response().map(|response| response.status().as_u16())), Body::empty()),
        }
    };
    let size = head.content_length().unwrap_or(0).max(0) as u64;
    let range = match headers.get("range") {
        Some(value) => match value.to_str().ok().and_then(|v| parse_range(v, size).ok()) {
            Some(range) => Some(range),
            None => {
                let mut result = response(StatusCode::RANGE_NOT_SATISFIABLE, Body::empty());
                result.headers_mut().insert(
                    "content-range",
                    format!("bytes */{size}").parse().expect("numeric range"),
                );
                return result;
            }
        },
        None => None,
    };
    let (status, length) = range.map_or((StatusCode::OK, size), |(start, end)| {
        (StatusCode::PARTIAL_CONTENT, end - start + 1)
    });
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        let mut request = client
            .get_object()
            .bucket(&bucket)
            .key(&key)
            .set_if_match(head.e_tag().map(str::to_string));
        if let Some((start, end)) = range {
            request = request.range(format!("bytes={start}-{end}"));
        }
        let object = tokio::select! {
            _ = cancelled.cancelled() => return response(StatusCode::NOT_FOUND, Body::empty()),
            result = request.send() => match result {
                Ok(object) => object,
                Err(e) => return response(s3_status(e.as_service_error().and_then(|e| e.code()), e.raw_response().map(|response| response.status().as_u16())), Body::empty()),
            },
        };
        let reader = ReaderStream::new(object.body.into_async_read());
        let stream = futures_util::stream::unfold(
            (reader, permit, cancelled),
            |(mut reader, permit, cancelled)| async move {
                tokio::select! {
                    _ = cancelled.cancelled() => None,
                    next = tokio::time::timeout(Duration::from_secs(60), reader.next()) => match next {
                        Ok(Some(chunk)) => Some((chunk, (reader, permit, cancelled))),
                        Ok(None) => None,
                        Err(_) => Some((Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Preview read timed out")), (reader, permit, cancelled))),
                    }
                }
            },
        );
        Body::from_stream(stream)
    };
    let mut result = response(status, body);
    let output = result.headers_mut();
    output.insert(
        "content-length",
        length.to_string().parse().expect("numeric length"),
    );
    output.insert("accept-ranges", "bytes".parse().expect("static header"));
    output.insert(
        "content-type",
        head.content_type()
            .unwrap_or("application/octet-stream")
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().expect("static MIME")),
    );
    if let Some(value) = head.content_encoding().and_then(|v| v.parse().ok()) {
        output.insert("content-encoding", value);
    }
    if let Some(value) = head.e_tag().and_then(|v| v.parse().ok()) {
        output.insert("etag", value);
    }
    if let Some((start, end)) = range {
        output.insert(
            "content-range",
            format!("bytes {start}-{end}/{size}")
                .parse()
                .expect("numeric range"),
        );
    }
    result
}

fn s3_status(code: Option<&str>, status: Option<u16>) -> StatusCode {
    match code.unwrap_or_default() {
        "NoSuchKey" | "NotFound" => StatusCode::NOT_FOUND,
        "AccessDenied" | "InvalidAccessKeyId" | "SignatureDoesNotMatch" => StatusCode::FORBIDDEN,
        "PreconditionFailed" => StatusCode::PRECONDITION_FAILED,
        _ => match status {
            Some(401 | 403) => StatusCode::FORBIDDEN,
            Some(404) => StatusCode::NOT_FOUND,
            Some(412) => StatusCode::PRECONDITION_FAILED,
            Some(416) => StatusCode::RANGE_NOT_SATISFIABLE,
            _ => StatusCode::BAD_GATEWAY,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn byte_ranges_cover_seeking_and_invalid_inputs() {
        assert_eq!(parse_range("bytes=2-4", 10), Ok((2, 4)));
        assert_eq!(parse_range("bytes=2-", 10), Ok((2, 9)));
        assert_eq!(parse_range("bytes=-4", 10), Ok((6, 9)));
        assert_eq!(parse_range("bytes=0-99", 10), Ok((0, 9)));
        for value in [
            "bytes=10-",
            "bytes=-0",
            "bytes=4-2",
            "bytes=0-1,3-4",
            "items=0-1",
        ] {
            assert!(parse_range(value, 10).is_err());
        }
        assert!(parse_range("bytes=0-", 0).is_err());
    }

    #[tokio::test]
    async fn authenticated_streams_share_leases_and_reject_revoked_sessions() {
        let fixture = crate::test_s3::serve(|request| async move {
            let body = b"0123456789";
            if request.path.contains("denied") {
                return crate::test_s3::Response::xml(
                    403,
                    "<Error><Code>AccessDenied</Code></Error>",
                );
            }
            if request.method == "HEAD" {
                return crate::test_s3::Response::empty(200)
                    .header("content-length", 10)
                    .header("content-type", "video/mp4")
                    .header("etag", "\"original\"");
            }
            if request
                .headers
                .get("range")
                .is_some_and(|v| v == "bytes=2-4")
            {
                return crate::test_s3::Response {
                    status: 206,
                    headers: vec![("content-range".into(), "bytes 2-4/10".into())],
                    body: body[2..5].to_vec(),
                };
            }
            crate::test_s3::Response {
                status: 200,
                headers: vec![],
                body: body.to_vec(),
            }
        })
        .await;
        let config = ObjectConfigInput {
            provider: "minio".into(),
            account_id: "fixture".into(),
            bucket: "bucket".into(),
            access_key_id: "fixture".into(),
            secret_access_key: "fixture-secret".into(),
            region: None,
            endpoint_scheme: Some("http".into()),
            endpoint_host: Some(fixture.endpoint.trim_start_matches("http://").into()),
            force_path_style: Some(true),
        };
        let manager = PreviewManager::default();
        let first = manager
            .create(config.clone(), "movie.mp4".into())
            .await
            .unwrap();
        let second = manager
            .create(config.clone(), "movie.mp4".into())
            .await
            .unwrap();
        assert_eq!(first.session_id, second.session_id);
        assert!(first.url.ends_with("movie.mp4"));
        let http = reqwest::Client::new();
        let ranged = http
            .get(&first.url)
            .header("range", "bytes=2-4")
            .send()
            .await
            .unwrap();
        assert_eq!(ranged.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(ranged.headers()["content-range"], "bytes 2-4/10");
        assert_eq!(ranged.headers()["cache-control"], "no-store");
        assert_eq!(ranged.bytes().await.unwrap().as_ref(), b"234");
        assert_eq!(
            http.head(&first.url).send().await.unwrap().headers()["content-length"],
            "10"
        );
        assert_eq!(
            http.get(&first.url)
                .header("range", "bytes=99-")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::RANGE_NOT_SATISFIABLE
        );
        assert_eq!(
            http.get(&first.url)
                .header("host", "evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        manager.release(&first.session_id);
        assert_eq!(
            http.get(&second.url).send().await.unwrap().status(),
            StatusCode::OK
        );
        manager.release(&second.session_id);
        assert_eq!(
            http.get(&second.url).send().await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
        let denied = manager
            .create(config.clone(), "denied.mp4".into())
            .await
            .unwrap();
        assert_eq!(
            http.get(&denied.url).send().await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let mut other = config.clone();
        other.secret_access_key = "different".into();
        let changed = manager.create(other, "movie.mp4".into()).await.unwrap();
        let original = manager
            .create(config.clone(), "movie.mp4".into())
            .await
            .unwrap();
        assert_ne!(changed.session_id, original.session_id);
        manager.invalidate(&config.identity("movie.mp4").unwrap());
        assert_eq!(
            http.get(&original.url).send().await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
        for request in fixture.requests.lock().unwrap().iter() {
            assert!(request.headers.contains_key("authorization"));
            assert!(!request.path.contains("X-Amz-Signature"));
        }
        manager.shutdown();
    }
}
