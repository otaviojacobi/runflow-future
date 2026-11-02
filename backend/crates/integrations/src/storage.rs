//! Object storage (D-037): S3-compatible everywhere (Garage locally and on the Pi, any S3 in production);
//! disk and memory for tests and quick local runs. Same API.

use std::path::PathBuf;
use std::sync::Arc;

use object_store::aws::AmazonS3Builder;
use object_store::local::LocalFileSystem;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutPayload};

#[derive(Debug, Clone)]
pub enum StorageSettings {
    Disk {
        dir: PathBuf,
    },
    /// Credentials come from the standard AWS variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
    /// An `http://` endpoint (Garage on the compose network) is allowed; path-style requests.
    S3 {
        bucket: String,
        region: String,
        endpoint: Option<String>,
    },
}

#[derive(Debug, thiserror::Error)]
#[error("storage: {0}")]
pub struct StorageError(String);

#[derive(Clone)]
pub struct Storage {
    store: Arc<dyn ObjectStore>,
    describe: String,
}

impl std::fmt::Debug for Storage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Storage({})", self.describe)
    }
}

impl Storage {
    pub fn from_settings(s: &StorageSettings) -> Result<Self, StorageError> {
        match s {
            StorageSettings::Disk { dir } => {
                std::fs::create_dir_all(dir)
                    .map_err(|e| StorageError(format!("{}: {e}", dir.display())))?;
                let fs = LocalFileSystem::new_with_prefix(dir)
                    .map_err(|e| StorageError(e.to_string()))?;
                Ok(Self {
                    store: Arc::new(fs),
                    describe: format!("disk {}", dir.display()),
                })
            }
            StorageSettings::S3 {
                bucket,
                region,
                endpoint,
            } => {
                let mut b = AmazonS3Builder::from_env()
                    .with_bucket_name(bucket)
                    .with_region(region);
                if let Some(e) = endpoint {
                    b = b
                        .with_endpoint(e)
                        .with_virtual_hosted_style_request(false)
                        .with_allow_http(e.starts_with("http://"));
                }
                let s3 = b.build().map_err(|e| StorageError(e.to_string()))?;
                Ok(Self {
                    store: Arc::new(s3),
                    describe: format!("s3 {bucket}"),
                })
            }
        }
    }

    /// In-memory store (tests).
    pub fn memory() -> Self {
        Self {
            store: Arc::new(InMemory::new()),
            describe: "memory".into(),
        }
    }

    pub async fn put(&self, key: &str, bytes: Vec<u8>) -> Result<(), StorageError> {
        self.store
            .put(&Path::from(key), PutPayload::from(bytes))
            .await
            .map(|_| ())
            .map_err(|e| StorageError(e.to_string()))
    }

    pub async fn delete(&self, key: &str) -> Result<(), StorageError> {
        match self.store.delete(&Path::from(key)).await {
            Ok(()) | Err(object_store::Error::NotFound { .. }) => Ok(()),
            Err(e) => Err(StorageError(e.to_string())),
        }
    }

    /// Write, read back and delete a small object (`doctor`): proves the store is reachable and writable.
    pub async fn check(&self) -> Result<(), StorageError> {
        let key = format!("_doctor/{}", uuid::Uuid::now_v7());
        self.put(&key, b"ok".to_vec()).await?;
        let back = self.get(&key).await?;
        self.delete(&key).await?;
        match back.as_deref() {
            Some(b"ok") => Ok(()),
            _ => Err(StorageError("read back a different object".into())),
        }
    }

    pub fn describe(&self) -> &str {
        &self.describe
    }

    /// `None` when the object doesn't exist.
    pub async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StorageError> {
        match self.store.get(&Path::from(key)).await {
            Ok(r) => Ok(Some(
                r.bytes()
                    .await
                    .map_err(|e| StorageError(e.to_string()))?
                    .to_vec(),
            )),
            Err(object_store::Error::NotFound { .. }) => Ok(None),
            Err(e) => Err(StorageError(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn disk_and_memory_round_trip() {
        let dir = std::env::temp_dir().join(format!("runflow-storage-{}", std::process::id()));
        for s in [
            Storage::memory(),
            Storage::from_settings(&StorageSettings::Disk { dir: dir.clone() }).unwrap(),
        ] {
            s.put("clubs/a/logo", b"png".to_vec()).await.unwrap();
            assert_eq!(
                s.get("clubs/a/logo").await.unwrap().as_deref(),
                Some(&b"png"[..])
            );
            assert_eq!(s.get("clubs/a/missing").await.unwrap(), None);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
