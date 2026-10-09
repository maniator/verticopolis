//! The JavaScript binding: the disc reader behind a narrow surface that
//! `wasm-bindgen` turns into a module, in the same shape as the engine's.
//! Structured results cross as JSON text, bytes as `Uint8Array`, and every
//! refusal as a JavaScript error whose message is the refusal's JSON
//! (`{"schema": 1, "code": ..., "detail": ...}`). Nothing here parses
//! anything itself.
//!
//! A host runs this module only inside a dedicated worker it can terminate;
//! the module's memory safety is an extra layer inside that boundary.
use wasm_bindgen::prelude::*;

use crate::disc::Disc as Core;
use crate::limits::Limits;
use crate::refusal::{Code, Refusal};
use crate::source::{check_range, OwnedBytes, ReadAt};

fn err(r: Refusal) -> JsError {
    JsError::new(&r.to_json())
}

fn limits(json: Option<String>) -> Result<Limits, Refusal> {
    match json {
        None => Ok(Limits::default()),
        Some(text) => serde_json::from_str(&text)
            .map_err(|e| Refusal::new(Code::BadRequest, format!("limits: {e}"))),
    }
}

#[wasm_bindgen]
extern "C" {
    /// A host-side byte source: `read(offset, length)` returns exactly
    /// `length` bytes from `offset` (a `File` read with `FileReaderSync` in a
    /// worker, or `fs.readSync` under Node).
    pub type ByteSource;

    #[wasm_bindgen(method, catch)]
    fn read(this: &ByteSource, offset: f64, length: u32) -> Result<Vec<u8>, JsValue>;
}

struct JsSource {
    source: ByteSource,
    size: u64,
}

impl ReadAt for JsSource {
    fn size(&self) -> u64 {
        self.size
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> crate::refusal::Result<()> {
        check_range(self.size, offset, buf.len() as u64)?;
        let got = self
            .source
            .read(offset as f64, buf.len() as u32)
            .map_err(|e| {
                // Keep the host's own error text: a failing drive or a closed
                // handle should not read as a cut-short image.
                let why = e
                    .as_string()
                    .or_else(|| js_error_message(&e))
                    .unwrap_or_default();
                Refusal::new(
                    Code::Truncated,
                    format!(
                        "the host could not read {} bytes at {offset}: {why}",
                        buf.len()
                    ),
                )
            })?;
        if got.len() != buf.len() {
            return Err(Refusal::new(
                Code::Truncated,
                format!(
                    "the host returned {} bytes for a {}-byte read at {offset}",
                    got.len(),
                    buf.len()
                ),
            ));
        }
        buf.copy_from_slice(&got);
        Ok(())
    }
}

/// An opened disc image. Construct with `openBytes` or `openSource`.
#[wasm_bindgen]
pub struct Disc {
    inner: Core<Box<dyn ReadAt>>,
}

/// One read: the `ReadInfo` JSON and the bytes.
#[wasm_bindgen]
pub struct DiscRead {
    info: String,
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl DiscRead {
    /// `{ schema, token, size, sha256 }`.
    pub fn info(&self) -> String {
        self.info.clone()
    }

    /// The bytes, handed over without a copy; a second call returns none.
    #[wasm_bindgen(js_name = takeBytes)]
    pub fn take_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.bytes)
    }
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = Error)]
    type JsErrorLike;

    #[wasm_bindgen(method, getter, structural)]
    fn message(this: &JsErrorLike) -> Option<String>;
}

fn js_error_message(e: &JsValue) -> Option<String> {
    use wasm_bindgen::JsCast;
    // Only an object has a `message` to read; a thrown `null`, `undefined`
    // or number would make the getter itself throw.
    if !e.is_object() {
        return None;
    }
    e.unchecked_ref::<JsErrorLike>().message()
}

/// The default limits as JSON, so a host checks sizes against the same
/// numbers the module enforces instead of a copy of them.
#[wasm_bindgen(js_name = defaultLimits)]
pub fn default_limits() -> String {
    serde_json::to_string(&Limits::default()).unwrap_or_else(|_| unreachable!("limits serialize"))
}

/// The hard ceilings as JSON: no limit a host passes may exceed these.
#[wasm_bindgen(js_name = hardLimits)]
pub fn hard_limits() -> String {
    serde_json::to_string(&crate::limits::HARD_LIMITS)
        .unwrap_or_else(|_| unreachable!("limits serialize"))
}

#[wasm_bindgen]
impl Disc {
    /// Open an image already in memory. `limits` is optional JSON
    /// (`{ "maxFileBytes": ... }`), defaults for anything left out.
    #[wasm_bindgen(js_name = openBytes)]
    pub fn open_bytes(bytes: Vec<u8>, limits_json: Option<String>) -> Result<Disc, JsError> {
        let src: Box<dyn ReadAt> = Box::new(OwnedBytes(bytes));
        Ok(Disc {
            inner: Core::open(src, limits(limits_json).map_err(err)?).map_err(err)?,
        })
    }

    /// Open an image of `size` bytes read on demand through `source`, so a
    /// whole disc is never copied into the module's memory.
    #[wasm_bindgen(js_name = openSource)]
    pub fn open_source(
        source: ByteSource,
        size: f64,
        limits_json: Option<String>,
    ) -> Result<Disc, JsError> {
        if !(size.is_finite()
            && size >= 0.0
            && size.fract() == 0.0
            && size <= 9_007_199_254_740_991.0)
        {
            return Err(err(Refusal::new(
                Code::BadRequest,
                format!("size must be a whole number of bytes, got {size}"),
            )));
        }
        let src: Box<dyn ReadAt> = Box::new(JsSource {
            source,
            size: size as u64,
        });
        Ok(Disc {
            inner: Core::open(src, limits(limits_json).map_err(err)?).map_err(err)?,
        })
    }

    /// The listing as JSON: `{ schema, source, entries }`.
    pub fn opened(&self) -> String {
        serde_json::to_string(&self.inner.opened())
            .unwrap_or_else(|_| unreachable!("the listing serializes"))
    }

    /// A file's bytes, expanded when it is KWAJ.
    pub fn read(&mut self, token: u32) -> Result<DiscRead, JsError> {
        let (info, bytes) = self.inner.read(token).map_err(err)?;
        Ok(DiscRead {
            info: serde_json::to_string(&info)
                .unwrap_or_else(|_| unreachable!("the read info serializes")),
            bytes,
        })
    }

    /// A file's bytes exactly as stored on the image.
    #[wasm_bindgen(js_name = readStored)]
    pub fn read_stored(&mut self, token: u32) -> Result<Vec<u8>, JsError> {
        self.inner.read_stored(token).map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_parse_partially_and_refuse_unknown_fields() {
        let l = limits(Some(r#"{"maxFileBytes": 10}"#.into())).unwrap();
        assert_eq!(l.max_file_bytes, 10);
        assert_eq!(l.max_records, Limits::default().max_records);
        assert_eq!(
            limits(Some(r#"{"maxBytes": 1}"#.into())).unwrap_err().code,
            Code::BadRequest
        );
        assert_eq!(limits(None).unwrap(), Limits::default());
        // The defaults this module reports parse back to the defaults.
        assert_eq!(limits(Some(default_limits())).unwrap(), Limits::default());
        assert_eq!(
            limits(Some(hard_limits())).unwrap(),
            crate::limits::HARD_LIMITS
        );
    }
}
