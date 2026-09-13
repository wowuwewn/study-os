use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{BufReader, Cursor},
    str::FromStr,
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Datelike, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use futures_util::StreamExt;
use ical::{property::Property, IcalParser};
use reqwest::{header, redirect::Policy, Client, StatusCode};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_sql::{DbInstances, DbPool};
use url::Url;
use uuid::Uuid;

use crate::credential_store;

const DATABASE_URL: &str = "sqlite:study-os.db";
const SOURCE_ID: &str = "integration:ical:canvas-dankook";
const ALLOWED_HOST: &str = "canvas.dankook.ac.kr";
const SOURCE_TIMEZONE: &str = "Asia/Seoul";
const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const ADAPTER_VERSION: &str = "ical-v2.3-canvas-all-day";

#[derive(Default)]
pub struct IcalSyncRuntime {
    lock: tokio::sync::Mutex<()>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcalConnectionStatus {
    pub connected: bool,
    pub status: String,
    pub last_success_at: Option<String>,
    pub last_error_code: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcalDiagnostics {
    pub calendars: usize,
    pub vevents: usize,
    pub vtodos: usize,
    pub total_items: usize,
    pub date_values: usize,
    pub date_time_values: usize,
    pub events: usize,
    pub assignments: usize,
    pub recurring_rules: usize,
    pub schedule_exceptions: usize,
    pub cancellations: usize,
    pub unsupported: usize,
    pub property_names: Vec<String>,
    pub component_counts: BTreeMap<String, usize>,
    pub property_counts: BTreeMap<String, usize>,
    pub unsupported_reasons: BTreeMap<String, usize>,
    pub recurrence_shapes: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcalSyncResult {
    pub not_modified: bool,
    pub generation: i64,
    pub inserted: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub diagnostics: IcalDiagnostics,
}

#[derive(Debug, thiserror::Error)]
enum SyncError {
    #[error("not_main_window")]
    NotMainWindow,
    #[error("invalid_endpoint")]
    InvalidEndpoint,
    #[error("credential_missing")]
    CredentialMissing,
    #[error("credential_unavailable")]
    CredentialUnavailable,
    #[error("sync_in_progress")]
    SyncInProgress,
    #[error("network_error")]
    Network,
    #[error("http_error")]
    Http,
    #[error("response_too_large")]
    ResponseTooLarge,
    #[error("invalid_calendar")]
    InvalidCalendar,
    #[error("database_error")]
    Database,
}

impl SyncError {
    fn code(&self) -> String {
        self.to_string()
    }
}

#[derive(Debug, Clone)]
struct FetchCache {
    etag: Option<String>,
    last_modified: Option<String>,
}

enum FetchResult {
    NotModified,
    Calendar {
        bytes: Vec<u8>,
        etag: Option<String>,
        last_modified: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
struct CourseEvidence {
    external_id: String,
    name: Option<String>,
    code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
enum TemporalValue {
    Date {
        value: String,
        timezone: String,
    },
    DateTime {
        utc: String,
        local_date: String,
        local_time: String,
        timezone: String,
    },
}

impl TemporalValue {
    fn date(&self) -> &str {
        match self {
            Self::Date { value, .. } => value,
            Self::DateTime { local_date, .. } => local_date,
        }
    }
}

fn valid_temporal_range(start: &TemporalValue, end: &TemporalValue) -> bool {
    match (start, end) {
        (TemporalValue::Date { value: start, .. }, TemporalValue::Date { value: end, .. }) => {
            end > start
        }
        (TemporalValue::DateTime { utc: start, .. }, TemporalValue::DateTime { utc: end, .. }) => {
            match (
                DateTime::parse_from_rfc3339(start),
                DateTime::parse_from_rfc3339(end),
            ) {
                (Ok(start), Ok(end)) => end >= start,
                _ => false,
            }
        }
        _ => false,
    }
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedEvent {
    external_id: String,
    title: String,
    description: Option<String>,
    start: TemporalValue,
    end: Option<TemporalValue>,
    location: Option<String>,
    event_type: String,
    course: Option<CourseEvidence>,
    sequence: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedAssignment {
    external_id: String,
    title: String,
    description: Option<String>,
    due: Option<TemporalValue>,
    course: Option<CourseEvidence>,
    sequence: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedRule {
    external_id: String,
    parent_uid_hash: String,
    weekday: u32,
    starts_on: String,
    ends_on: Option<String>,
    start: TemporalValue,
    end: TemporalValue,
    location: Option<String>,
    course: CourseEvidence,
    sequence: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedException {
    external_id: String,
    rule_external_id: String,
    occurrence_on: String,
    status: String,
    replacement_start: Option<String>,
    replacement_end: Option<String>,
    title_override: Option<String>,
    location_override: Option<String>,
    sequence: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
enum NormalizedItem {
    Event(NormalizedEvent),
    Assignment(NormalizedAssignment),
    Rule(NormalizedRule),
    Exception(NormalizedException),
    Cancel {
        external_id: String,
        sequence: Option<i64>,
    },
}

impl NormalizedItem {
    fn external_id(&self) -> &str {
        match self {
            Self::Event(value) => &value.external_id,
            Self::Assignment(value) => &value.external_id,
            Self::Rule(value) => &value.external_id,
            Self::Exception(value) => &value.external_id,
            Self::Cancel { external_id, .. } => external_id,
        }
    }

    fn sequence(&self) -> Option<i64> {
        match self {
            Self::Event(value) => value.sequence,
            Self::Assignment(value) => value.sequence,
            Self::Rule(value) => value.sequence,
            Self::Exception(value) => value.sequence,
            Self::Cancel { sequence, .. } => *sequence,
        }
    }

    fn content_hash(&self) -> String {
        let bytes = serde_json::to_vec(self).expect("normalized iCal items serialize");
        digest(&bytes)
    }
}

#[derive(Default)]
struct NormalizedSnapshot {
    items: Vec<NormalizedItem>,
    diagnostics: IcalDiagnostics,
}

fn digest(value: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value))
}

fn external_id(prefix: &str, identity: &str) -> String {
    format!("{prefix}:{}", digest(identity.as_bytes()))
}

fn require_main(window: &WebviewWindow) -> Result<(), SyncError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(SyncError::NotMainWindow)
    }
}

fn validate_endpoint(value: &str) -> Result<Url, SyncError> {
    let url = Url::parse(value).map_err(|_| SyncError::InvalidEndpoint)?;
    let valid = url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case(ALLOWED_HOST))
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none();
    valid.then_some(url).ok_or(SyncError::InvalidEndpoint)
}

async fn sqlite_pool(instances: &DbInstances) -> Result<SqlitePool, SyncError> {
    let instances = instances.0.read().await;
    match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err(SyncError::Database),
    }
}

async fn ensure_source(pool: &SqlitePool, configured: bool) -> Result<(), SyncError> {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut transaction = pool.begin().await.map_err(|_| SyncError::Database)?;
    sqlx::query(
        "INSERT INTO sources (id, kind, display_name, integration_metadata_json, created_at, updated_at) \
         VALUES (?1, 'ical', '단국대학교 e-Campus iCal', ?2, ?3, ?3) \
         ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, \
         integration_metadata_json=excluded.integration_metadata_json, updated_at=excluded.updated_at",
    )
    .bind(SOURCE_ID)
    .bind(format!(
        "{{\"providerProfile\":\"dankook-canvas\",\"timezone\":\"{SOURCE_TIMEZONE}\",\"allowedHost\":\"{ALLOWED_HOST}\"}}"
    ))
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|_| SyncError::Database)?;
    sqlx::query(
        "INSERT INTO source_sync_states (source_id, status, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?3) ON CONFLICT(source_id) DO UPDATE SET \
         status=CASE \
           WHEN ?2='needs_configuration' THEN 'needs_configuration' \
           WHEN source_sync_states.status='syncing' THEN 'error' \
           WHEN source_sync_states.status='needs_configuration' THEN 'idle' \
           ELSE source_sync_states.status END, \
         last_error_code=CASE WHEN source_sync_states.status='syncing' THEN 'stale_sync' ELSE source_sync_states.last_error_code END, \
         updated_at=?3",
    )
    .bind(SOURCE_ID)
    .bind(if configured { "idle" } else { "needs_configuration" })
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|_| SyncError::Database)?;
    sqlx::query(
        "UPDATE source_sync_states SET \
         etag=CASE WHEN adapter_version<>?1 THEN NULL ELSE etag END, \
         last_modified=CASE WHEN adapter_version<>?1 THEN NULL ELSE last_modified END, \
         adapter_version=?1, updated_at=?2 WHERE source_id=?3",
    )
    .bind(ADAPTER_VERSION)
    .bind(&now)
    .bind(SOURCE_ID)
    .execute(&mut *transaction)
    .await
    .map_err(|_| SyncError::Database)?;
    transaction.commit().await.map_err(|_| SyncError::Database)
}

async fn read_status(pool: &SqlitePool) -> Result<IcalConnectionStatus, SyncError> {
    let connected = credential_store::exists();
    ensure_source(pool, connected).await?;
    let row = sqlx::query(
        "SELECT status, last_success_at, last_error_code FROM source_sync_states WHERE source_id=?1",
    )
    .bind(SOURCE_ID)
    .fetch_one(pool)
    .await
    .map_err(|_| SyncError::Database)?;
    Ok(IcalConnectionStatus {
        connected,
        status: if connected {
            row.get::<String, _>("status")
        } else {
            "needs_configuration".into()
        },
        last_success_at: row.get("last_success_at"),
        last_error_code: row.get("last_error_code"),
    })
}

#[tauri::command]
pub async fn ical_connection_status(
    window: WebviewWindow,
    db_instances: State<'_, DbInstances>,
) -> Result<IcalConnectionStatus, String> {
    require_main(&window).map_err(|error| error.code())?;
    let pool = sqlite_pool(&db_instances)
        .await
        .map_err(|error| error.code())?;
    read_status(&pool).await.map_err(|error| error.code())
}

#[tauri::command]
pub async fn connect_ical(
    window: WebviewWindow,
    db_instances: State<'_, DbInstances>,
    url: String,
) -> Result<IcalConnectionStatus, String> {
    require_main(&window).map_err(|error| error.code())?;
    validate_endpoint(&url).map_err(|error| error.code())?;
    credential_store::set(&url).map_err(|_| SyncError::CredentialUnavailable.code())?;
    let pool = sqlite_pool(&db_instances)
        .await
        .map_err(|error| error.code())?;
    if let Err(error) = ensure_source(&pool, true).await {
        let _ = credential_store::delete();
        return Err(error.code());
    }
    read_status(&pool).await.map_err(|error| error.code())
}

#[tauri::command]
pub async fn disconnect_ical(
    window: WebviewWindow,
    db_instances: State<'_, DbInstances>,
) -> Result<IcalConnectionStatus, String> {
    require_main(&window).map_err(|error| error.code())?;
    credential_store::delete().map_err(|_| SyncError::CredentialUnavailable.code())?;
    let pool = sqlite_pool(&db_instances)
        .await
        .map_err(|error| error.code())?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    ensure_source(&pool, false)
        .await
        .map_err(|error| error.code())?;
    sqlx::query(
        "UPDATE source_sync_states SET status='needs_configuration', etag=NULL, last_modified=NULL, \
         last_error_code=NULL, consecutive_failures=0, updated_at=?1 WHERE source_id=?2",
    )
    .bind(now)
    .bind(SOURCE_ID)
    .execute(&pool)
    .await
    .map_err(|_| SyncError::Database.code())?;
    read_status(&pool).await.map_err(|error| error.code())
}

async fn update_attempt(pool: &SqlitePool) -> Result<FetchCache, SyncError> {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sqlx::query(
        "UPDATE source_sync_states SET status='syncing', last_attempt_at=?1, \
         last_error_code=NULL, updated_at=?1 WHERE source_id=?2",
    )
    .bind(&now)
    .bind(SOURCE_ID)
    .execute(pool)
    .await
    .map_err(|_| SyncError::Database)?;
    let row = sqlx::query("SELECT etag, last_modified FROM source_sync_states WHERE source_id=?1")
        .bind(SOURCE_ID)
        .fetch_one(pool)
        .await
        .map_err(|_| SyncError::Database)?;
    Ok(FetchCache {
        etag: row.get("etag"),
        last_modified: row.get("last_modified"),
    })
}

async fn record_failure(pool: &SqlitePool, code: &str) {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let _ = sqlx::query(
        "UPDATE source_sync_states SET status='error', last_error_at=?1, last_error_code=?2, \
         consecutive_failures=consecutive_failures+1, updated_at=?1 WHERE source_id=?3",
    )
    .bind(now)
    .bind(code)
    .bind(SOURCE_ID)
    .execute(pool)
    .await;
}

fn calendar_payload(bytes: &[u8]) -> &[u8] {
    let without_bom = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    without_bom
        .iter()
        .position(|byte| !matches!(byte, b'\r' | b'\n'))
        .map_or(&[], |start| &without_bom[start..])
}

async fn fetch_calendar(url: &Url, cache: &FetchCache) -> Result<FetchResult, SyncError> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 {
                return attempt.error("redirect_limit");
            }
            let next = attempt.url();
            if next.scheme() == "https"
                && next
                    .host_str()
                    .is_some_and(|host| host.eq_ignore_ascii_case(ALLOWED_HOST))
                && next.port_or_known_default() == Some(443)
            {
                attempt.follow()
            } else {
                attempt.error("redirect_blocked")
            }
        }))
        .build()
        .map_err(|_| SyncError::Network)?;
    let mut request = client
        .get(url.clone())
        .header(header::ACCEPT, "text/calendar");
    if let Some(value) = &cache.etag {
        request = request.header(header::IF_NONE_MATCH, value);
    }
    if let Some(value) = &cache.last_modified {
        request = request.header(header::IF_MODIFIED_SINCE, value);
    }
    let response = request.send().await.map_err(|_| SyncError::Network)?;
    if response.status() == StatusCode::NOT_MODIFIED {
        return Ok(FetchResult::NotModified);
    }
    if !response.status().is_success() {
        return Err(SyncError::Http);
    }
    if response
        .content_length()
        .is_some_and(|size| size as usize > MAX_RESPONSE_BYTES)
    {
        return Err(SyncError::ResponseTooLarge);
    }
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let last_modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| SyncError::Network)?;
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(SyncError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    if !calendar_payload(&bytes).starts_with(b"BEGIN:VCALENDAR") {
        return Err(SyncError::InvalidCalendar);
    }
    Ok(FetchResult::Calendar {
        bytes,
        etag,
        last_modified,
    })
}

#[tauri::command]
pub async fn sync_ical(
    window: WebviewWindow,
    db_instances: State<'_, DbInstances>,
    runtime: State<'_, IcalSyncRuntime>,
) -> Result<IcalSyncResult, String> {
    require_main(&window).map_err(|error| error.code())?;
    let _guard = runtime
        .lock
        .try_lock()
        .map_err(|_| SyncError::SyncInProgress.code())?;
    let pool = sqlite_pool(&db_instances)
        .await
        .map_err(|error| error.code())?;
    ensure_source(&pool, credential_store::exists())
        .await
        .map_err(|error| error.code())?;
    let url = credential_store::get().map_err(|error| match error {
        credential_store::CredentialError::Missing => SyncError::CredentialMissing.code(),
        _ => SyncError::CredentialUnavailable.code(),
    })?;
    let url = validate_endpoint(&url).map_err(|error| error.code())?;
    let cache = update_attempt(&pool).await.map_err(|error| error.code())?;
    let result = async {
        match fetch_calendar(&url, &cache).await? {
            FetchResult::NotModified => finish_not_modified(&pool).await,
            FetchResult::Calendar {
                bytes,
                etag,
                last_modified,
            } => {
                let snapshot = parse_calendar(&bytes)?;
                apply_snapshot(&pool, snapshot, etag, last_modified).await
            }
        }
    }
    .await;
    if let Err(error) = &result {
        record_failure(&pool, &error.code()).await;
    } else if result.as_ref().is_ok_and(|value| !value.not_modified) {
        window
            .app_handle()
            .emit("study-os-data-changed", ())
            .map_err(|_| SyncError::Database.code())?;
    }
    result.map_err(|error| error.code())
}

async fn finish_not_modified(pool: &SqlitePool) -> Result<IcalSyncResult, SyncError> {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sqlx::query(
        "UPDATE source_sync_states SET status='ok', last_success_at=?1, last_error_code=NULL, \
         consecutive_failures=0, updated_at=?1 WHERE source_id=?2",
    )
    .bind(now)
    .bind(SOURCE_ID)
    .execute(pool)
    .await
    .map_err(|_| SyncError::Database)?;
    let generation: i64 =
        sqlx::query_scalar("SELECT sync_generation FROM source_sync_states WHERE source_id=?1")
            .bind(SOURCE_ID)
            .fetch_one(pool)
            .await
            .map_err(|_| SyncError::Database)?;
    Ok(IcalSyncResult {
        not_modified: true,
        generation,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        diagnostics: IcalDiagnostics::default(),
    })
}

fn property<'a>(properties: &'a [Property], name: &str) -> Option<&'a Property> {
    properties
        .iter()
        .find(|value| value.name.eq_ignore_ascii_case(name))
}

fn matching_properties<'a>(
    properties: &'a [Property],
    name: &'a str,
) -> impl Iterator<Item = &'a Property> {
    properties
        .iter()
        .filter(move |value| value.name.eq_ignore_ascii_case(name))
}

fn value(properties: &[Property], name: &str) -> Option<String> {
    property(properties, name)
        .and_then(|property| property.value.as_deref())
        .map(unescape_text)
}

fn raw_value<'a>(properties: &'a [Property], name: &str) -> Option<&'a str> {
    property(properties, name).and_then(|property| property.value.as_deref())
}

fn param<'a>(property: &'a Property, name: &str) -> Option<&'a str> {
    property
        .params
        .as_ref()?
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))?
        .1
        .first()
        .map(String::as_str)
}

fn unescape_text(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            result.push(character);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => result.push('\n'),
            Some(escaped @ (',' | ';' | '\\')) => result.push(escaped),
            Some(other) => result.push(other),
            None => result.push('\\'),
        }
    }
    result
}

fn parse_date(value: &str) -> Result<NaiveDate, SyncError> {
    let date_value = value
        .strip_suffix("T000000")
        .or_else(|| value.strip_suffix("T00:00:00"))
        .unwrap_or(value);
    NaiveDate::parse_from_str(date_value, "%Y%m%d")
        .or_else(|_| NaiveDate::parse_from_str(date_value, "%Y-%m-%d"))
        .map_err(|_| SyncError::InvalidCalendar)
}

fn localize(naive: NaiveDateTime, timezone: Tz) -> Result<DateTime<Utc>, SyncError> {
    match timezone.from_local_datetime(&naive) {
        LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
        _ => Err(SyncError::InvalidCalendar),
    }
}

fn parse_timezone(value: &str) -> Result<Tz, SyncError> {
    if value.eq_ignore_ascii_case("Korea Standard Time")
        || value.eq_ignore_ascii_case("Seoul Standard Time")
    {
        return Ok(chrono_tz::Asia::Seoul);
    }
    Tz::from_str(value).map_err(|_| SyncError::InvalidCalendar)
}

fn temporal(property: &Property, fallback_timezone: &str) -> Result<TemporalValue, SyncError> {
    let raw = property
        .value
        .as_deref()
        .ok_or(SyncError::InvalidCalendar)?;
    let is_date = param(property, "VALUE").is_some_and(|value| value.eq_ignore_ascii_case("DATE"))
        || (raw.len() == 8 && raw.bytes().all(|value| value.is_ascii_digit()));
    if is_date {
        let date = parse_date(raw)?;
        return Ok(TemporalValue::Date {
            value: date.format("%Y-%m-%d").to_string(),
            timezone: fallback_timezone.to_owned(),
        });
    }

    let timezone_name = param(property, "TZID").unwrap_or(fallback_timezone);
    let utc = if raw.ends_with('Z') {
        NaiveDateTime::parse_from_str(raw, "%Y%m%dT%H%M%SZ")
            .map_err(|_| SyncError::InvalidCalendar)?
            .and_utc()
    } else if let Ok(value) = DateTime::parse_from_str(raw, "%Y%m%dT%H%M%S%z") {
        value.with_timezone(&Utc)
    } else {
        let naive = NaiveDateTime::parse_from_str(raw, "%Y%m%dT%H%M%S")
            .map_err(|_| SyncError::InvalidCalendar)?;
        let timezone = parse_timezone(timezone_name)?;
        localize(naive, timezone)?
    };
    let display_timezone = if raw.ends_with('Z') {
        chrono_tz::UTC
    } else {
        parse_timezone(timezone_name)?
    };
    let local = utc.with_timezone(&display_timezone);
    Ok(TemporalValue::DateTime {
        utc: utc.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        local_date: local.format("%Y-%m-%d").to_string(),
        local_time: local.format("%H:%M").to_string(),
        timezone: display_timezone.name().to_owned(),
    })
}

fn temporal_shape(property: &Property) -> &'static str {
    let Some(raw) = property.value.as_deref() else {
        return "missing";
    };
    if raw.is_empty() {
        "empty"
    } else if raw.bytes().all(|value| value.is_ascii_digit()) {
        "numeric"
    } else if raw.contains('T') && raw.ends_with('Z') {
        "date_time_utc"
    } else if raw.contains('T') {
        "date_time"
    } else if raw
        .bytes()
        .all(|value| value.is_ascii_digit() || value == b'-')
    {
        "extended_date"
    } else {
        "other"
    }
}

fn sequence(properties: &[Property]) -> Option<i64> {
    raw_value(properties, "SEQUENCE")?.parse().ok()
}

fn is_cancelled(properties: &[Property]) -> bool {
    raw_value(properties, "STATUS").is_some_and(|value| value.eq_ignore_ascii_case("CANCELLED"))
}

fn course_evidence(properties: &[Property]) -> Option<CourseEvidence> {
    let provider_id = raw_value(properties, "X-CANVAS-COURSE-ID")
        .or_else(|| raw_value(properties, "X-COURSE-ID"))
        .map(str::to_owned)
        .or_else(|| {
            let url = raw_value(properties, "URL").and_then(|value| Url::parse(value).ok())?;
            let parts: Vec<_> = url.path_segments()?.collect();
            let index = parts.iter().position(|part| *part == "courses")?;
            parts.get(index + 1).map(|value| (*value).to_owned())
        })?;
    Some(CourseEvidence {
        external_id: external_id("ical-course:v1", &provider_id),
        name: value(properties, "X-CANVAS-COURSE-NAME")
            .or_else(|| value(properties, "X-COURSE-NAME")),
        code: value(properties, "X-CANVAS-COURSE-CODE"),
    })
}

fn canvas_assignment_evidence(properties: &[Property], component: &str) -> bool {
    if component == "VTODO" {
        return true;
    }
    let explicit_property = raw_value(properties, "X-CANVAS-ASSIGNMENT-ID").is_some()
        || raw_value(properties, "X-ASSIGNMENT-ID").is_some();
    let category = matching_properties(properties, "CATEGORIES")
        .filter_map(|property| property.value.as_deref())
        .flat_map(|value| value.split(','))
        .any(|value| value.trim().eq_ignore_ascii_case("ASSIGNMENT"));
    let assignment_url = raw_value(properties, "URL")
        .and_then(|value| Url::parse(value).ok())
        .is_some_and(|url| {
            url.host_str()
                .is_some_and(|host| host.eq_ignore_ascii_case(ALLOWED_HOST))
                && url
                    .path_segments()
                    .is_some_and(|mut parts| parts.any(|part| part == "assignments"))
        });
    let canvas_uid = raw_value(properties, "UID")
        .is_some_and(|uid| uid.starts_with("event-assignment-") || uid.starts_with("assignment-"));
    explicit_property || category || assignment_url || canvas_uid
}

fn is_exam(properties: &[Property]) -> bool {
    matching_properties(properties, "CATEGORIES")
        .filter_map(|property| property.value.as_deref())
        .flat_map(|value| value.split(','))
        .any(|value| matches!(value.trim().to_ascii_uppercase().as_str(), "EXAM" | "QUIZ"))
        || raw_value(properties, "X-CANVAS-QUIZ-ID").is_some()
}

#[derive(Debug)]
struct WeeklyRule {
    weekdays: Vec<u32>,
    ends_on: Option<String>,
}

fn weekday(value: &str) -> Option<u32> {
    match value.trim_start_matches(|character: char| {
        character == '+' || character == '-' || character.is_ascii_digit()
    }) {
        "SU" => Some(0),
        "MO" => Some(1),
        "TU" => Some(2),
        "WE" => Some(3),
        "TH" => Some(4),
        "FR" => Some(5),
        "SA" => Some(6),
        _ => None,
    }
}

fn parse_weekly_rule(raw: &str, start: &TemporalValue) -> Result<WeeklyRule, SyncError> {
    let mut fields = HashMap::new();
    for field in raw.split(';') {
        let (key, value) = field.split_once('=').ok_or(SyncError::InvalidCalendar)?;
        let key = key.to_ascii_uppercase();
        if key.is_empty() || value.is_empty() || fields.insert(key, value).is_some() {
            return Err(SyncError::InvalidCalendar);
        }
    }
    if fields.keys().any(|key| {
        !matches!(
            key.as_str(),
            "FREQ" | "INTERVAL" | "BYDAY" | "UNTIL" | "WKST"
        )
    }) {
        return Err(SyncError::InvalidCalendar);
    }
    if fields.get("FREQ") != Some(&"WEEKLY")
        || fields.get("INTERVAL").is_some_and(|value| *value != "1")
    {
        return Err(SyncError::InvalidCalendar);
    }
    if fields.contains_key("COUNT") {
        return Err(SyncError::InvalidCalendar);
    }
    if fields
        .get("WKST")
        .is_some_and(|value| weekday(value).is_none())
    {
        return Err(SyncError::InvalidCalendar);
    }
    let weekdays = if let Some(values) = fields.get("BYDAY") {
        if values.split(',').any(|value| {
            value
                .trim()
                .chars()
                .any(|character| character == '+' || character == '-' || character.is_ascii_digit())
        }) {
            return Err(SyncError::InvalidCalendar);
        }
        let parsed: Option<Vec<_>> = values.split(',').map(weekday).collect();
        parsed
            .filter(|value| !value.is_empty())
            .ok_or(SyncError::InvalidCalendar)?
    } else {
        let date = NaiveDate::parse_from_str(start.date(), "%Y-%m-%d")
            .map_err(|_| SyncError::InvalidCalendar)?;
        vec![date.weekday().num_days_from_sunday()]
    };
    let ends_on = fields
        .get("UNTIL")
        .map(|value| {
            let raw_date = value.get(0..8).ok_or(SyncError::InvalidCalendar)?;
            Ok(parse_date(raw_date)?.format("%Y-%m-%d").to_string())
        })
        .transpose()?;
    Ok(WeeklyRule { weekdays, ends_on })
}

fn parent_rule_id(uid: &str, weekday: u32) -> String {
    external_id("ical-rule:v1", &format!("{uid}\0{weekday}"))
}

fn safe_ical_name(value: &str, fallback: &str) -> String {
    let value = value
        .rsplit_once('.')
        .map_or(value, |(_, name)| name)
        .to_ascii_uppercase();
    if !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
    {
        value
    } else {
        fallback.to_owned()
    }
}

fn increment(map: &mut BTreeMap<String, usize>, key: impl Into<String>) {
    *map.entry(key.into()).or_default() += 1;
}

fn mark_unsupported(diagnostics: &mut IcalDiagnostics, reason: &str) {
    diagnostics.unsupported += 1;
    increment(&mut diagnostics.unsupported_reasons, reason);
}

fn recurrence_shape(raw: &str) -> &'static str {
    let mut frequency = None;
    let mut keys = HashSet::new();
    let mut malformed = false;
    for field in raw.split(';') {
        let Some((key, value)) = field.split_once('=') else {
            malformed = true;
            continue;
        };
        let key = key.to_ascii_uppercase();
        if key == "FREQ" {
            frequency = Some(value.to_ascii_uppercase());
        }
        keys.insert(key);
    }
    if malformed {
        return "malformed";
    }
    match frequency.as_deref() {
        Some("WEEKLY")
            if keys.iter().all(|key| {
                matches!(
                    key.as_str(),
                    "FREQ" | "INTERVAL" | "BYDAY" | "UNTIL" | "WKST"
                )
            }) =>
        {
            "weekly_simple"
        }
        Some("WEEKLY") => "weekly_complex",
        Some("DAILY") => "daily",
        Some("MONTHLY") => "monthly",
        Some("YEARLY") => "yearly",
        Some(_) => "other_frequency",
        None => "missing_frequency",
    }
}

fn lexical_diagnostics(bytes: &[u8]) -> IcalDiagnostics {
    let mut diagnostics = IcalDiagnostics::default();
    for raw_line in bytes.split(|byte| *byte == b'\n') {
        let raw_line = raw_line.strip_suffix(b"\r").unwrap_or(raw_line);
        if raw_line
            .first()
            .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
        {
            continue;
        }
        let line = String::from_utf8_lossy(raw_line);
        let Some((head, value)) = line.split_once(':') else {
            continue;
        };
        let raw_property_name = safe_ical_name(head.split(';').next().unwrap_or_default(), "OTHER");
        if raw_property_name == "BEGIN" {
            let raw_component = safe_ical_name(value.trim(), "OTHER-COMPONENT");
            let component = match raw_component.as_str() {
                "VCALENDAR" | "VEVENT" | "VTODO" | "VTIMEZONE" | "STANDARD" | "DAYLIGHT"
                | "VALARM" | "VJOURNAL" | "VFREEBUSY" => raw_component,
                _ => "AUXILIARY".to_owned(),
            };
            increment(&mut diagnostics.component_counts, component);
            continue;
        }
        if raw_property_name == "END" {
            continue;
        }
        let property_name = match raw_property_name.as_str() {
            "VERSION" | "PRODID" | "CALSCALE" | "METHOD" | "UID" | "DTSTAMP" | "CREATED"
            | "LAST-MODIFIED" | "SEQUENCE" | "DTSTART" | "DTEND" | "DUE" | "DURATION" | "RRULE"
            | "RDATE" | "EXDATE" | "RECURRENCE-ID" | "STATUS" | "SUMMARY" | "DESCRIPTION"
            | "LOCATION" | "URL" | "CATEGORIES" | "CLASS" | "TRANSP" | "PRIORITY"
            | "PERCENT-COMPLETE" | "COMPLETED" | "ORGANIZER" | "ATTENDEE" | "ACTION"
            | "TRIGGER" | "TZID" | "TZNAME" | "TZOFFSETFROM" | "TZOFFSETTO" => raw_property_name,
            value if value.starts_with("X-") => "X-*".to_owned(),
            _ => "OTHER".to_owned(),
        };
        increment(&mut diagnostics.property_counts, property_name.clone());
        if matches!(
            property_name.as_str(),
            "DTSTART" | "DTEND" | "DUE" | "RECURRENCE-ID" | "EXDATE"
        ) {
            let is_date = head
                .split(';')
                .skip(1)
                .any(|parameter| parameter.eq_ignore_ascii_case("VALUE=DATE"))
                || (value.trim().len() == 8
                    && value.trim().bytes().all(|byte| byte.is_ascii_digit()));
            if is_date {
                diagnostics.date_values += 1;
            } else {
                diagnostics.date_time_values += 1;
            }
        }
        if property_name == "RRULE" {
            increment(
                &mut diagnostics.recurrence_shapes,
                recurrence_shape(value.trim()),
            );
        }
    }
    diagnostics.calendars = diagnostics
        .component_counts
        .get("VCALENDAR")
        .copied()
        .unwrap_or_default();
    diagnostics.vevents = diagnostics
        .component_counts
        .get("VEVENT")
        .copied()
        .unwrap_or_default();
    diagnostics.vtodos = diagnostics
        .component_counts
        .get("VTODO")
        .copied()
        .unwrap_or_default();
    diagnostics.total_items = diagnostics.vevents + diagnostics.vtodos;
    diagnostics.property_names = diagnostics.property_counts.keys().cloned().collect();
    diagnostics
}

fn filtered_calendar_bytes(bytes: &[u8], diagnostics: &mut IcalDiagnostics) -> Vec<u8> {
    const KNOWN_COMPONENTS: &[&str] = &[
        "VCALENDAR",
        "VEVENT",
        "VTODO",
        "VJOURNAL",
        "VFREEBUSY",
        "VTIMEZONE",
        "STANDARD",
        "DAYLIGHT",
        "VALARM",
    ];
    let mut output = Vec::with_capacity(bytes.len());
    let mut skipped_depth = 0usize;
    for raw_line in bytes.split(|byte| *byte == b'\n') {
        let line_without_cr = raw_line.strip_suffix(b"\r").unwrap_or(raw_line);
        let text = String::from_utf8_lossy(line_without_cr);
        let component = text
            .strip_prefix("BEGIN:")
            .map(|value| safe_ical_name(value.trim(), "OTHER-COMPONENT"));
        let is_end = text.starts_with("END:");
        if skipped_depth > 0 {
            if component.is_some() {
                skipped_depth += 1;
            } else if is_end {
                skipped_depth -= 1;
            }
            continue;
        }
        if let Some(component) = component {
            if !KNOWN_COMPONENTS.contains(&component.as_str()) {
                skipped_depth = 1;
                increment(
                    &mut diagnostics.unsupported_reasons,
                    "auxiliary_component_ignored",
                );
                continue;
            }
        }
        output.extend_from_slice(line_without_cr);
        output.extend_from_slice(b"\r\n");
    }
    output
}

fn normalize_component(
    component: &str,
    properties: &[Property],
    fallback_timezone: &str,
    base_rules: &HashMap<String, WeeklyRule>,
    diagnostics: &mut IcalDiagnostics,
) -> Result<Vec<NormalizedItem>, &'static str> {
    let uid = match raw_value(properties, "UID") {
        Some(value) if !value.is_empty() => value,
        _ => {
            mark_unsupported(diagnostics, "missing_uid");
            return Ok(Vec::new());
        }
    };
    let base_external_id = external_id("ical:v1", uid);
    let recurrence_id = property(properties, "RECURRENCE-ID");
    let rrule = raw_value(properties, "RRULE");

    if let Some(recurrence_id) = recurrence_id {
        let original =
            temporal(recurrence_id, fallback_timezone).map_err(|_| "invalid_recurrence_id")?;
        let weekday = NaiveDate::parse_from_str(original.date(), "%Y-%m-%d")
            .map_err(|_| "invalid_recurrence_id")?
            .weekday()
            .num_days_from_sunday();
        if !base_rules
            .get(uid)
            .is_some_and(|rule| rule.weekdays.contains(&weekday))
        {
            mark_unsupported(diagnostics, "recurrence_parent_unsupported");
            return Ok(Vec::new());
        }
        let cancelled = is_cancelled(properties);
        let start = property(properties, "DTSTART")
            .map(|property| temporal(property, fallback_timezone))
            .transpose()
            .map_err(|_| "invalid_dtstart")?;
        let end = property(properties, "DTEND")
            .map(|property| temporal(property, fallback_timezone))
            .transpose()
            .map_err(|_| "invalid_dtend")?;
        let exception = NormalizedException {
            external_id: external_id("ical-exception:v1", &format!("{uid}\0{}", original.date())),
            rule_external_id: parent_rule_id(uid, weekday),
            occurrence_on: original.date().to_owned(),
            status: if cancelled { "cancelled" } else { "moved" }.into(),
            replacement_start: match start {
                Some(TemporalValue::DateTime { utc, .. }) => Some(utc),
                _ => None,
            },
            replacement_end: match end {
                Some(TemporalValue::DateTime { utc, .. }) => Some(utc),
                _ => None,
            },
            title_override: value(properties, "SUMMARY"),
            location_override: value(properties, "LOCATION"),
            sequence: sequence(properties),
        };
        if !cancelled && exception.replacement_start.is_none() {
            mark_unsupported(diagnostics, "recurrence_override_missing_start");
            return Ok(Vec::new());
        }
        diagnostics.schedule_exceptions += 1;
        if cancelled {
            diagnostics.cancellations += 1;
        }
        return Ok(vec![NormalizedItem::Exception(exception)]);
    }

    if let Some(raw_rule) = rrule {
        let start_property = property(properties, "DTSTART").ok_or("recurrence_missing_start")?;
        let end_property = property(properties, "DTEND").ok_or("recurrence_missing_end")?;
        let start = temporal(start_property, fallback_timezone).map_err(|_| "invalid_dtstart")?;
        let end = temporal(end_property, fallback_timezone).map_err(|_| "invalid_dtend")?;
        if matches!(start, TemporalValue::Date { .. }) || matches!(end, TemporalValue::Date { .. })
        {
            mark_unsupported(diagnostics, "recurrence_date_value");
            return Ok(Vec::new());
        }
        let rule = match parse_weekly_rule(raw_rule, &start) {
            Ok(value) => value,
            Err(_) => {
                mark_unsupported(diagnostics, "unsupported_recurrence");
                return Ok(Vec::new());
            }
        };
        let Some(course) = course_evidence(properties)
            .filter(|course| course.name.is_some() || course.code.is_some())
        else {
            mark_unsupported(diagnostics, "recurrence_missing_course");
            return Ok(Vec::new());
        };
        if is_cancelled(properties) {
            diagnostics.cancellations += rule.weekdays.len();
            return Ok(rule
                .weekdays
                .into_iter()
                .map(|weekday| NormalizedItem::Cancel {
                    external_id: parent_rule_id(uid, weekday),
                    sequence: sequence(properties),
                })
                .collect());
        }
        let mut items = Vec::new();
        for weekday in rule.weekdays.iter().copied() {
            items.push(NormalizedItem::Rule(NormalizedRule {
                external_id: parent_rule_id(uid, weekday),
                parent_uid_hash: base_external_id.clone(),
                weekday,
                starts_on: start.date().to_owned(),
                ends_on: rule.ends_on.clone(),
                start: start.clone(),
                end: end.clone(),
                location: value(properties, "LOCATION"),
                course: course.clone(),
                sequence: sequence(properties),
            }));
        }
        for exdate in matching_properties(properties, "EXDATE") {
            for raw in exdate.value.as_deref().unwrap_or_default().split(',') {
                let mut property = exdate.clone();
                property.value = Some(raw.to_owned());
                let original =
                    temporal(&property, fallback_timezone).map_err(|_| "invalid_exdate")?;
                let weekday = NaiveDate::parse_from_str(original.date(), "%Y-%m-%d")
                    .map_err(|_| "invalid_exdate")?
                    .weekday()
                    .num_days_from_sunday();
                if !rule.weekdays.contains(&weekday) {
                    continue;
                }
                items.push(NormalizedItem::Exception(NormalizedException {
                    external_id: external_id(
                        "ical-exception:v1",
                        &format!("{uid}\0{}", original.date()),
                    ),
                    rule_external_id: parent_rule_id(uid, weekday),
                    occurrence_on: original.date().to_owned(),
                    status: "cancelled".into(),
                    replacement_start: None,
                    replacement_end: None,
                    title_override: None,
                    location_override: None,
                    sequence: sequence(properties),
                }));
                diagnostics.schedule_exceptions += 1;
                diagnostics.cancellations += 1;
            }
        }
        diagnostics.recurring_rules += items
            .iter()
            .filter(|item| matches!(item, NormalizedItem::Rule(_)))
            .count();
        return Ok(items);
    }

    if is_cancelled(properties) {
        diagnostics.cancellations += 1;
        return Ok(vec![NormalizedItem::Cancel {
            external_id: base_external_id,
            sequence: sequence(properties),
        }]);
    }

    let title = value(properties, "SUMMARY").unwrap_or_else(|| "e-Campus 일정".into());
    let description = value(properties, "DESCRIPTION");
    let course = course_evidence(properties);
    if canvas_assignment_evidence(properties, component) {
        let due_property = property(properties, "DUE").or_else(|| property(properties, "DTSTART"));
        let due = due_property
            .map(|property| temporal(property, fallback_timezone))
            .transpose()
            .map_err(|_| {
                if due_property.is_some_and(|property| {
                    param(property, "VALUE").is_some_and(|value| value.eq_ignore_ascii_case("DATE"))
                }) {
                    match due_property.map(temporal_shape) {
                        Some("missing") => "invalid_due_date_missing",
                        Some("empty") => "invalid_due_date_empty",
                        Some("numeric") => "invalid_due_date_numeric",
                        Some("date_time_utc") => "invalid_due_date_time_utc",
                        Some("date_time") => "invalid_due_date_time",
                        Some("extended_date") => "invalid_due_date_extended",
                        _ => "invalid_due_date_other",
                    }
                } else {
                    "invalid_due_date_time_value"
                }
            })?;
        diagnostics.assignments += 1;
        return Ok(vec![NormalizedItem::Assignment(NormalizedAssignment {
            external_id: base_external_id,
            title,
            description,
            due,
            course,
            sequence: sequence(properties),
        })]);
    }

    let start_property = property(properties, "DTSTART").ok_or("missing_dtstart")?;
    let start = temporal(start_property, fallback_timezone).map_err(|_| "invalid_dtstart")?;
    let end = property(properties, "DTEND")
        .map(|property| temporal(property, fallback_timezone))
        .transpose()
        .map_err(|_| "invalid_dtend")?;
    if end
        .as_ref()
        .is_some_and(|end| !valid_temporal_range(&start, end))
    {
        return Err("invalid_event_range");
    }
    diagnostics.events += 1;
    Ok(vec![NormalizedItem::Event(NormalizedEvent {
        external_id: base_external_id,
        title,
        description,
        start,
        end,
        location: value(properties, "LOCATION"),
        event_type: if is_exam(properties) {
            "exam"
        } else {
            "meeting"
        }
        .into(),
        course,
        sequence: sequence(properties),
    })])
}

fn parse_calendar(bytes: &[u8]) -> Result<NormalizedSnapshot, SyncError> {
    let bytes = calendar_payload(bytes);
    let mut snapshot = NormalizedSnapshot {
        diagnostics: lexical_diagnostics(bytes),
        ..Default::default()
    };
    let filtered = filtered_calendar_bytes(bytes, &mut snapshot.diagnostics);
    let reader = BufReader::new(Cursor::new(filtered));
    let mut candidates: HashMap<String, (i64, String, NormalizedItem)> = HashMap::new();
    let mut blocked_ids = HashSet::new();
    for calendar in IcalParser::new(reader) {
        let calendar = calendar.map_err(|_| SyncError::InvalidCalendar)?;
        let fallback_timezone = raw_value(&calendar.properties, "X-WR-TIMEZONE")
            .filter(|value| Tz::from_str(value).is_ok())
            .unwrap_or(SOURCE_TIMEZONE);
        let mut base_rules = HashMap::new();
        for event in &calendar.events {
            if raw_value(&event.properties, "RECURRENCE-ID").is_none() {
                if let (Some(uid), Some(rrule), Some(start_property)) = (
                    raw_value(&event.properties, "UID"),
                    raw_value(&event.properties, "RRULE"),
                    property(&event.properties, "DTSTART"),
                ) {
                    if let Ok(start) = temporal(start_property, fallback_timezone) {
                        if let Ok(rule) = parse_weekly_rule(rrule, &start) {
                            base_rules.insert(uid.to_owned(), rule);
                        }
                    }
                }
            }
        }
        for (component, properties) in calendar
            .events
            .iter()
            .map(|value| ("VEVENT", value.properties.as_slice()))
            .chain(
                calendar
                    .todos
                    .iter()
                    .map(|value| ("VTODO", value.properties.as_slice())),
            )
        {
            let normalized = normalize_component(
                component,
                properties,
                fallback_timezone,
                &base_rules,
                &mut snapshot.diagnostics,
            );
            let items = match normalized {
                Ok(items) => items,
                Err(reason) => {
                    mark_unsupported(&mut snapshot.diagnostics, reason);
                    continue;
                }
            };
            for item in items {
                let key = item.external_id().to_owned();
                if blocked_ids.contains(&key) {
                    continue;
                }
                let sequence = item.sequence().unwrap_or_default();
                let hash = item.content_hash();
                match candidates.get(&key) {
                    Some((existing_sequence, existing_hash, _))
                        if *existing_sequence > sequence => {}
                    Some((existing_sequence, existing_hash, _))
                        if *existing_sequence == sequence && existing_hash != &hash =>
                    {
                        candidates.remove(&key);
                        blocked_ids.insert(key);
                        mark_unsupported(&mut snapshot.diagnostics, "duplicate_identity_conflict");
                    }
                    _ => {
                        candidates.insert(key, (sequence, hash, item));
                    }
                }
            }
        }
    }
    if snapshot.diagnostics.calendars == 0 {
        return Err(SyncError::InvalidCalendar);
    }
    snapshot.items = candidates.into_values().map(|(_, _, item)| item).collect();
    snapshot.items.sort_by(|left, right| {
        let rank = |item: &NormalizedItem| match item {
            NormalizedItem::Rule(_) => 0,
            NormalizedItem::Event(_) | NormalizedItem::Assignment(_) => 1,
            NormalizedItem::Exception(_) => 2,
            NormalizedItem::Cancel { .. } => 3,
        };
        rank(left)
            .cmp(&rank(right))
            .then_with(|| left.external_id().cmp(right.external_id()))
    });
    Ok(snapshot)
}

async fn resolve_course(
    transaction: &mut Transaction<'_, Sqlite>,
    course: Option<&CourseEvidence>,
    generation: i64,
    now: &str,
) -> Result<Option<String>, SyncError> {
    let Some(course) = course else {
        return Ok(None);
    };
    if let Some(row) = sqlx::query(
        "SELECT course_id FROM external_sync_items WHERE source_id=?1 AND external_id=?2 AND entity_kind='course'",
    )
    .bind(SOURCE_ID)
    .bind(&course.external_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SyncError::Database)?
    {
        return Ok(row.get("course_id"));
    }
    let existing = if let Some(code) = &course.code {
        sqlx::query_scalar::<_, String>("SELECT id FROM courses WHERE code=?1 LIMIT 2")
            .bind(code)
            .fetch_all(&mut **transaction)
            .await
            .map_err(|_| SyncError::Database)?
    } else if let Some(name) = &course.name {
        sqlx::query_scalar::<_, String>("SELECT id FROM courses WHERE name=?1 LIMIT 2")
            .bind(name)
            .fetch_all(&mut **transaction)
            .await
            .map_err(|_| SyncError::Database)?
    } else {
        Vec::new()
    };
    let course_id = if existing.len() == 1 {
        existing[0].clone()
    } else if let Some(name) = &course.name {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO courses (id, source_id, external_id, name, code, location, color_token, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6)",
        )
        .bind(&id)
        .bind(SOURCE_ID)
        .bind(&course.external_id)
        .bind(name)
        .bind(&course.code)
        .bind(now)
        .execute(&mut **transaction)
        .await
        .map_err(|_| SyncError::Database)?;
        id
    } else {
        return Ok(None);
    };
    let hash = digest(serde_json::to_string(course).unwrap().as_bytes());
    sqlx::query(
        "INSERT INTO external_sync_items \
         (source_id, external_id, entity_kind, course_id, content_hash, last_seen_generation, first_seen_at, last_seen_at) \
         VALUES (?1, ?2, 'course', ?3, ?4, ?5, ?6, ?6)",
    )
    .bind(SOURCE_ID)
    .bind(&course.external_id)
    .bind(&course_id)
    .bind(hash)
    .bind(generation)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SyncError::Database)?;
    Ok(Some(course_id))
}

#[derive(Debug)]
struct ExistingItem {
    kind: String,
    content_hash: String,
    entity_id: Option<String>,
    sequence: Option<i64>,
    explicitly_cancelled: bool,
}

async fn existing_item(
    transaction: &mut Transaction<'_, Sqlite>,
    external_id: &str,
) -> Result<Option<ExistingItem>, SyncError> {
    let row = sqlx::query(
        "SELECT entity_kind, content_hash, COALESCE(event_id, assignment_id, recurring_rule_id, schedule_exception_id, course_id) entity_id, remote_sequence, explicitly_cancelled \
         FROM external_sync_items WHERE source_id=?1 AND external_id=?2",
    )
    .bind(SOURCE_ID)
    .bind(external_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SyncError::Database)?;
    Ok(row.map(|row| ExistingItem {
        kind: row.get("entity_kind"),
        content_hash: row.get("content_hash"),
        entity_id: row.get("entity_id"),
        sequence: row.get("remote_sequence"),
        explicitly_cancelled: row.get::<i64, _>("explicitly_cancelled") != 0,
    }))
}

fn temporal_event_fields(
    value: &TemporalValue,
) -> Result<(String, &str, Option<&str>, &str), SyncError> {
    match value {
        TemporalValue::Date { value, timezone } => {
            let timezone_value = Tz::from_str(timezone).map_err(|_| SyncError::InvalidCalendar)?;
            let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| SyncError::InvalidCalendar)?;
            let utc = localize(
                date.and_hms_opt(0, 0, 0)
                    .ok_or(SyncError::InvalidCalendar)?,
                timezone_value,
            )?;
            Ok((
                utc.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                "date",
                Some(value),
                timezone,
            ))
        }
        TemporalValue::DateTime { utc, timezone, .. } => {
            Ok((utc.clone(), "date_time", None, timezone))
        }
    }
}

async fn apply_snapshot(
    pool: &SqlitePool,
    snapshot: NormalizedSnapshot,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<IcalSyncResult, SyncError> {
    let NormalizedSnapshot {
        items,
        mut diagnostics,
    } = snapshot;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut transaction = pool.begin().await.map_err(|_| SyncError::Database)?;
    let generation: i64 =
        sqlx::query_scalar("SELECT sync_generation + 1 FROM source_sync_states WHERE source_id=?1")
            .bind(SOURCE_ID)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| SyncError::Database)?;
    let mut inserted = 0;
    let mut updated = 0;
    let mut unchanged = 0;

    for item in &items {
        let content_hash = item.content_hash();
        let mut existing = existing_item(&mut transaction, item.external_id()).await?;
        if let Some(value) = &existing {
            let incoming_sequence = item.sequence().unwrap_or_default();
            let existing_sequence = value.sequence.unwrap_or_default();
            let incoming_is_cancel = matches!(item, NormalizedItem::Cancel { .. });
            if incoming_sequence < existing_sequence
                || (value.explicitly_cancelled
                    && !incoming_is_cancel
                    && incoming_sequence <= existing_sequence)
            {
                sqlx::query(
                    "UPDATE external_sync_items SET last_seen_generation=?1, last_seen_at=?2 WHERE source_id=?3 AND external_id=?4",
                )
                .bind(generation)
                .bind(&now)
                .bind(SOURCE_ID)
                .bind(item.external_id())
                .execute(&mut *transaction)
                .await
                .map_err(|_| SyncError::Database)?;
                unchanged += 1;
                continue;
            }
            let next_kind = match item {
                NormalizedItem::Event(_) => "event",
                NormalizedItem::Assignment(_) => "assignment",
                NormalizedItem::Rule(_) => "recurring_rule",
                NormalizedItem::Exception(_) => "schedule_exception",
                NormalizedItem::Cancel { .. } => value.kind.as_str(),
            };
            if value.kind != next_kind && value.kind != "unsupported" {
                if let Some(id) = &value.entity_id {
                    match value.kind.as_str() {
                        "event" => {
                            sqlx::query("UPDATE events SET source_removed_at=?1, updated_at=?1 WHERE id=?2 AND source_id=?3")
                                .bind(&now).bind(id).bind(SOURCE_ID).execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                        }
                        "assignment" => {
                            sqlx::query("UPDATE assignments SET source_removed_at=?1, updated_at=?1 WHERE id=?2 AND source_id=?3")
                                .bind(&now).bind(id).bind(SOURCE_ID).execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                        }
                        "recurring_rule" => {
                            sqlx::query("UPDATE recurring_schedule_rules SET source_removed_at=?1, updated_at=?1 WHERE id=?2 AND source_id=?3")
                                .bind(&now).bind(id).bind(SOURCE_ID).execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                        }
                        _ => return Err(SyncError::InvalidCalendar),
                    }
                }
                existing = None;
            }
            if existing
                .as_ref()
                .is_some_and(|existing| existing.content_hash == content_hash)
            {
                sqlx::query(
                    "UPDATE external_sync_items SET last_seen_generation=?1, last_seen_at=?2 WHERE source_id=?3 AND external_id=?4",
                )
                .bind(generation)
                .bind(&now)
                .bind(SOURCE_ID)
                .bind(item.external_id())
                .execute(&mut *transaction)
                .await
                .map_err(|_| SyncError::Database)?;
                unchanged += 1;
                continue;
            }
        }

        match item {
            NormalizedItem::Event(event) => {
                let course_id =
                    resolve_course(&mut transaction, event.course.as_ref(), generation, &now)
                        .await?;
                let (start_at, time_kind, start_on, timezone) =
                    temporal_event_fields(&event.start)?;
                let (end_at, end_on_exclusive) = match &event.end {
                    Some(TemporalValue::DateTime { utc, .. }) => (Some(utc.clone()), None),
                    Some(TemporalValue::Date { value, .. }) => (None, Some(value.as_str())),
                    None => (None, None),
                };
                let id = existing
                    .as_ref()
                    .and_then(|value| value.entity_id.clone())
                    .or(sqlx::query_scalar::<_, String>(
                        "SELECT id FROM events WHERE source_id=?1 AND external_id=?2",
                    )
                    .bind(SOURCE_ID)
                    .bind(&event.external_id)
                    .fetch_optional(&mut *transaction)
                    .await
                    .map_err(|_| SyncError::Database)?)
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                sqlx::query(
                    "INSERT INTO events (id, source_id, course_id, external_id, event_type, title, start_at, end_at, location, is_fixed, notes, created_at, updated_at, time_kind, start_on, end_on_exclusive, source_timezone, source_cancelled_at, source_removed_at, source_content_hash, last_seen_sync_generation) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11, ?11, ?12, ?13, ?14, ?15, NULL, NULL, ?16, ?17) \
                     ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, event_type=excluded.event_type, title=excluded.title, start_at=excluded.start_at, end_at=excluded.end_at, location=excluded.location, notes=excluded.notes, updated_at=excluded.updated_at, time_kind=excluded.time_kind, start_on=excluded.start_on, end_on_exclusive=excluded.end_on_exclusive, source_timezone=excluded.source_timezone, source_cancelled_at=NULL, source_removed_at=NULL, source_content_hash=excluded.source_content_hash, last_seen_sync_generation=excluded.last_seen_sync_generation",
                )
                .bind(&id).bind(SOURCE_ID).bind(course_id).bind(&event.external_id).bind(&event.event_type)
                .bind(&event.title).bind(start_at).bind(end_at).bind(&event.location).bind(&event.description)
                .bind(&now).bind(time_kind).bind(start_on).bind(end_on_exclusive).bind(timezone)
                .bind(&content_hash).bind(generation)
                .execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                upsert_ledger(
                    &mut transaction,
                    LedgerWrite {
                        external_id: &event.external_id,
                        kind: "event",
                        entity_id: &id,
                        content_hash: &content_hash,
                        sequence: event.sequence,
                        generation,
                        cancelled: false,
                        now: &now,
                    },
                )
                .await?;
            }
            NormalizedItem::Assignment(assignment) => {
                let course_id = resolve_course(
                    &mut transaction,
                    assignment.course.as_ref(),
                    generation,
                    &now,
                )
                .await?;
                let (due_at, due_on, due_timezone) = match &assignment.due {
                    Some(TemporalValue::DateTime { utc, timezone, .. }) => {
                        (Some(utc.as_str()), None, Some(timezone.as_str()))
                    }
                    Some(TemporalValue::Date { value, timezone }) => {
                        (None, Some(value.as_str()), Some(timezone.as_str()))
                    }
                    None => (None, None, None),
                };
                let id = existing
                    .as_ref()
                    .and_then(|value| value.entity_id.clone())
                    .or(sqlx::query_scalar::<_, String>(
                        "SELECT id FROM assignments WHERE source_id=?1 AND external_id=?2",
                    )
                    .bind(SOURCE_ID)
                    .bind(&assignment.external_id)
                    .fetch_optional(&mut *transaction)
                    .await
                    .map_err(|_| SyncError::Database)?)
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                sqlx::query(
                    "INSERT INTO assignments (id, source_id, course_id, external_id, title, description, due_at, points, submission_type, status, submitted_at, graded_at, created_at, updated_at, due_on, due_timezone, source_removed_at, source_content_hash, last_seen_sync_generation) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 'open', NULL, NULL, ?8, ?8, ?9, ?10, NULL, ?11, ?12) \
                     ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, title=excluded.title, description=excluded.description, due_at=excluded.due_at, status='open', updated_at=excluded.updated_at, due_on=excluded.due_on, due_timezone=excluded.due_timezone, source_removed_at=NULL, source_content_hash=excluded.source_content_hash, last_seen_sync_generation=excluded.last_seen_sync_generation",
                )
                .bind(&id).bind(SOURCE_ID).bind(course_id).bind(&assignment.external_id).bind(&assignment.title)
                .bind(&assignment.description).bind(due_at).bind(&now).bind(due_on).bind(due_timezone)
                .bind(&content_hash).bind(generation)
                .execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                upsert_ledger(
                    &mut transaction,
                    LedgerWrite {
                        external_id: &assignment.external_id,
                        kind: "assignment",
                        entity_id: &id,
                        content_hash: &content_hash,
                        sequence: assignment.sequence,
                        generation,
                        cancelled: false,
                        now: &now,
                    },
                )
                .await?;
            }
            NormalizedItem::Rule(rule) => {
                let semester = sqlx::query("SELECT id, starts_on, ends_on, timezone FROM semesters WHERE starts_on<=?1 AND ends_on>=?1 ORDER BY starts_on DESC LIMIT 1")
                    .bind(&rule.starts_on).fetch_optional(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                let Some(semester) = semester else {
                    diagnostics.recurring_rules = diagnostics.recurring_rules.saturating_sub(1);
                    mark_unsupported(&mut diagnostics, "recurrence_outside_semester");
                    continue;
                };
                let semester_id: String = semester.get("id");
                let semester_start: String = semester.get("starts_on");
                let semester_end: String = semester.get("ends_on");
                let semester_timezone: String = semester.get("timezone");
                let timezone =
                    Tz::from_str(&semester_timezone).map_err(|_| SyncError::InvalidCalendar)?;
                let to_local = |value: &TemporalValue| -> Result<(String, String), SyncError> {
                    let TemporalValue::DateTime { utc, .. } = value else {
                        return Err(SyncError::InvalidCalendar);
                    };
                    let instant = DateTime::parse_from_rfc3339(utc)
                        .map_err(|_| SyncError::InvalidCalendar)?
                        .with_timezone(&timezone);
                    Ok((
                        instant.format("%Y-%m-%d").to_string(),
                        instant.format("%H:%M").to_string(),
                    ))
                };
                let (local_start_date, start_time) = to_local(&rule.start)?;
                let (local_end_date, end_time) = to_local(&rule.end)?;
                if local_start_date != local_end_date || end_time <= start_time {
                    diagnostics.recurring_rules = diagnostics.recurring_rules.saturating_sub(1);
                    mark_unsupported(&mut diagnostics, "invalid_recurrence_duration");
                    continue;
                }
                let starts_on = std::cmp::max(rule.starts_on.clone(), semester_start);
                let ends_on = std::cmp::min(
                    rule.ends_on.clone().unwrap_or_else(|| semester_end.clone()),
                    semester_end,
                );
                if ends_on < starts_on {
                    diagnostics.recurring_rules = diagnostics.recurring_rules.saturating_sub(1);
                    mark_unsupported(&mut diagnostics, "recurrence_outside_semester");
                    continue;
                }
                let Some(course_id) =
                    resolve_course(&mut transaction, Some(&rule.course), generation, &now).await?
                else {
                    diagnostics.recurring_rules = diagnostics.recurring_rules.saturating_sub(1);
                    mark_unsupported(&mut diagnostics, "recurrence_course_unmapped");
                    continue;
                };
                let natural_id: Option<String> = sqlx::query_scalar(
                    "SELECT id FROM recurring_schedule_rules WHERE semester_id=?1 AND course_id=?2 AND weekday=?3 AND start_local_time=?4 AND end_local_time=?5 AND ifnull(location, '')=ifnull(?6, '') LIMIT 1",
                )
                .bind(&semester_id).bind(&course_id).bind(rule.weekday as i64).bind(&start_time)
                .bind(&end_time).bind(&rule.location).fetch_optional(&mut *transaction)
                .await.map_err(|_| SyncError::Database)?;
                let existing_id = existing.as_ref().and_then(|value| value.entity_id.clone());
                let existing_is_provider_owned = if let Some(id) = &existing_id {
                    sqlx::query_scalar::<_, Option<String>>(
                        "SELECT source_id FROM recurring_schedule_rules WHERE id=?1",
                    )
                    .bind(id)
                    .fetch_optional(&mut *transaction)
                    .await
                    .map_err(|_| SyncError::Database)?
                    .flatten()
                    .is_some_and(|source_id| source_id == SOURCE_ID)
                } else {
                    false
                };
                let candidate_id = match (&existing_id, &natural_id) {
                    (Some(existing_id), Some(natural_id)) if existing_id != natural_id => {
                        if existing_is_provider_owned {
                            sqlx::query(
                                "UPDATE recurring_schedule_rules SET source_removed_at=?1, updated_at=?1 WHERE id=?2 AND source_id=?3",
                            )
                            .bind(&now)
                            .bind(existing_id)
                            .bind(SOURCE_ID)
                            .execute(&mut *transaction)
                            .await
                            .map_err(|_| SyncError::Database)?;
                        }
                        Some(natural_id.clone())
                    }
                    (Some(existing_id), _) if existing_is_provider_owned => {
                        Some(existing_id.clone())
                    }
                    (_, Some(natural_id)) => Some(natural_id.clone()),
                    _ => None,
                };
                let candidate_is_provider_owned = if let Some(id) = &candidate_id {
                    sqlx::query_scalar::<_, Option<String>>(
                        "SELECT source_id FROM recurring_schedule_rules WHERE id=?1",
                    )
                    .bind(id)
                    .fetch_optional(&mut *transaction)
                    .await
                    .map_err(|_| SyncError::Database)?
                    .flatten()
                    .is_some_and(|source_id| source_id == SOURCE_ID)
                } else {
                    false
                };
                let reuses_manual_rule = candidate_id.is_some() && !candidate_is_provider_owned;
                let id = if reuses_manual_rule {
                    candidate_id.expect("manual rule candidate exists")
                } else {
                    candidate_id.unwrap_or_else(|| Uuid::new_v4().to_string())
                };
                if !reuses_manual_rule {
                    sqlx::query(
                        "INSERT INTO recurring_schedule_rules (id, semester_id, course_id, source_id, external_id, weekday, start_local_time, end_local_time, location, created_at, updated_at, starts_on, ends_on, source_cancelled_at, source_removed_at, source_content_hash, last_seen_sync_generation) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?12, NULL, NULL, ?13, ?14) \
                         ON CONFLICT(id) DO UPDATE SET semester_id=excluded.semester_id, course_id=excluded.course_id, weekday=excluded.weekday, start_local_time=excluded.start_local_time, end_local_time=excluded.end_local_time, location=excluded.location, updated_at=excluded.updated_at, starts_on=excluded.starts_on, ends_on=excluded.ends_on, source_cancelled_at=NULL, source_removed_at=NULL, source_content_hash=excluded.source_content_hash, last_seen_sync_generation=excluded.last_seen_sync_generation",
                    )
                    .bind(&id).bind(&semester_id).bind(&course_id).bind(SOURCE_ID).bind(&rule.external_id)
                    .bind(rule.weekday as i64).bind(&start_time).bind(&end_time).bind(&rule.location).bind(&now)
                    .bind(&starts_on).bind(&ends_on).bind(&content_hash).bind(generation)
                    .execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                }
                upsert_ledger(
                    &mut transaction,
                    LedgerWrite {
                        external_id: &rule.external_id,
                        kind: "recurring_rule",
                        entity_id: &id,
                        content_hash: &content_hash,
                        sequence: rule.sequence,
                        generation,
                        cancelled: false,
                        now: &now,
                    },
                )
                .await?;
            }
            NormalizedItem::Exception(exception) => {
                let rule_id: Option<String> = sqlx::query_scalar(
                    "SELECT recurring_rule_id FROM external_sync_items WHERE source_id=?1 AND external_id=?2 AND entity_kind='recurring_rule'",
                )
                .bind(SOURCE_ID).bind(&exception.rule_external_id)
                .fetch_optional(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                let Some(rule_id) = rule_id else {
                    diagnostics.schedule_exceptions =
                        diagnostics.schedule_exceptions.saturating_sub(1);
                    mark_unsupported(&mut diagnostics, "recurrence_parent_unmapped");
                    continue;
                };
                let id = existing
                    .as_ref()
                    .and_then(|value| value.entity_id.clone())
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                sqlx::query(
                    "INSERT INTO recurring_schedule_exceptions (id, recurring_rule_id, source_id, external_id, occurrence_on, status, replacement_start_at, replacement_end_at, title_override, location_override, notes, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?11) \
                     ON CONFLICT(id) DO UPDATE SET recurring_rule_id=excluded.recurring_rule_id, occurrence_on=excluded.occurrence_on, status=excluded.status, replacement_start_at=excluded.replacement_start_at, replacement_end_at=excluded.replacement_end_at, title_override=excluded.title_override, location_override=excluded.location_override, updated_at=excluded.updated_at",
                )
                .bind(&id).bind(rule_id).bind(SOURCE_ID).bind(&exception.external_id).bind(&exception.occurrence_on)
                .bind(&exception.status).bind(&exception.replacement_start).bind(&exception.replacement_end)
                .bind(&exception.title_override).bind(&exception.location_override).bind(&now)
                .execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                upsert_ledger(
                    &mut transaction,
                    LedgerWrite {
                        external_id: &exception.external_id,
                        kind: "schedule_exception",
                        entity_id: &id,
                        content_hash: &content_hash,
                        sequence: exception.sequence,
                        generation,
                        cancelled: exception.status == "cancelled",
                        now: &now,
                    },
                )
                .await?;
            }
            NormalizedItem::Cancel {
                external_id,
                sequence,
            } => {
                if let Some(value) = &existing {
                    if let Some(id) = &value.entity_id {
                        match value.kind.as_str() {
                            "event" => {
                                sqlx::query("UPDATE events SET source_cancelled_at=?1, updated_at=?1 WHERE id=?2 AND source_id=?3").bind(&now).bind(id).bind(SOURCE_ID).execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                            }
                            "assignment" => {
                                sqlx::query("UPDATE assignments SET status='cancelled', updated_at=?1 WHERE id=?2 AND source_id=?3").bind(&now).bind(id).bind(SOURCE_ID).execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                            }
                            "recurring_rule" => {
                                sqlx::query("UPDATE recurring_schedule_rules SET source_cancelled_at=?1, updated_at=?1 WHERE id=?2 AND source_id=?3").bind(&now).bind(id).bind(SOURCE_ID).execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                            }
                            _ => {}
                        }
                    }
                    sqlx::query("UPDATE external_sync_items SET explicitly_cancelled=1, content_hash=?1, remote_sequence=?2, last_seen_generation=?3, last_seen_at=?4 WHERE source_id=?5 AND external_id=?6")
                        .bind(&content_hash).bind(sequence).bind(generation).bind(&now).bind(SOURCE_ID).bind(external_id)
                        .execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                } else {
                    sqlx::query(
                        "INSERT INTO external_sync_items (source_id, external_id, entity_kind, content_hash, remote_sequence, last_seen_generation, explicitly_cancelled, first_seen_at, last_seen_at) \
                         VALUES (?1, ?2, 'unsupported', ?3, ?4, ?5, 1, ?6, ?6)",
                    )
                    .bind(SOURCE_ID).bind(external_id).bind(&content_hash).bind(sequence)
                    .bind(generation).bind(&now).execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
                }
            }
        }
        if existing.is_some() {
            updated += 1;
        } else {
            inserted += 1;
        }
    }

    // The schema tracks generations for a future authoritative reconciliation pass.
    // v0.1 deliberately never tombstones an item merely because it is absent.
    sqlx::query(
        "UPDATE source_sync_states SET status='ok', sync_generation=?1, etag=?2, last_modified=?3, \
         last_success_at=?4, last_error_code=NULL, consecutive_failures=0, updated_at=?4 WHERE source_id=?5",
    )
    .bind(generation).bind(etag).bind(last_modified).bind(&now).bind(SOURCE_ID)
    .execute(&mut *transaction).await.map_err(|_| SyncError::Database)?;
    transaction
        .commit()
        .await
        .map_err(|_| SyncError::Database)?;
    Ok(IcalSyncResult {
        not_modified: false,
        generation,
        inserted,
        updated,
        unchanged,
        diagnostics,
    })
}

struct LedgerWrite<'a> {
    external_id: &'a str,
    kind: &'a str,
    entity_id: &'a str,
    content_hash: &'a str,
    sequence: Option<i64>,
    generation: i64,
    cancelled: bool,
    now: &'a str,
}

async fn upsert_ledger(
    transaction: &mut Transaction<'_, Sqlite>,
    write: LedgerWrite<'_>,
) -> Result<(), SyncError> {
    let (event_id, assignment_id, rule_id, exception_id) = match write.kind {
        "event" => (Some(write.entity_id), None, None, None),
        "assignment" => (None, Some(write.entity_id), None, None),
        "recurring_rule" => (None, None, Some(write.entity_id), None),
        "schedule_exception" => (None, None, None, Some(write.entity_id)),
        _ => return Err(SyncError::Database),
    };
    sqlx::query(
        "INSERT INTO external_sync_items (source_id, external_id, entity_kind, event_id, assignment_id, recurring_rule_id, schedule_exception_id, content_hash, remote_sequence, last_seen_generation, explicitly_cancelled, removed_at, first_seen_at, last_seen_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?12) \
         ON CONFLICT(source_id, external_id) DO UPDATE SET entity_kind=excluded.entity_kind, event_id=excluded.event_id, assignment_id=excluded.assignment_id, recurring_rule_id=excluded.recurring_rule_id, schedule_exception_id=excluded.schedule_exception_id, content_hash=excluded.content_hash, remote_sequence=excluded.remote_sequence, last_seen_generation=excluded.last_seen_generation, explicitly_cancelled=excluded.explicitly_cancelled, removed_at=NULL, last_seen_at=excluded.last_seen_at",
    )
    .bind(SOURCE_ID).bind(write.external_id).bind(write.kind).bind(event_id).bind(assignment_id).bind(rule_id).bind(exception_id)
    .bind(write.content_hash).bind(write.sequence).bind(write.generation).bind(if write.cancelled { 1 } else { 0 }).bind(write.now)
    .execute(&mut **transaction).await.map_err(|_| SyncError::Database)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    const SYNTHETIC: &str = include_str!("../test-fixtures/canvas-synthetic.ics");

    #[test]
    fn endpoint_policy_is_strict() {
        assert!(
            validate_endpoint("https://canvas.dankook.ac.kr/feeds/calendars/calendar.ics").is_ok()
        );
        assert!(validate_endpoint("http://canvas.dankook.ac.kr/feed").is_err());
        assert!(validate_endpoint("https://canvas.dankook.ac.kr.evil.test/feed").is_err());
        assert!(validate_endpoint("https://canvas.dankook.ac.kr:444/feed").is_err());
    }

    #[test]
    fn parses_and_classifies_synthetic_calendar() {
        let snapshot = parse_calendar(SYNTHETIC.as_bytes()).unwrap();
        assert_eq!(snapshot.diagnostics.events, 1);
        assert_eq!(snapshot.diagnostics.assignments, 2);
        assert_eq!(snapshot.diagnostics.recurring_rules, 2);
        assert_eq!(snapshot.diagnostics.schedule_exceptions, 1);
        assert_eq!(snapshot.diagnostics.date_values, 1);
        assert!(snapshot
            .diagnostics
            .property_names
            .contains(&"UID".to_owned()));
        assert!(!snapshot
            .diagnostics
            .property_names
            .iter()
            .any(|value| value.contains("synthetic")));
        let date_assignment = snapshot
            .items
            .iter()
            .find_map(|item| match item {
                NormalizedItem::Assignment(value)
                    if value.external_id
                        == external_id("ical:v1", "event-assignment-synthetic-2") =>
                {
                    Some(value)
                }
                _ => None,
            })
            .unwrap();
        assert!(
            matches!(date_assignment.due, Some(TemporalValue::Date { ref value, .. }) if value == "2026-09-18")
        );
    }

    #[test]
    fn identity_uses_uid_not_mutable_fields() {
        let first = external_id("ical:v1", "opaque-uid");
        let second = external_id("ical:v1", "opaque-uid");
        assert_eq!(first, second);
        assert_ne!(first, external_id("ical:v1", "opaque-uid-2"));
        assert!(!first.contains("opaque-uid"));
    }

    #[test]
    fn title_alone_never_classifies_assignment() {
        let properties = vec![
            Property {
                name: "UID".into(),
                params: None,
                value: Some("title-only".into()),
            },
            Property {
                name: "SUMMARY".into(),
                params: None,
                value: Some("Assignment homework deadline".into()),
            },
            Property {
                name: "DTSTART".into(),
                params: None,
                value: Some("20260914T120000Z".into()),
            },
        ];
        let mut diagnostics = IcalDiagnostics::default();
        let result = normalize_component(
            "VEVENT",
            &properties,
            SOURCE_TIMEZONE,
            &HashMap::new(),
            &mut diagnostics,
        )
        .unwrap();
        assert!(matches!(result.as_slice(), [NormalizedItem::Event(_)]));
    }

    #[test]
    fn cancellation_and_recurrence_instance_are_explicit() {
        let cancelled = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:cancelled-item\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(cancelled.as_bytes()).unwrap();
        assert!(matches!(
            snapshot.items.as_slice(),
            [NormalizedItem::Cancel { .. }]
        ));
        assert_eq!(snapshot.diagnostics.cancellations, 1);

        let recurrence = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:Asia/Seoul\r\nBEGIN:VEVENT\r\nUID:rule-with-override\r\nDTSTART;TZID=Asia/Seoul:20260914T130000\r\nDTEND;TZID=Asia/Seoul:20260914T140000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nX-CANVAS-COURSE-ID:88\r\nX-CANVAS-COURSE-NAME:Synthetic Course\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:rule-with-override\r\nRECURRENCE-ID;TZID=Asia/Seoul:20260921T130000\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(recurrence.as_bytes()).unwrap();
        assert_eq!(snapshot.diagnostics.recurring_rules, 1);
        assert_eq!(snapshot.diagnostics.schedule_exceptions, 1);
        assert!(snapshot.items.iter().any(
            |item| matches!(item, NormalizedItem::Exception(value) if value.status == "cancelled")
        ));
    }

    #[test]
    fn unsupported_recurrence_is_not_materialized() {
        let monthly = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:monthly-item\r\nDTSTART:20260914T010000Z\r\nDTEND:20260914T020000Z\r\nRRULE:FREQ=MONTHLY\r\nSUMMARY:Synthetic monthly\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(monthly.as_bytes()).unwrap();
        assert!(snapshot.items.is_empty());
        assert_eq!(snapshot.diagnostics.unsupported, 1);

        for rule in ["FREQ=WEEKLY;BYDAY=MO;BYMONTH=12", "FREQ=WEEKLY;BYDAY=1MO"] {
            let calendar = format!(
                "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:restricted-weekly-{rule}\r\nDTSTART:20260914T010000Z\r\nDTEND:20260914T020000Z\r\nRRULE:{rule}\r\nX-CANVAS-COURSE-ID:7\r\nX-CANVAS-COURSE-NAME:Synthetic\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
            );
            let snapshot = parse_calendar(calendar.as_bytes()).unwrap();
            assert!(snapshot.items.is_empty());
            assert_eq!(snapshot.diagnostics.unsupported, 1);
        }
    }

    #[test]
    fn tolerates_standard_auxiliary_components_and_bom() {
        let calendar = "\u{feff}\r\nBEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Seoul\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0900\r\nTZOFFSETTO:+0900\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:auxiliary-item\r\nDTSTART;TZID=Asia/Seoul:20260914T120000\r\nDTEND;TZID=Asia/Seoul:20260914T130000\r\nSUMMARY:Redacted fixture\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nDESCRIPTION:Redacted alarm\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:X-HARMLESS\r\nX-PRIVATE-VALUE:must-never-appear\r\nEND:X-HARMLESS\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(calendar.as_bytes()).unwrap();
        assert_eq!(snapshot.diagnostics.events, 1);
        assert_eq!(
            snapshot.diagnostics.component_counts.get("VTIMEZONE"),
            Some(&1)
        );
        assert_eq!(
            snapshot.diagnostics.component_counts.get("VALARM"),
            Some(&1)
        );
        assert_eq!(
            snapshot.diagnostics.component_counts.get("AUXILIARY"),
            Some(&1)
        );
        assert_eq!(
            snapshot
                .diagnostics
                .unsupported_reasons
                .get("auxiliary_component_ignored"),
            Some(&1)
        );
        let serialized = serde_json::to_string(&snapshot.diagnostics).unwrap();
        assert!(!serialized.contains("must-never-appear"));
        assert!(!serialized.contains("auxiliary-item"));
        assert!(!serialized.contains("Redacted"));
    }

    #[test]
    fn skips_only_items_with_unsupported_temporal_semantics() {
        let calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:valid-item\r\nDTSTART:20260914T010000Z\r\nSUMMARY:Valid\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:missing-start\r\nSUMMARY:Missing\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:unknown-zone\r\nDTSTART;TZID=Private/Unknown:20260914T120000\r\nSUMMARY:Unknown zone\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(calendar.as_bytes()).unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.diagnostics.events, 1);
        assert_eq!(snapshot.diagnostics.unsupported, 2);
        assert_eq!(
            snapshot
                .diagnostics
                .unsupported_reasons
                .get("missing_dtstart"),
            Some(&1)
        );
        assert_eq!(
            snapshot
                .diagnostics
                .unsupported_reasons
                .get("invalid_dtstart"),
            Some(&1)
        );
    }

    #[test]
    fn preserves_declared_extended_date_semantics() {
        let calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event-assignment-extended-date\r\nDTSTART;VALUE=DATE:2026-09-14\r\nSUMMARY:Redacted fixture\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(calendar.as_bytes()).unwrap();
        assert_eq!(snapshot.diagnostics.assignments, 1);
        assert_eq!(snapshot.diagnostics.unsupported, 0);
        assert!(matches!(
            snapshot.items.as_slice(),
            [NormalizedItem::Assignment(NormalizedAssignment {
                due: Some(TemporalValue::Date { value, .. }),
                ..
            })] if value == "2026-09-14"
        ));
    }

    #[test]
    fn preserves_canvas_declared_date_with_midnight_suffix() {
        let calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event-assignment-midnight-date\r\nDTSTART;VALUE=DATE:20260914T000000\r\nDTEND;VALUE=DATE:20260915T000000\r\nSUMMARY:Redacted fixture\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(calendar.as_bytes()).unwrap();
        assert_eq!(snapshot.diagnostics.assignments, 1);
        assert_eq!(snapshot.diagnostics.unsupported, 0);
        assert!(matches!(
            snapshot.items.as_slice(),
            [NormalizedItem::Assignment(NormalizedAssignment {
                due: Some(TemporalValue::Date { value, .. }),
                ..
            })] if value == "2026-09-14"
        ));

        let non_midnight = calendar.replace("T000000", "T120000");
        let snapshot = parse_calendar(non_midnight.as_bytes()).unwrap();
        assert!(snapshot.items.is_empty());
        assert_eq!(snapshot.diagnostics.unsupported, 1);
    }

    #[test]
    fn quarantines_conflicting_identity_and_keeps_other_items() {
        let calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:conflict\r\nSEQUENCE:1\r\nDTSTART:20260914T010000Z\r\nSUMMARY:First\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:conflict\r\nSEQUENCE:1\r\nDTSTART:20260914T020000Z\r\nSUMMARY:Second\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:safe\r\nDTSTART:20260914T030000Z\r\nSUMMARY:Safe\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let snapshot = parse_calendar(calendar.as_bytes()).unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.diagnostics.unsupported, 1);
        assert_eq!(
            snapshot
                .diagnostics
                .unsupported_reasons
                .get("duplicate_identity_conflict"),
            Some(&1)
        );
    }

    #[test]
    fn structural_corruption_still_fails_the_feed() {
        let malformed = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:broken\r\nDTSTART:20260914T010000Z\r\nEND:VCALENDAR\r\n";
        assert!(parse_calendar(malformed.as_bytes()).is_err());
    }

    async fn memory_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(sqlx::raw_sql(include_str!("../migrations/001_initial.sql")))
            .await
            .unwrap();
        pool.execute(sqlx::raw_sql(include_str!(
            "../migrations/002_recurring_schedule.sql"
        )))
        .await
        .unwrap();
        pool.execute(sqlx::raw_sql(include_str!(
            "../migrations/003_ical_sync.sql"
        )))
        .await
        .unwrap();
        pool.execute(sqlx::raw_sql(include_str!(
            "../migrations/004_ical_date_guards.sql"
        )))
        .await
        .unwrap();
        pool.execute(sqlx::raw_sql(include_str!(
            "../migrations/005_ical_adapter_version.sql"
        )))
        .await
        .unwrap();
        let now = "2026-09-01T00:00:00.000Z";
        sqlx::query("INSERT INTO sources (id,kind,display_name,created_at,updated_at) VALUES (?1,'ical','test',?2,?2)")
            .bind(SOURCE_ID).bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO source_sync_states (source_id,status,created_at,updated_at) VALUES (?1,'idle',?2,?2)")
            .bind(SOURCE_ID).bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO semesters (id,name,starts_on,ends_on,timezone,created_at,updated_at) VALUES ('semester:test','2026-2','2026-09-01','2026-12-14','Asia/Seoul',?1,?1)")
            .bind(now).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn snapshot_is_atomic_idempotent_and_does_not_delete_missing() {
        let pool = memory_pool().await;
        let first = apply_snapshot(
            &pool,
            parse_calendar(SYNTHETIC.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(first.inserted, 6);
        let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
            .fetch_one(&pool)
            .await
            .unwrap();
        let assignment_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM assignments")
            .fetch_one(&pool)
            .await
            .unwrap();
        let rule_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recurring_schedule_rules")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((event_count, assignment_count, rule_count), (1, 2, 2));
        let ids_before: Vec<String> = sqlx::query_scalar("SELECT entity_id FROM (SELECT COALESCE(event_id,assignment_id,recurring_rule_id,schedule_exception_id,course_id) entity_id FROM external_sync_items) WHERE entity_id IS NOT NULL ORDER BY entity_id")
            .fetch_all(&pool).await.unwrap();
        let second = apply_snapshot(
            &pool,
            parse_calendar(SYNTHETIC.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(second.inserted, 0);
        assert_eq!(second.unchanged, 6);
        let ids_after: Vec<String> = sqlx::query_scalar("SELECT entity_id FROM (SELECT COALESCE(event_id,assignment_id,recurring_rule_id,schedule_exception_id,course_id) entity_id FROM external_sync_items) WHERE entity_id IS NOT NULL ORDER BY entity_id")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(ids_before, ids_after);

        let smaller = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-event-1\r\nDTSTART:20260914T010000Z\r\nSUMMARY:Changed\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        apply_snapshot(
            &pool,
            parse_calendar(smaller.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let assignments_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM assignments WHERE source_removed_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            assignments_after, 2,
            "absence must not delete before feed authority is verified"
        );
    }

    #[tokio::test]
    async fn sequence_prevents_stale_overwrite_and_stale_resurrection() {
        let pool = memory_pool().await;
        let current = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sequence-item\r\nSEQUENCE:2\r\nDTSTART:20260914T010000Z\r\nSUMMARY:Current\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        apply_snapshot(
            &pool,
            parse_calendar(current.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let stale = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sequence-item\r\nSEQUENCE:1\r\nDTSTART:20260914T010000Z\r\nSUMMARY:Stale\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let result = apply_snapshot(&pool, parse_calendar(stale.as_bytes()).unwrap(), None, None)
            .await
            .unwrap();
        assert_eq!(result.unchanged, 1);
        let title: String =
            sqlx::query_scalar("SELECT title FROM events WHERE source_removed_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Current");

        let cancelled = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:tombstone-item\r\nSEQUENCE:2\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        apply_snapshot(
            &pool,
            parse_calendar(cancelled.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let stale_active = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:tombstone-item\r\nSEQUENCE:1\r\nDTSTART:20260914T020000Z\r\nSUMMARY:Must not return\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        apply_snapshot(
            &pool,
            parse_calendar(stale_active.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let missing: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE title='Must not return'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(missing, 0);
        let newer_active = stale_active
            .replace("SEQUENCE:1", "SEQUENCE:3")
            .replace("Must not return", "Restored");
        apply_snapshot(
            &pool,
            parse_calendar(newer_active.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let restored: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM events WHERE title='Restored' AND source_removed_at IS NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(restored, 1);
    }

    #[tokio::test]
    async fn existing_manual_recurring_rule_is_reused_without_overwrite() {
        let pool = memory_pool().await;
        let now = "2026-09-01T00:00:00.000Z";
        sqlx::query("INSERT INTO sources (id,kind,display_name,created_at,updated_at) VALUES ('manual:test','manual','Manual',?1,?1)")
            .bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO courses (id,source_id,name,code,created_at,updated_at) VALUES ('course:manual','manual:test','Existing Course','EX101',?1,?1)")
            .bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO recurring_schedule_rules (id,semester_id,course_id,source_id,weekday,start_local_time,end_local_time,location,created_at,updated_at) VALUES ('rule:manual','semester:test','course:manual','manual:test',1,'09:00','10:00','Room 1',?1,?1)")
            .bind(now).execute(&pool).await.unwrap();
        let calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:Asia/Seoul\r\nBEGIN:VEVENT\r\nUID:manual-rule-provider-uid\r\nSEQUENCE:1\r\nDTSTART;TZID=Asia/Seoul:20260914T090000\r\nDTEND;TZID=Asia/Seoul:20260914T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nLOCATION:Room 1\r\nX-CANVAS-COURSE-ID:101\r\nX-CANVAS-COURSE-CODE:EX101\r\nX-CANVAS-COURSE-NAME:Existing Course\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        apply_snapshot(
            &pool,
            parse_calendar(calendar.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recurring_schedule_rules")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let owner: String = sqlx::query_scalar(
            "SELECT source_id FROM recurring_schedule_rules WHERE id='rule:manual'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(owner, "manual:test");
        let linked: String = sqlx::query_scalar(
            "SELECT recurring_rule_id FROM external_sync_items WHERE entity_kind='recurring_rule'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(linked, "rule:manual");

        let cancelled = calendar
            .replace("SEQUENCE:1", "SEQUENCE:2")
            .replace("END:VEVENT", "STATUS:CANCELLED\r\nEND:VEVENT");
        apply_snapshot(
            &pool,
            parse_calendar(cancelled.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let manual_cancelled_at: Option<String> = sqlx::query_scalar(
            "SELECT source_cancelled_at FROM recurring_schedule_rules WHERE id='rule:manual'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            manual_cancelled_at, None,
            "provider cancellation must not mutate a manual rule"
        );
        let ledger_cancelled: i64 = sqlx::query_scalar(
            "SELECT explicitly_cancelled FROM external_sync_items WHERE entity_kind='recurring_rule'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(ledger_cancelled, 1);

        let restored = calendar.replace("SEQUENCE:1", "SEQUENCE:3");
        apply_snapshot(
            &pool,
            parse_calendar(restored.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let ledger_restored: i64 = sqlx::query_scalar(
            "SELECT explicitly_cancelled FROM external_sync_items WHERE entity_kind='recurring_rule'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(ledger_restored, 0);
    }

    #[tokio::test]
    async fn cross_kind_reclassification_is_atomic() {
        let pool = memory_pool().await;
        let event = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:cross-kind\r\nDTSTART:20260914T010000Z\r\nSUMMARY:Event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        apply_snapshot(&pool, parse_calendar(event.as_bytes()).unwrap(), None, None)
            .await
            .unwrap();
        let assignment = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:cross-kind\r\nDTSTART:20260914T010000Z\r\nX-CANVAS-ASSIGNMENT-ID:7\r\nSUMMARY:Assignment\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        apply_snapshot(
            &pool,
            parse_calendar(assignment.as_bytes()).unwrap(),
            None,
            None,
        )
        .await
        .unwrap();
        let counts: (i64, i64) = (
            sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE source_removed_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT COUNT(*) FROM assignments")
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        assert_eq!(counts, (0, 1));

        apply_snapshot(&pool, parse_calendar(event.as_bytes()).unwrap(), None, None)
            .await
            .unwrap();
        let restored_counts: (i64, i64) = (
            sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE source_removed_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT COUNT(*) FROM assignments WHERE source_removed_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        assert_eq!(restored_counts, (1, 0));
    }
}
