// The engine's process and its three pipes. On Windows a Node process writes to its stdout and stderr pipes
// synchronously: while nobody reads, the engine's whole event loop stops (turns, timers, the phone), and if the app
// writes to stdin from the thread that should read stdout, both wait for each other for ever. So each pipe has a thread
// of its own that never waits for anything else:
//   - stdout: reads lines and hands them over through an unbounded channel (the app handles them elsewhere);
//   - stderr: reads and hands the bytes to the log writer, as fast as they come;
//   - stdin: writes what a queue holds, in order; nobody else touches the pipe.
// When stdout ends, the same channel says the process has gone, with its exit code.
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// What the stdout thread hands over.
#[derive(Debug)]
pub enum Out {
  Line(String),
  Exit(Option<i32>),
}

pub struct Process {
  writer: mpsc::Sender<Vec<u8>>,
  child: Arc<Mutex<Child>>,
}

impl Process {
  /// Starts `cmd` with its pipes. `on_out` and `on_err` run on the readers' threads: they must not block (send to a
  /// channel, append to a file).
  pub fn spawn(
    mut cmd: Command,
    on_out: impl Fn(Out) + Send + 'static,
    mut on_err: impl FnMut(&[u8]) + Send + 'static,
  ) -> std::io::Result<Self> {
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    let mut stdin = child.stdin.take().expect("stdin piped");
    let child = Arc::new(Mutex::new(child));

    let (writer, queue) = mpsc::channel::<Vec<u8>>();
    std::thread::Builder::new().name("motor-stdin".into()).spawn(move || {
      for chunk in queue {
        if stdin.write_all(&chunk).and_then(|_| stdin.flush()).is_err() {
          break; // the engine has gone: the stdout thread says so
        }
      }
    })?;

    std::thread::Builder::new().name("motor-stderr".into()).spawn(move || {
      let mut buf = vec![0u8; 64 * 1024];
      while let Ok(n) = stderr.read(&mut buf) {
        if n == 0 {
          break;
        }
        on_err(&buf[..n]);
      }
    })?;

    let waiter = child.clone();
    std::thread::Builder::new().name("motor-stdout".into()).spawn(move || {
      let mut reader = BufReader::with_capacity(256 * 1024, stdout);
      let mut line = Vec::new();
      loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
          Ok(0) | Err(_) => break,
          Ok(_) => on_out(Out::Line(String::from_utf8_lossy(&line).trim_end().to_string())),
        }
      }
      // stdout closed: the process is ending; its exit code as soon as it has one.
      let code = loop {
        match waiter.lock().map(|mut c| c.try_wait()) {
          Ok(Ok(Some(status))) => break status.code(),
          Ok(Ok(None)) => std::thread::sleep(Duration::from_millis(20)),
          _ => break None,
        }
      };
      on_out(Out::Exit(code));
    })?;

    Ok(Self { writer, child })
  }

  /// Queues bytes for stdin (never blocks). False when the writer has gone.
  pub fn send(&self, bytes: Vec<u8>) -> bool {
    self.writer.send(bytes).is_ok()
  }

  pub fn with_child<T>(&self, f: impl FnOnce(&mut Child) -> T) -> Option<T> {
    self.child.lock().ok().map(|mut c| f(&mut c))
  }

  pub fn exited(&self) -> bool {
    self.with_child(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(true)
  }

  pub fn kill(&self) {
    self.with_child(|c| {
      let _ = c.kill();
    });
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Instant;

  fn node() -> Option<String> {
    let n = std::env::var("ORB_NODE").unwrap_or_else(|_| "node".into());
    Command::new(&n).arg("--version").output().ok().filter(|o| o.status.success()).map(|_| n)
  }

  // A process that floods stdout (~100 MB of events) and stderr while the app's side is slow to handle them, and gets a
  // big stdin message at the same time: nothing stalls, every line arrives, and the process's own timers keep running.
  #[test]
  fn floods_on_both_pipes_never_stall_the_process_or_the_writer() {
    let Some(node) = node() else {
      eprintln!("sin node: prueba omitida");
      return;
    };
    let script = r#"
      let ticks = 0; const t = setInterval(() => { ticks++; }, 10);
      let got = 0; process.stdin.on('data', (c) => { got += c.length; });
      const event = JSON.stringify({ type: 'event', event: 'x', payload: 'y'.repeat(100000) }) + '\n';
      const noise = 'z'.repeat(100000) + '\n';
      const start = Date.now(); let n = 0;
      const step = () => {
        for (let i = 0; i < 50 && n < 1000; i++, n++) { process.stdout.write(event); process.stderr.write(noise); }
        if (n < 1000) return setImmediate(step);
        const waitInput = () => { if (got < 20000000) return setTimeout(waitInput, 10);
          clearInterval(t);
          process.stdout.write(JSON.stringify({ type: 'done', ticks, ms: Date.now() - start, got }) + '\n');
          process.exit(0); };
        waitInput();
      };
      step();
    "#;
    let mut cmd = Command::new(node);
    cmd.args(["-e", script]);
    let (tx, rx) = mpsc::channel();
    let err_bytes = Arc::new(Mutex::new(0usize));
    let eb = err_bytes.clone();
    let p = Process::spawn(cmd, move |o| tx.send(o).unwrap(), move |b| *eb.lock().unwrap() += b.len()).unwrap();
    // 20 MB to stdin at once, while the process is writing.
    assert!(p.send(vec![b' '; 20_000_000]));
    let start = Instant::now();
    let (mut events, mut done, mut code) = (0usize, None, None);
    // The app is slow: it handles the lines with a pause every so often, but the reader threads keep draining.
    for o in rx.iter() {
      match o {
        Out::Line(l) if l.starts_with(r#"{"type":"event""#) => {
          events += 1;
          if events % 100 == 0 {
            std::thread::sleep(Duration::from_millis(30));
          }
        }
        Out::Line(l) => done = Some(serde_json::from_str::<serde_json::Value>(&l).unwrap()),
        Out::Exit(c) => {
          code = c;
          break;
        }
      }
    }
    let done = done.expect("done");
    assert_eq!(events, 1000);
    assert_eq!(code, Some(0));
    assert_eq!(done["got"].as_u64(), Some(20_000_000));
    assert!(*err_bytes.lock().unwrap() >= 100_000_000);
    // The process's timers ran while it wrote ~200 MB: its event loop was never frozen for long.
    let ms = done["ms"].as_f64().unwrap();
    let ticks = done["ticks"].as_f64().unwrap();
    eprintln!("flood: {events} events, {} MB stderr, {ms} ms, {ticks} ticks, app side {:?}", *err_bytes.lock().unwrap() / 1_000_000, start.elapsed());
    assert!(ticks >= ms / 10.0 * 0.3, "timers starved: {ticks} ticks in {ms} ms");
    assert!(start.elapsed() < Duration::from_secs(60));
  }

  #[test]
  fn exit_code_is_reported_and_a_dead_writer_does_not_panic() {
    let Some(node) = node() else { return };
    let mut cmd = Command::new(node);
    cmd.args(["-e", "process.exit(75)"]);
    let (tx, rx) = mpsc::channel();
    let p = Process::spawn(cmd, move |o| tx.send(o).unwrap(), |_| {}).unwrap();
    let code = rx.iter().find_map(|o| if let Out::Exit(c) = o { Some(c) } else { None }).unwrap();
    assert_eq!(code, Some(75));
    assert!(p.exited());
    p.send(b"{}\n".to_vec()); // after the process: no panic
  }
}
