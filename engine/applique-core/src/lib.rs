//! applique-core: the engine behind Appliqué.
//!
//! Pure Rust, no I/O. Built two ways:
//!   - as WebAssembly for the extension (`wasm` module, via wasm-bindgen);
//!   - as a normal library for tests and tools.
//!
//! Modules grow phase by phase (see docs/PIPELINE_PLAN.md). Phase 0 ships the
//! keyword primitives ported from career-ops so the toolchain is proven on
//! real logic.

pub mod keywords;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

/// Engine identity, shown in the extension and recorded in telemetry.
pub fn info() -> serde_json::Value {
    serde_json::json!({
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "modules": ["keywords"],
    })
}
