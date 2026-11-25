use serde::Serialize;
use std::io;
use std::path::Path;

pub const PROG_ID: &str = "DocumentViewer.PDF";
pub const APP_NAME: &str = "Document Viewer";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileAssociationStatus {
    pub is_registered_in_hkcu: bool,
    pub current_default_prog_id: Option<String>,
    pub is_default_pdf_viewer: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssociationSpec {
    pub prog_id: String,
    pub friendly_type_name: String,
    pub default_icon: String,
    pub open_command: String,
    pub app_name: String,
    pub app_description: String,
    pub capabilities_rel_path: String,
}

pub fn build_association_spec(exe_path: &Path, capabilities_rel_path: &str) -> AssociationSpec {
    let exe_str = exe_path.display();
    AssociationSpec {
        prog_id: PROG_ID.to_string(),
        friendly_type_name: "PDF Document".to_string(),
        default_icon: format!("\"{exe_str}\",0"),
        open_command: format!("\"{exe_str}\" \"%1\""),
        app_name: APP_NAME.to_string(),
        app_description: "Lightweight, distraction-free PDF reader for Windows".to_string(),
        capabilities_rel_path: capabilities_rel_path.to_string(),
    }
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHChangeNotify, ShellExecuteW, SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
    };
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, REG_NONE};
    use winreg::{RegKey, RegValue};

    /// Registers the per-user ProgID, OpenWithProgids, and RegisteredApplications
    /// entries under `software_root` (normally `HKCU\Software`).
    pub fn register_pdf_association_in_root(
        software_root: &RegKey,
        spec: &AssociationSpec,
    ) -> io::Result<()> {
        let (prog_key, _) =
            software_root.create_subkey(format!(r"Classes\{}", spec.prog_id))?;
        prog_key.set_value("", &spec.friendly_type_name)?;
        prog_key.set_value("FriendlyTypeName", &spec.friendly_type_name)?;

        let (icon_key, _) = prog_key.create_subkey("DefaultIcon")?;
        icon_key.set_value("", &spec.default_icon)?;

        let (cmd_key, _) = prog_key.create_subkey(r"shell\open\command")?;
        cmd_key.set_value("", &spec.open_command)?;

        let (open_with_key, _) =
            software_root.create_subkey(r"Classes\.pdf\OpenWithProgids")?;
        let empty_none = RegValue {
            bytes: Vec::new(),
            vtype: REG_NONE,
        };
        open_with_key.set_raw_value(&spec.prog_id, &empty_none)?;

        let (cap_key, _) = software_root.create_subkey(r"DocumentViewer\Capabilities")?;
        cap_key.set_value("ApplicationName", &spec.app_name)?;
        cap_key.set_value("ApplicationDescription", &spec.app_description)?;

        let (assoc_key, _) = cap_key.create_subkey("FileAssociations")?;
        assoc_key.set_value(".pdf", &spec.prog_id)?;

        let (reg_apps_key, _) = software_root.create_subkey("RegisteredApplications")?;
        reg_apps_key.set_value(&spec.app_name, &spec.capabilities_rel_path)?;

        Ok(())
    }

    pub fn notify_shell_assoc_changed() {
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED as i32,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
    }

    pub fn launch_windows_default_apps() -> io::Result<()> {
        let verb: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = OsStr::new("ms-settings:defaultapps")
            .encode_wide()
            .chain(Some(0))
            .collect();

        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1, // SW_SHOWNORMAL
            )
        };
        if (result as isize) <= 32 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub fn register_and_open_default_apps(exe_path: &Path) -> io::Result<FileAssociationStatus> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (software_root, _) = hkcu.create_subkey("Software")?;
        let spec = build_association_spec(exe_path, r"Software\DocumentViewer\Capabilities");
        register_pdf_association_in_root(&software_root, &spec)?;
        notify_shell_assoc_changed();
        launch_windows_default_apps()?;
        Ok(get_status())
    }

    pub fn get_status() -> FileAssociationStatus {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let prog_registered = hkcu
            .open_subkey_with_flags(
                format!(r"Software\Classes\{PROG_ID}\shell\open\command"),
                KEY_READ,
            )
            .is_ok();

        let cap_registered = hkcu
            .open_subkey_with_flags(r"Software\RegisteredApplications", KEY_READ)
            .and_then(|k| k.get_value::<String, _>(APP_NAME))
            .is_ok();

        let current_default_prog_id = hkcu
            .open_subkey_with_flags(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice",
                KEY_READ,
            )
            .and_then(|k| k.get_value::<String, _>("ProgId"))
            .ok();

        let is_default_pdf_viewer =
            current_default_prog_id.as_deref() == Some(PROG_ID);

        FileAssociationStatus {
            is_registered_in_hkcu: prog_registered && cap_registered,
            current_default_prog_id,
            is_default_pdf_viewer,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn builds_deterministic_windows_association_spec() {
            let exe = Path::new(r"C:\Program Files\Document Viewer\document-viewer.exe");
            let spec = build_association_spec(exe, r"Software\DocumentViewer\Capabilities");

            assert_eq!(spec.prog_id, "DocumentViewer.PDF");
            assert_eq!(spec.friendly_type_name, "PDF Document");
            assert_eq!(
                spec.default_icon,
                "\"C:\\Program Files\\Document Viewer\\document-viewer.exe\",0"
            );
            assert_eq!(
                spec.open_command,
                "\"C:\\Program Files\\Document Viewer\\document-viewer.exe\" \"%1\""
            );
            assert_eq!(spec.app_name, "Document Viewer");
            assert_eq!(spec.capabilities_rel_path, r"Software\DocumentViewer\Capabilities");
        }

        #[test]
        fn registers_progid_capabilities_and_command_in_isolated_test_key() {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let test_root_name = format!(r"Software\DocViewerTest_{}", std::process::id());
            let test_root = match hkcu.create_subkey(&test_root_name) {
                Ok((key, _)) => key,
                Err(err) if err.kind() == io::ErrorKind::PermissionDenied => {
                    // Sandboxed test environments block HKCU registry writes.
                    return;
                }
                Err(err) => panic!("unexpected registry error: {err}"),
            };

            let exe = Path::new(r"C:\Program Files\Document Viewer\document-viewer.exe");
            let spec = build_association_spec(
                exe,
                &format!(r"{test_root_name}\DocumentViewer\Capabilities"),
            );
            register_pdf_association_in_root(&test_root, &spec).unwrap();

            let cmd_key = test_root
                .open_subkey(format!(r"Classes\{PROG_ID}\shell\open\command"))
                .unwrap();
            let cmd_val: String = cmd_key.get_value("").unwrap();
            assert_eq!(cmd_val, spec.open_command);

            let assoc_key = test_root
                .open_subkey(r"DocumentViewer\Capabilities\FileAssociations")
                .unwrap();
            let pdf_prog: String = assoc_key.get_value(".pdf").unwrap();
            assert_eq!(pdf_prog, PROG_ID);

            let reg_apps = test_root.open_subkey("RegisteredApplications").unwrap();
            let cap_path: String = reg_apps.get_value(APP_NAME).unwrap();
            assert!(cap_path.ends_with(r"DocumentViewer\Capabilities"));

            hkcu.delete_subkey_all(&test_root_name).unwrap();
        }
    }
}

#[cfg(windows)]
pub use win_impl::{get_status, register_and_open_default_apps};

#[cfg(not(windows))]
pub fn get_status() -> FileAssociationStatus {
    FileAssociationStatus {
        is_registered_in_hkcu: false,
        current_default_prog_id: None,
        is_default_pdf_viewer: false,
    }
}

#[cfg(not(windows))]
pub fn register_and_open_default_apps(_exe_path: &Path) -> io::Result<FileAssociationStatus> {
    Ok(get_status())
}
