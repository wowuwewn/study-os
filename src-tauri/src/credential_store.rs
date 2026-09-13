const CREDENTIAL_TARGET: &str = "com.wowuwewn.studyos/ical/canvas-dankook";

#[derive(Debug, thiserror::Error)]
pub enum CredentialError {
    #[error("credential_unavailable")]
    Unavailable,
    #[error("credential_missing")]
    Missing,
    #[error("credential_invalid")]
    Invalid,
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{CredentialError, CREDENTIAL_TARGET};
    use std::{ffi::OsStr, iter::once, os::windows::ffi::OsStrExt, ptr};
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(once(0)).collect()
    }

    pub fn set(value: &str) -> Result<(), CredentialError> {
        let mut target = wide(CREDENTIAL_TARGET);
        let mut username = wide("Study OS iCal");
        let mut blob = value.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            CredentialBlobSize: blob
                .len()
                .try_into()
                .map_err(|_| CredentialError::Invalid)?,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(username.as_mut_ptr()),
            ..Default::default()
        };

        unsafe { CredWriteW(&credential, 0) }.map_err(|_| CredentialError::Unavailable)
    }

    pub fn get() -> Result<String, CredentialError> {
        let target = wide(CREDENTIAL_TARGET);
        let mut raw: *mut CREDENTIALW = ptr::null_mut();
        unsafe { CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut raw) }
            .map_err(|_| CredentialError::Missing)?;
        if raw.is_null() {
            return Err(CredentialError::Missing);
        }

        let bytes = unsafe {
            let credential = &*raw;
            std::slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            )
            .to_vec()
        };
        unsafe { CredFree(raw.cast()) };
        String::from_utf8(bytes).map_err(|_| CredentialError::Invalid)
    }

    pub fn exists() -> bool {
        get().is_ok()
    }

    pub fn delete() -> Result<(), CredentialError> {
        let target = wide(CREDENTIAL_TARGET);
        match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(_) if !exists() => Ok(()),
            Err(_) => Err(CredentialError::Unavailable),
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::CredentialError;

    pub fn set(_: &str) -> Result<(), CredentialError> {
        Err(CredentialError::Unavailable)
    }
    pub fn get() -> Result<String, CredentialError> {
        Err(CredentialError::Unavailable)
    }
    pub fn exists() -> bool {
        false
    }
    pub fn delete() -> Result<(), CredentialError> {
        Err(CredentialError::Unavailable)
    }
}

pub use platform::{delete, exists, get, set};
