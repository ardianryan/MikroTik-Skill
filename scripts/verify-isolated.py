#!/usr/bin/env python3
"""Run local checks without router credentials or writes outside a disposable directory."""
import os
import pty
import select
import signal
import struct
import termios
import fcntl
import time
from pathlib import Path
import resource
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
scratch_parent = root / '.verification'
scratch_parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=scratch_parent, prefix='scratch-') as directory:
    scratch = Path(directory).resolve()
    (scratch / 'home').mkdir()
    (scratch / 'build').mkdir()
    profile = f'''(version 1)(allow default)
(deny network*)
(allow network-inbound network-outbound (local ip "localhost:*") (remote ip "localhost:*"))
(deny file-write* (require-all (require-not (subpath "{scratch}")) (require-not (literal "/dev/null"))))
(deny file-read-data (require-all (subpath "/Users") (require-not (subpath "{root}"))))
(deny file-read-data (literal "{root}/.env") (literal "{root}/inventory.yml") (literal "{root}/inventory.yaml") (literal "{root}/inventory.json"))
'''
    (scratch / 'sandbox.sb').write_text(profile)
    node = shutil.which('node')
    if not node or not Path('/usr/bin/sandbox-exec').exists():
        raise SystemExit('macOS sandbox-exec and Node.js are required; use an isolated container on other systems')
    environment = {
        'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'HOME': str(scratch / 'home'),
        'TMPDIR': str(scratch), 'NODE_OPTIONS': '--max-old-space-size=512',
        'ROUTEROS_HOST': '127.0.0.1', 'ROUTEROS_USER': 'fixture', 'ROUTEROS_PASSWORD': 'fixture',
        'ROUTEROS_USE_SSL': 'false', 'ROUTEROS_REST_PORT': '9', 'ROUTEROS_API_PORT': '9',
        'ROUTEROS_API_SSL_PORT': '9',
    }
    process_limit = min(resource.getrlimit(resource.RLIMIT_NPROC)[1], len(subprocess.check_output(['/bin/ps', '-U', str(os.getuid()), '-o', 'pid=']).splitlines()) + 32)
    def limits():
        for name, value in [('RLIMIT_CPU', 90), ('RLIMIT_NOFILE', 256), ('RLIMIT_NPROC', process_limit), ('RLIMIT_FSIZE', 16 * 1024**2)]:
            resource.setrlimit(getattr(resource, name), (value, value))
    mode = sys.argv[1] if len(sys.argv) > 1 else 'typecheck'
    commands = {
        'typecheck': [node, 'node_modules/typescript/bin/tsc', '--noEmit'],
        'build': [node, 'node_modules/typescript/bin/tsc', '--outDir', str(scratch / 'build')],
        'test': [node, '--import', 'tsx', '--test', '--test-concurrency=1', *[str(p) for p in sorted((root / 'test').glob('*.test.ts'))]],
    }
    if mode == 'tui-smoke':
        for scenario, keys in [('quit', b'q'), ('interrupt', b'\x03'), ('form-quit', b'af\x11'), ('terminate', None), ('offline-quit', b'q'), ('offline-form', b'3\t\r\x11'), ('gateway-offline', b'\x0fq')]:
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
            child = subprocess.Popen(['/usr/bin/sandbox-exec', '-f', str(scratch / 'sandbox.sb'), node, '--import', 'tsx', 'src/cli/index.ts', 'tui', *(['--offline'] if scenario.startswith('offline-') else [])],
                                     cwd=root, env=environment, stdin=slave, stdout=slave, stderr=slave,
                                     preexec_fn=limits, start_new_session=True)
            os.close(slave)
            output = bytearray()
            def read_until(predicate, seconds=6):
                deadline = time.monotonic() + seconds
                while time.monotonic() < deadline:
                    if predicate():
                        return
                    if select.select([master], [], [], 0.05)[0]:
                        try:
                            chunk = os.read(master, 65536)
                            if chunk:
                                output.extend(chunk)
                            else:
                                time.sleep(0.02)
                        except OSError:
                            time.sleep(0.02)
                if not predicate():
                    raise RuntimeError('TUI PTY failed: ' + scenario + ', exit=' + str(child.poll()) + ', tail=' + repr(bytes(output[-300:])))
            try:
                read_until(lambda: (b'Offline tools' in output) if scenario.startswith('offline-') else (b'ROUTER ONBOARDING' in output))
                if scenario == 'quit':
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 8, 30, 0, 0))
                    os.kill(child.pid, signal.SIGWINCH)
                    read_until(lambda: b'Terminal too small' in output)
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
                    os.kill(child.pid, signal.SIGWINCH)
                if keys is None:
                    os.kill(child.pid, signal.SIGTERM)
                else:
                    os.write(master, keys)
                read_until(lambda: child.poll() is not None)
                if child.returncode != 0 or b'\x1b[?1049l' not in output or b'\x1b[?25h' not in output:
                    raise RuntimeError(f'Terminal restoration failed: {scenario}, exit={child.returncode}')
                print(f'TUI PTY {scenario}: PASS')
            finally:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=5)
                os.close(master)
        raise SystemExit(0)
    result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(scratch / 'sandbox.sb'), *commands[mode]],
                            cwd=root, env=environment, preexec_fn=limits, timeout=120)
    raise SystemExit(result.returncode)
