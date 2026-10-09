//! Every way the crate says no. A refusal carries a stable code a host turns
//! into player-facing text, plus a detail for logs and tests. Player-facing
//! wording belongs to the host.
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Code {
    /// Not an ISO9660 image (no `CD001` descriptors, no primary volume).
    NotAnImage,
    /// A read that would run past the end of the image or a file.
    Truncated,
    /// A size, offset or count beyond what the limits allow.
    TooLarge,
    /// The image asks for more traversal work than the record budget allows.
    BudgetExceeded,
    /// A structurally malformed image: a bad directory record or name.
    CorruptImage,
    /// A KWAJ method this crate does not expand (MS-ZIP, or an unknown one).
    UnsupportedCompression,
    /// A malformed compressed stream: a bad header, table or code.
    CorruptStream,
    /// Expansion would exceed the output cap (the decompression-bomb guard).
    OutputCap,
    /// The caller asked for something that does not exist (an unknown token).
    BadRequest,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::NotAnImage => "not-an-image",
            Code::Truncated => "truncated",
            Code::TooLarge => "too-large",
            Code::BudgetExceeded => "budget-exceeded",
            Code::CorruptImage => "corrupt-image",
            Code::UnsupportedCompression => "unsupported-compression",
            Code::CorruptStream => "corrupt-stream",
            Code::OutputCap => "output-cap",
            Code::BadRequest => "bad-request",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub code: Code,
    pub detail: String,
}

impl Refusal {
    pub fn new(code: Code, detail: impl Into<String>) -> Refusal {
        Refusal {
            code,
            detail: detail.into(),
        }
    }

    /// `{ "schema": 1, "code": ..., "detail": ... }`, the shape every host
    /// receives.
    pub fn to_json(&self) -> String {
        self.to_value().to_string()
    }

    pub fn to_value(&self) -> serde_json::Value {
        serde_json::json!({ "schema": crate::disc::SCHEMA, "code": self.code.as_str(), "detail": self.detail })
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.detail)
    }
}

impl std::error::Error for Refusal {}

pub type Result<T> = std::result::Result<T, Refusal>;

pub(crate) fn refuse<T>(code: Code, detail: impl Into<String>) -> Result<T> {
    Err(Refusal::new(code, detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_code_has_a_stable_kebab_case_name() {
        let all = [
            Code::NotAnImage,
            Code::Truncated,
            Code::TooLarge,
            Code::BudgetExceeded,
            Code::CorruptImage,
            Code::UnsupportedCompression,
            Code::CorruptStream,
            Code::OutputCap,
            Code::BadRequest,
        ];
        let names: Vec<&str> = all.iter().map(|c| c.as_str()).collect();
        assert_eq!(
            names,
            [
                "not-an-image",
                "truncated",
                "too-large",
                "budget-exceeded",
                "corrupt-image",
                "unsupported-compression",
                "corrupt-stream",
                "output-cap",
                "bad-request"
            ]
        );
    }

    #[test]
    fn crosses_as_json_and_displays_code_first() {
        let r = Refusal::new(Code::Truncated, "a \"quoted\" detail");
        let v: serde_json::Value = serde_json::from_str(&r.to_json()).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "schema": 1, "code": "truncated", "detail": "a \"quoted\" detail" })
        );
        assert_eq!(r.to_string(), "truncated: a \"quoted\" detail");
        let boxed: Box<dyn std::error::Error> = Box::new(r);
        assert!(boxed.to_string().starts_with("truncated"));
    }
}
