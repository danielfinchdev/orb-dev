//! What build.rs put into the binary (see build.rs): the version, the updater's public key and, in a real build, the setup.
include!(concat!(env!("OUT_DIR"), "/embedded.rs"));
