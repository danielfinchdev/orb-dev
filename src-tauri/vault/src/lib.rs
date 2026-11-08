// Orb's master password and secrets, out of the engine (3.8.1): the data key, this PC's secret and every key made from
// a password live only in this crate's memory (locked pages, wiped after use). Orb.exe runs it for its engine
// (src-tauri/src/vault_host.rs); the tests run the same code as the orb-vault binary. The engine's side, with the API
// the rest of Orb uses, is src/core/master.mjs.
pub mod crypto;
pub mod dpapi;
pub mod grants;
pub mod locked;
pub mod machine;
pub mod server;
pub mod transport;
pub mod vault;

pub use server::Server;
pub use transport::{start_grants, EngineChannel};
pub use vault::Costs;
